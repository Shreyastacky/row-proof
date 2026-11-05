/**
 * Assessment engine for the v1 Supabase SELECT adapter.
 *
 * Order of operations (each step gates the next):
 *   1. Approved baseline (already verified by the read-only reader).
 *   2. Supported-scope check: unsupported intent -> not_assessed, no requests.
 *   3. Target: the supplied URL must equal the approved origin exactly; local
 *      targets must be loopback. Failure -> nothing is sent.
 *   4. API key class: must match the declared kind; elevated keys are refused.
 *   5. Fixture verification through the separate setup channel (secret key).
 *   6. Identity verification of each user token against this target's Auth
 *      service (GET /auth/v1/user, the endpoint behind supabase-js getUser(jwt)),
 *      expected user id, issuer, expiry, distinctness.
 *   6c. Anonymous context: GET /auth/v1/user with the anonymous headers must be
 *      refused (401/403). Otherwise "anonymous" is really a signed-in session.
 *   7. For every request path (the Data API route, then any approved RPC
 *      function or application route): owner reads (positive controls) with
 *      exact id/owner/marker checks, then denied reads by exact fixture id. No
 *      owner filter is ever added, so an exposed row cannot be hidden by the
 *      query itself.
 *   8. Fixture stability: the fixtures are re-read through the setup channel.
 *      If any fixture vanished or changed owner or marker mid-run, no assertion
 *      may pass (an empty read of a deleted row proves nothing).
 *
 * A concrete disclosure of a forbidden fixture is always `failed`, even when
 * other controls are blocked. A disclosure is any returned row carrying the
 * fixture's id or marker, any response that contains the marker, or a success
 * response that names the fixture's id. An empty result is a denial pass only
 * when every control it depends on succeeded on the same path.
 */
import {
  checkRuleContentSemantics,
  parseExactOrigin,
  summarize,
  type AssertionResult,
  type AuthenticatedActor,
  type ControlResult,
  type DiagnosticCode,
  type Expectation,
  type Fixture,
  type ExtraPath,
  type Observation,
  type RuleContent,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@pyx/contracts';
import { classifyApiKey, decodeJwtUnverified, isElevated, isHeaderSafe, precheckUserToken } from './credentials.js';
import type { HttpOutcome, Transport, TransportFailureCode } from './transport.js';

export const DEFAULT_LIMITS: RunLimits = {
  maxRequests: 64,
  requestTimeoutMs: 5_000,
  runTimeoutMs: 60_000,
  maxResponseBytes: 64 * 1024,
  concurrency: 1,
  retries: 0,
};

/** Tokens must stay valid for at least this long after preflight. */
export const MIN_TOKEN_REMAINING_MS = 60_000;

export interface RunContext {
  baseline: VerifiedBaseline | null;
  baselineFailure: { ruleId: string; diagnostic: 'baseline_invalid' | 'baseline_pin_mismatch' } | null;
  env: Readonly<Record<string, string | undefined>>;
  targetUrl: string | undefined;
  transport: Transport;
  limits: RunLimits;
  source: RunResult['source'];
  executionContext: RunResult['provenance']['executionContext'];
  runnerVersion: string;
  runId: string;
  now: () => Date;
}

/**
 * One request the runner sent, for the request ledger. Holds no header values:
 * `as` names which identity was used, never the credential itself. URLs carry
 * only the origin, path, column names and synthetic fixture ids.
 */
export interface RequestRecord {
  n: number;
  purpose: 'fixture-check' | 'identity' | 'anonymous-context' | 'read' | 'fixture-recheck';
  as: string;
  path: string | null;
  method: 'GET';
  url: string;
  status: number | null;
  failure: string | null;
  bytes: number;
  ms: number;
}

export interface RunOutput {
  result: RunResult;
  /** Credential values loaded for this run; callers use them to prove output contains none. */
  sensitiveValues: string[];
  /** Every request sent, in order. Written with `pyx run --requests` and shown in the HTML report. */
  requests: RequestRecord[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

interface Row {
  id: string;
  owner: string;
  marker: string;
}

type ParsedRows = { ok: true; rows: Row[] } | { ok: false };

type Response200 = Extract<HttpOutcome, { kind: 'response' }>;

function isJson(outcome: Response200): boolean {
  return outcome.contentType !== null && /^application\/(?:[a-z.+-]*\+)?json\b/i.test(outcome.contentType);
}

/**
 * Rows from a PostgREST response. The Data API always returns an array; an RPC
 * function may also return a single row object or null (no row).
 */
function parseRows(outcome: Response200, r: RuleContent['resource'], allowSingle = false): ParsedRows {
  if (!isJson(outcome)) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.body);
  } catch {
    return { ok: false };
  }
  if (allowSingle && parsed === null) parsed = [];
  else if (allowSingle && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) parsed = [parsed];
  if (!Array.isArray(parsed)) return { ok: false };
  const rows: Row[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false };
    const rec = item as Record<string, unknown>;
    const id = rec[r.idColumn];
    const owner = rec[r.ownerColumn];
    const marker = rec[r.markerColumn];
    if (typeof id !== 'string' || typeof owner !== 'string' || typeof marker !== 'string') return { ok: false };
    rows.push({ id: id.toLowerCase(), owner: owner.toLowerCase(), marker });
  }
  return { ok: true, rows };
}

function transportDiagnostic(code: TransportFailureCode): DiagnosticCode {
  return code;
}

function statusDiagnostic(status: number): DiagnosticCode {
  if (status === 401) return 'auth_rejected';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'http_status_unexpected';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `token` occurs in `body` as a whole word (not inside a longer id or marker). */
export function mentions(body: string, token: string, caseInsensitive = false): boolean {
  if (token === '') return false;
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(token)}(?![A-Za-z0-9_-])`, caseInsensitive ? 'i' : '').test(body);
}

function isPostgrestPermissionDenied(outcome: Response200, statuses: readonly number[] = [403]): boolean {
  if (!statuses.includes(outcome.status)) return false;
  try {
    const body: unknown = JSON.parse(outcome.body);
    return body !== null && typeof body === 'object' && (body as { code?: unknown }).code === '42501';
  } catch {
    return false;
  }
}

function buildReadUrl(origin: string, r: RuleContent['resource'], fixtureIds: string[]): URL {
  for (const ident of [r.table, r.idColumn, r.ownerColumn, r.markerColumn, r.schema]) {
    if (!IDENT.test(ident)) throw new Error('identifier failed validation');
  }
  for (const id of fixtureIds) if (!UUID.test(id)) throw new Error('fixture id failed validation');
  const url = new URL(`/rest/v1/${r.table}`, origin);
  url.searchParams.set('select', `${r.idColumn},${r.ownerColumn},${r.markerColumn}`);
  if (fixtureIds.length === 1) {
    url.searchParams.set(r.idColumn, `eq.${fixtureIds[0]}`);
    url.searchParams.set('limit', '2');
  } else {
    url.searchParams.set(r.idColumn, `in.(${fixtureIds.join(',')})`);
    url.searchParams.set('limit', String(fixtureIds.length + 1));
  }
  return url;
}

function profileHeaders(r: RuleContent['resource']): Record<string, string> {
  return r.schema === 'public' ? {} : { 'Accept-Profile': r.schema };
}

function buildRpcUrl(origin: string, p: Extract<ExtraPath, { kind: 'rpc' }>, fixtureId: string): URL {
  if (!IDENT.test(p.function) || !IDENT.test(p.idArg)) throw new Error('identifier failed validation');
  if (!UUID.test(fixtureId)) throw new Error('fixture id failed validation');
  const url = new URL(`/rest/v1/rpc/${p.function}`, origin);
  url.searchParams.set(p.idArg, fixtureId);
  return url;
}

function buildHttpUrl(p: Extract<ExtraPath, { kind: 'http' }>, fixtureId: string): URL {
  if (!UUID.test(fixtureId)) throw new Error('fixture id failed validation');
  if (!/^\/[A-Za-z0-9._~/-]*\{id\}[A-Za-z0-9._~/-]*$/.test(p.pathTemplate)) throw new Error('path template failed validation');
  return new URL(p.pathTemplate.replace('{id}', fixtureId), p.origin);
}

/** A request path as reported in the result. The Data API route is always first. */
export interface PlannedPath {
  id: string;
  kind: 'data-api' | 'rpc' | 'http';
  route: string;
  spec: ExtraPath | null;
}

export function plannedPaths(content: RuleContent): PlannedPath[] {
  const out: PlannedPath[] = [{ id: 'data-api', kind: 'data-api', route: `/rest/v1/${content.resource.table}`, spec: null }];
  for (const p of content.paths ?? []) {
    out.push({
      id: p.id,
      kind: p.kind,
      route: p.kind === 'rpc' ? `/rest/v1/rpc/${p.function}` : `${p.origin}${p.pathTemplate}`,
      spec: p,
    });
  }
  return out;
}

/** Every origin a run of this rule may contact: the Supabase origin plus approved application routes. */
export function approvedOrigins(content: RuleContent): string[] {
  const set = new Set<string>([content.target.allowedOrigin]);
  for (const p of content.paths ?? []) if (p.kind === 'http') set.add(p.origin);
  return [...set];
}

export async function executeRun(ctx: RunContext): Promise<RunOutput> {
  const startedAt = ctx.now();
  const controls: ControlResult[] = [];
  const sensitive: string[] = [];
  const ledger: RequestRecord[] = [];
  const send = async (purpose: RequestRecord['purpose'], as: string, path: string | null, req: { url: URL; headers: Record<string, string> }) => {
    const t0 = performance.now();
    const out = await ctx.transport.send(req);
    ledger.push({
      n: ledger.length + 1,
      purpose,
      as,
      path,
      method: 'GET',
      url: `${req.url.origin}${req.url.pathname}${req.url.search}`,
      status: out.status,
      failure: out.kind === 'failure' ? out.code : null,
      bytes: out.kind === 'response' ? Buffer.byteLength(out.body, 'utf8') : 0,
      ms: Math.round(performance.now() - t0),
    });
    return out;
  };

  const finish = (assertions: AssertionResult[], content: RuleContent | null): RunOutput => {
    const finishedAt = ctx.now();
    const paths = content ? plannedPaths(content) : [];
    const required = content ? content.expectations.length * paths.length : 0;
    const rev = ctx.baseline?.revision ?? null;
    const result: RunResult = {
      kind: 'RunResult',
      schemaVersion: 1,
      runId: ctx.runId,
      rule: {
        ruleId: rev?.ruleId ?? ctx.baselineFailure?.ruleId ?? 'unknown',
        revision: rev?.revision ?? null,
        contentHash: rev?.contentHash ?? null,
      },
      runner: { name: 'pyx-runner', version: ctx.runnerVersion },
      source: ctx.source,
      scope: content?.scope ?? null,
      target: {
        origin: content?.target.allowedOrigin ?? null,
        environmentClass: content?.target.environmentClass ?? null,
        transport: 'supabase-data-api-rest-v1',
      },
      observedAt: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
      paths: paths.map((p) => ({ id: p.id, kind: p.kind, route: p.route })),
      limits: ctx.limits,
      controls,
      assertions,
      summary: summarize(assertions, controls, required),
      freshness: { state: 'unknown', reason: 'no_dependency_observer', dependencies: [] },
      provenance: { approvalLevel: rev?.approval.provenance.level ?? null, executionContext: ctx.executionContext },
    };
    return { result, sensitiveValues: sensitive, requests: ledger };
  };

  const assertionFor = (
    e: Expectation,
    path: string,
    status: AssertionResult['status'],
    diagnostic: DiagnosticCode,
    observation: Observation = 'not_requested',
    httpStatus: number | null = null,
  ): AssertionResult => ({
    id: e.id,
    path,
    actorRef: e.actorRef,
    fixtureRef: e.fixtureRef,
    expected: e.expected,
    status,
    observation,
    diagnostic,
    httpStatus,
  });

  // ---- 1. Baseline ---------------------------------------------------------
  if (!ctx.baseline) {
    controls.push({ id: 'baseline', status: 'failed', diagnostic: ctx.baselineFailure?.diagnostic ?? 'baseline_invalid' });
    return finish([], null);
  }
  const content = ctx.baseline.revision.content;
  const paths = plannedPaths(content);
  controls.push({ id: 'baseline', status: 'ok', diagnostic: 'ok' });
  const everyCell = (status: AssertionResult['status'], diag: DiagnosticCode): AssertionResult[] =>
    paths.flatMap((p) => content.expectations.map((e) => assertionFor(e, p.id, status, diag)));
  const blockAll = (diag: DiagnosticCode): RunOutput => finish(everyCell('blocked', diag), content);

  // ---- 2. Supported scope --------------------------------------------------
  const semantic = checkRuleContentSemantics(content);
  const unsupported = semantic.filter((i) => i.severity === 'unsupported' || i.severity === 'error');
  if (unsupported.length > 0) {
    const first = unsupported[0]!;
    const known: DiagnosticCode[] = [
      'unsupported_operation',
      'unsupported_ownership_model',
      'unsupported_route',
      'unsupported_environment_class',
      'unsupported_expectation',
      'unsupported_path',
    ];
    const diag = (known as string[]).includes(first.code) ? (first.code as DiagnosticCode) : 'unsupported_rule';
    controls.push({ id: 'target', status: 'not_run', diagnostic: 'not_executed' });
    return finish(everyCell('not_assessed', diag), content);
  }

  // ---- 3. Target -----------------------------------------------------------
  const approvedOrigin = parseExactOrigin(content.target.allowedOrigin);
  const supplied = ctx.targetUrl === undefined ? null : parseExactOrigin(ctx.targetUrl.replace(/\/+$/, ''));
  if (!approvedOrigin.ok || !supplied || !supplied.ok || supplied.value.origin !== approvedOrigin.value.origin) {
    controls.push({ id: 'target', status: 'failed', diagnostic: 'origin_mismatch' });
    return blockAll('target_unverified');
  }
  if (content.target.environmentClass === 'local-disposable') {
    const routeOrigins = (content.paths ?? []).flatMap((p) => (p.kind === 'http' ? [parseExactOrigin(p.origin)] : []));
    if (!approvedOrigin.value.isLoopback || routeOrigins.some((o) => !o.ok || !o.value.isLoopback)) {
      controls.push({ id: 'target', status: 'failed', diagnostic: 'origin_not_loopback' });
      return blockAll('target_unverified');
    }
  }
  const origin = content.target.allowedOrigin;
  const expectedIssuer = `${origin}/auth/v1`;

  // ---- 4. API key ----------------------------------------------------------
  const apiKey = ctx.env[content.target.apiKey.credential.name];
  if (apiKey) sensitive.push(apiKey);
  let apiKeyDiag: DiagnosticCode = 'ok';
  if (!apiKey) apiKeyDiag = 'api_key_missing';
  else if (!isHeaderSafe(apiKey)) apiKeyDiag = 'api_key_wrong_class';
  else {
    const cls = classifyApiKey(apiKey);
    if (isElevated(cls)) apiKeyDiag = 'api_key_elevated';
    else if (cls !== content.target.apiKey.kind) apiKeyDiag = 'api_key_wrong_class';
  }
  if (apiKeyDiag !== 'ok' || !apiKey) {
    controls.push({ id: 'target', status: 'ok', diagnostic: 'ok' });
    controls.push({ id: 'api-key', status: 'failed', diagnostic: apiKeyDiag });
    return blockAll('target_unverified');
  }
  const appHeaders = (bearer: string | null): Record<string, string> => {
    const h: Record<string, string> = { apikey: apiKey, Accept: 'application/json' };
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    return h;
  };
  // The legacy anon key is a JWT and was historically also sent as the bearer for anonymous requests.
  const anonBearer = content.target.apiKey.kind === 'legacy-anon' ? apiKey : null;

  // ---- 5. Fixture verification via setup channel ---------------------------
  const fixtureVerified = new Map<string, boolean>();
  const authActors = content.actors.filter((a): a is AuthenticatedActor => a.kind === 'authenticated');
  const anonActors = content.actors.filter((a) => a.kind === 'anonymous');
  const actorByRef = new Map(content.actors.map((a) => [a.ref, a] as const));
  const ownerUserId = (f: Fixture): string => (actorByRef.get(f.ownerRef) as AuthenticatedActor).expectedUserId;

  const setupKey = ctx.env[content.target.fixtureVerification.credential.name];
  if (setupKey) sensitive.push(setupKey);
  let setupDiag: DiagnosticCode = 'ok';
  if (!setupKey) setupDiag = 'setup_key_missing';
  else if (!isHeaderSafe(setupKey) || !isElevated(classifyApiKey(setupKey))) setupDiag = 'setup_key_wrong_class';

  controls.push({ id: 'target', status: 'ok', diagnostic: 'ok' });
  controls.push({ id: 'api-key', status: 'ok', diagnostic: 'ok' });
  controls.push({ id: 'setup-key', status: setupDiag === 'ok' ? 'ok' : 'failed', diagnostic: setupDiag });

  /** Read every fixture through the setup channel; returns a per-fixture verdict. */
  const readFixtures = async (key: string, purpose: 'fixture-check' | 'fixture-recheck'): Promise<Map<string, DiagnosticCode>> => {
    const verdict = new Map<string, DiagnosticCode>();
    const all = (d: DiagnosticCode) => {
      for (const f of content.fixtures) verdict.set(f.ref, d);
      return verdict;
    };
    const headers: Record<string, string> = { apikey: key, Accept: 'application/json', ...profileHeaders(content.resource) };
    // Legacy service_role keys are JWTs and must also be sent as the bearer.
    if (classifyApiKey(key) === 'legacy-service-role') headers.Authorization = `Bearer ${key}`;
    const out = await send(purpose, 'setup-key', null, { url: buildReadUrl(origin, content.resource, content.fixtures.map((f) => f.id)), headers });
    if (out.kind === 'failure') return all(transportDiagnostic(out.code));
    if (out.status !== 200) return all(statusDiagnostic(out.status));
    const parsed = parseRows(out, content.resource);
    if (!parsed.ok || parsed.rows.length > content.fixtures.length) return all('response_malformed');
    for (const f of content.fixtures) {
      const row = parsed.rows.find((x) => x.id === f.id);
      if (!row) verdict.set(f.ref, 'fixture_missing');
      else if (row.owner !== ownerUserId(f)) verdict.set(f.ref, 'fixture_owner_mismatch');
      else if (row.marker !== f.marker) verdict.set(f.ref, 'fixture_marker_mismatch');
      else verdict.set(f.ref, 'ok');
    }
    return verdict;
  };

  if (setupDiag !== 'ok' || !setupKey) {
    for (const f of content.fixtures) {
      controls.push({ id: `fixture:${f.ref}`, status: 'not_run', diagnostic: 'setup_key_missing' });
      fixtureVerified.set(f.ref, false);
    }
  } else {
    const verdict = await readFixtures(setupKey, 'fixture-check');
    for (const f of content.fixtures) {
      const d = verdict.get(f.ref)!;
      controls.push({ id: `fixture:${f.ref}`, status: d === 'ok' ? 'ok' : 'failed', diagnostic: d });
      fixtureVerified.set(f.ref, d === 'ok');
    }
  }

  // ---- 6. Identity verification -------------------------------------------
  const tokens = new Map<string, string>();
  const verifiedUserIds = new Map<string, string>();
  for (const actor of authActors) {
    const token = ctx.env[actor.credential.name];
    if (token) sensitive.push(token);
    const control = (status: ControlResult['status'], diagnostic: DiagnosticCode) =>
      controls.push({ id: `identity:${actor.ref}`, status, diagnostic });
    if (!token) {
      control('failed', 'token_missing');
      continue;
    }
    const pre = precheckUserToken(token);
    if (!pre.ok) {
      control('failed', pre.code);
      continue;
    }
    const out = await send('identity', actor.ref, null, { url: new URL('/auth/v1/user', origin), headers: appHeaders(token) });
    if (out.kind === 'failure') {
      control('failed', transportDiagnostic(out.code));
      continue;
    }
    if (out.status === 401 || out.status === 403) {
      control('failed', 'token_rejected_by_auth');
      continue;
    }
    if (out.status !== 200) {
      control('failed', statusDiagnostic(out.status));
      continue;
    }
    let user: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(out.body);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) user = parsed as Record<string, unknown>;
    } catch {
      user = null;
    }
    if (!user || typeof user.id !== 'string') {
      control('failed', 'response_malformed');
      continue;
    }
    if (user.id.toLowerCase() !== actor.expectedUserId) {
      control('failed', 'user_id_mismatch');
      continue;
    }
    if (user.is_anonymous === true) {
      control('failed', 'token_anonymous_user');
      continue;
    }
    // Claims are read only now, after this target's Auth service accepted the token.
    const claims = decodeJwtUnverified(token)?.payload ?? {};
    if (claims.iss !== expectedIssuer || claims.sub !== user.id) {
      control('failed', 'token_issuer_mismatch');
      continue;
    }
    const exp = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;
    if (exp - ctx.now().getTime() < MIN_TOKEN_REMAINING_MS) {
      control('failed', 'token_expired_or_expiring');
      continue;
    }
    control('ok', 'ok');
    tokens.set(actor.ref, token);
    verifiedUserIds.set(actor.ref, user.id.toLowerCase());
  }

  // ---- 6b. Distinct identities --------------------------------------------
  const seen = new Map<string, string>();
  let distinct = true;
  for (const [ref, id] of verifiedUserIds) {
    if (seen.has(id)) {
      distinct = false;
      tokens.delete(ref);
      tokens.delete(seen.get(id)!);
    } else seen.set(id, ref);
  }
  const allVerified = authActors.every((a) => tokens.has(a.ref));
  controls.push({
    id: 'actors-distinct',
    status: !distinct ? 'failed' : allVerified ? 'ok' : 'not_run',
    diagnostic: !distinct ? 'actors_not_distinct' : allVerified ? 'ok' : 'actor_unverified',
  });

  // ---- 6c. Anonymous context ------------------------------------------------
  // The anonymous headers must not identify a user. Auth must refuse them.
  let anonymousOk = false;
  if (anonActors.length > 0) {
    const out = await send('anonymous-context', anonActors[0]!.ref, null, { url: new URL('/auth/v1/user', origin), headers: appHeaders(anonBearer) });
    let diag: DiagnosticCode;
    if (out.kind === 'failure') diag = transportDiagnostic(out.code);
    else if (out.status === 401 || out.status === 403) diag = 'ok';
    else if (out.status === 200) diag = 'anonymous_context_invalid';
    else diag = statusDiagnostic(out.status);
    anonymousOk = diag === 'ok';
    for (const a of anonActors) controls.push({ id: `identity:${a.ref}`, status: anonymousOk ? 'ok' : 'failed', diagnostic: diag });
  }

  // ---- 7. Reads, path by path ----------------------------------------------
  const fixtureByRef = new Map(content.fixtures.map((f) => [f.ref, f] as const));
  const results: AssertionResult[] = [];

  for (const path of paths) {
    const ownerControlPassed = new Set<string>();
    const pathResults = new Map<string, AssertionResult>();

    const read = async (e: Expectation): Promise<AssertionResult> => {
      const at = (
        status: AssertionResult['status'],
        diagnostic: DiagnosticCode,
        observation: Observation = 'not_requested',
        httpStatus: number | null = null,
      ) => assertionFor(e, path.id, status, diagnostic, observation, httpStatus);
      const actor = actorByRef.get(e.actorRef)!;
      const fixture = fixtureByRef.get(e.fixtureRef)!;
      let bearer: string | null;
      if (actor.kind === 'authenticated') {
        const t = tokens.get(actor.ref);
        if (!t) return at('blocked', distinct ? 'actor_unverified' : 'actors_not_distinct');
        bearer = t;
      } else {
        if (!anonymousOk) return at('blocked', 'anonymous_context_invalid');
        bearer = anonBearer; // anonymous: no user token, no inherited session
      }

      const spec = path.spec;
      let url: URL;
      let headers: Record<string, string>;
      if (spec === null) {
        url = buildReadUrl(origin, content.resource, [fixture.id]);
        headers = { ...appHeaders(bearer), ...profileHeaders(content.resource) };
      } else if (spec.kind === 'rpc') {
        url = buildRpcUrl(origin, spec, fixture.id);
        headers = { ...appHeaders(bearer), ...profileHeaders(content.resource) };
      } else {
        // Application route: the user's access token only. Supabase keys never leave the Supabase origin.
        url = buildHttpUrl(spec, fixture.id);
        headers = { Accept: 'application/json' };
        if (actor.kind === 'authenticated') headers.Authorization = `Bearer ${bearer}`;
      }

      const out = await send('read', actor.ref, path.id, { url, headers });
      if (out.kind === 'failure') return at('blocked', transportDiagnostic(out.code), 'no_response', out.status);
      const fixtureOk = fixtureVerified.get(fixture.ref) === true;
      const isOwnerRead = e.expected === 'exact_fixture_returned';
      const success = out.status >= 200 && out.status < 300;
      const hasMarker = mentions(out.body, fixture.marker);
      const hasId = mentions(out.body, fixture.id, true);

      if (!isOwnerRead && fixtureOk) {
        // The fixture is verified as another user's record, so any trace of it is a disclosure:
        // its marker anywhere, or its id in a success response. This does not depend on owner controls.
        if (hasMarker) {
          return at('failed', 'fixture_disclosed', hasId ? 'exact_fixture_returned' : 'fixture_returned_inconsistent', out.status);
        }
        if (success && hasId) return at('failed', 'fixture_disclosed', 'fixture_returned_inconsistent', out.status);
      }

      let denied: boolean;
      if (spec !== null && spec.kind === 'http') {
        if (isOwnerRead) {
          if (out.status === 200 && hasMarker && hasId) {
            return fixtureOk ? at('passed', 'ok', 'exact_fixture_returned', 200) : at('blocked', 'fixture_unverified', 'exact_fixture_returned', 200);
          }
          if (out.status === 200 && (hasMarker || hasId)) return at('blocked', 'fixture_returned_inconsistent', 'fixture_returned_inconsistent', 200);
          if (out.status === 200) {
            return fixtureOk ? at('failed', 'owner_read_returned_no_rows', 'no_rows', 200) : at('blocked', 'fixture_unverified', 'no_rows', 200);
          }
          if (spec.deniedStatuses.includes(out.status as 200)) {
            return fixtureOk
              ? at('failed', 'owner_read_forbidden', 'error_response', out.status)
              : at('blocked', 'fixture_unverified', 'error_response', out.status);
          }
          return at('blocked', statusDiagnostic(out.status), 'error_response', out.status);
        }
        if (!spec.deniedStatuses.includes(out.status as 200)) {
          return at('blocked', statusDiagnostic(out.status), 'error_response', out.status);
        }
        denied = true;
      } else {
        // PostgREST: the Data API or an RPC function.
        const isRpc = spec !== null;
        if (out.status !== 200) {
          if (isOwnerRead && isPostgrestPermissionDenied(out, isRpc ? [401, 403] : [403])) {
            return fixtureOk
              ? at('failed', 'owner_read_forbidden', 'error_response', out.status)
              : at('blocked', 'fixture_unverified', 'error_response', out.status);
          }
          // A function that raises insufficient_privilege for a non-owner is a denial.
          if (!isOwnerRead && isRpc && isPostgrestPermissionDenied(out, [401, 403])) denied = true;
          else return at('blocked', statusDiagnostic(out.status), 'error_response', out.status);
        } else {
          const parsed = parseRows(out, content.resource, isRpc);
          if (!parsed.ok) return at('blocked', 'response_malformed', 'error_response', out.status);
          const { rows } = parsed;
          const match = rows.find((r) => r.id === fixture.id);
          const exact = match !== undefined && match.owner === ownerUserId(fixture) && match.marker === fixture.marker;
          if (isOwnerRead) {
            if (rows.length === 0) {
              return fixtureOk ? at('failed', 'owner_read_returned_no_rows', 'no_rows', 200) : at('blocked', 'fixture_unverified', 'no_rows', 200);
            }
            if (rows.length === 1 && exact) {
              return fixtureOk ? at('passed', 'ok', 'exact_fixture_returned', 200) : at('blocked', 'fixture_unverified', 'exact_fixture_returned', 200);
            }
            if (match) return at('blocked', 'fixture_returned_inconsistent', 'fixture_returned_inconsistent', 200);
            return at('blocked', 'unexpected_rows', 'unexpected_rows', 200);
          }
          // Exactly the declared record (id, declared owner, marker) is a disclosure even when
          // fixture verification failed: the response itself proves whose row it is.
          if (exact) return at('failed', 'fixture_disclosed', 'exact_fixture_returned', 200);
          if (match) return at('blocked', 'fixture_returned_inconsistent', 'fixture_returned_inconsistent', 200);
          if (rows.length > 0) return at('blocked', 'unexpected_rows', 'unexpected_rows', 200);
          denied = true;
        }
      }

      // Denial observed: it counts only if every dependency held on this path.
      const observation: Observation = out.status === 200 ? 'no_rows' : 'error_response';
      if (!denied) return at('blocked', 'http_status_unexpected', observation, out.status);
      if (!fixtureOk) return at('blocked', 'fixture_unverified', observation, out.status);
      if (!ownerControlPassed.has(fixture.ref)) return at('blocked', 'owner_control_not_passed', observation, out.status);
      if (!distinct) return at('blocked', 'actors_not_distinct', observation, out.status);
      return at('passed', 'ok', observation, out.status);
    };

    // Owner reads first: they are the positive controls the denied reads on this path depend on.
    for (const e of content.expectations.filter((x) => x.expected === 'exact_fixture_returned')) {
      const r = await read(e);
      pathResults.set(e.id, r);
      if (r.status === 'passed') ownerControlPassed.add(e.fixtureRef);
    }
    for (const e of content.expectations.filter((x) => x.expected === 'fixture_not_disclosed')) {
      pathResults.set(e.id, await read(e));
    }
    for (const e of content.expectations) results.push(pathResults.get(e.id)!);
  }

  // ---- 8. Fixture stability ------------------------------------------------
  // A fixture deleted or re-owned mid-run turns a later empty read into a false denial.
  if (setupDiag === 'ok' && setupKey) {
    const verdict = await readFixtures(setupKey, 'fixture-recheck');
    // Only fixtures verified at the start can become unstable; the others already block their assertions.
    const unstable = content.fixtures.filter((f) => fixtureVerified.get(f.ref) === true).map((f) => verdict.get(f.ref)!).find((d) => d !== 'ok');
    const diag: DiagnosticCode = unstable === undefined ? 'ok' : unstable.startsWith('fixture_') ? 'fixture_unstable' : unstable;
    controls.push({ id: 'fixtures-stable', status: diag === 'ok' ? 'ok' : 'failed', diagnostic: diag });
    if (diag !== 'ok') {
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.status === 'passed') results[i] = { ...r, status: 'blocked', diagnostic: diag };
      }
    }
  } else {
    controls.push({ id: 'fixtures-stable', status: 'not_run', diagnostic: 'setup_key_missing' });
  }

  return finish(results, content);
}
