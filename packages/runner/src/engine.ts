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
 *   7. Owner reads (positive controls) with exact id/owner/marker checks.
 *   8. Denied reads by exact fixture id. No owner filter is ever added, so an
 *      exposed row cannot be hidden by the query itself.
 *
 * A concrete disclosure of a forbidden fixture is always `failed`, even when
 * other controls are blocked. An empty result is a denial pass only when every
 * control it depends on succeeded.
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
  type Observation,
  type RuleContent,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@ship-safe/contracts';
import { classifyApiKey, decodeJwtUnverified, isElevated, isHeaderSafe, precheckUserToken } from './credentials.js';
import type { HttpOutcome, Transport, TransportFailureCode } from './transport.js';

export const DEFAULT_LIMITS: RunLimits = {
  maxRequests: 32,
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
  sourceCommit: string | null;
  executionContext: RunResult['provenance']['executionContext'];
  runnerVersion: string;
  runId: string;
  now: () => Date;
}

export interface RunOutput {
  result: RunResult;
  /** Credential values loaded for this run; callers use them to prove output contains none. */
  sensitiveValues: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

interface Row {
  id: string;
  owner: string;
  marker: string;
}

type ParsedRows = { ok: true; rows: Row[] } | { ok: false };

function parseRows(outcome: Extract<HttpOutcome, { kind: 'response' }>, r: RuleContent['resource']): ParsedRows {
  if (!outcome.contentType || !/^application\/(?:[a-z.+-]*\+)?json\b/i.test(outcome.contentType)) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.body);
  } catch {
    return { ok: false };
  }
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

function isPostgrestPermissionDenied(outcome: Extract<HttpOutcome, { kind: 'response' }>): boolean {
  if (outcome.status !== 403) return false;
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

export async function executeRun(ctx: RunContext): Promise<RunOutput> {
  const startedAt = ctx.now();
  const controls: ControlResult[] = [];
  const sensitive: string[] = [];

  const finish = (assertions: AssertionResult[], content: RuleContent | null): RunOutput => {
    const finishedAt = ctx.now();
    const required = content ? content.expectations.length : 0;
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
      runner: { name: 'ship-safe-runner', version: ctx.runnerVersion },
      source: { commit: ctx.sourceCommit },
      scope: content?.scope ?? null,
      target: {
        origin: content?.target.allowedOrigin ?? null,
        environmentClass: content?.target.environmentClass ?? null,
        transport: 'supabase-data-api-rest-v1',
      },
      observedAt: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
      limits: ctx.limits,
      controls,
      assertions,
      summary: summarize(assertions, controls, required),
      freshness: { state: 'unknown', reason: 'no_dependency_observer', dependencies: [] },
      provenance: { approvalLevel: rev?.approval.provenance.level ?? null, executionContext: ctx.executionContext },
    };
    return { result, sensitiveValues: sensitive };
  };

  const assertionFor = (
    e: Expectation,
    status: AssertionResult['status'],
    diagnostic: DiagnosticCode,
    observation: Observation = 'not_requested',
    httpStatus: number | null = null,
  ): AssertionResult => ({
    id: e.id,
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
  controls.push({ id: 'baseline', status: 'ok', diagnostic: 'ok' });
  const blockAll = (diag: DiagnosticCode): RunOutput =>
    finish(content.expectations.map((e) => assertionFor(e, 'blocked', diag)), content);

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
    ];
    const diag = (known as string[]).includes(first.code) ? (first.code as DiagnosticCode) : 'unsupported_rule';
    controls.push({ id: 'target', status: 'not_run', diagnostic: 'not_executed' });
    return finish(content.expectations.map((e) => assertionFor(e, 'not_assessed', diag)), content);
  }

  // ---- 3. Target -----------------------------------------------------------
  const approvedOrigin = parseExactOrigin(content.target.allowedOrigin);
  const supplied = ctx.targetUrl === undefined ? null : parseExactOrigin(ctx.targetUrl.replace(/\/+$/, ''));
  if (!approvedOrigin.ok || !supplied || !supplied.ok || supplied.value.origin !== approvedOrigin.value.origin) {
    controls.push({ id: 'target', status: 'failed', diagnostic: 'origin_mismatch' });
    return blockAll('target_unverified');
  }
  if (content.target.environmentClass === 'local-disposable' && !approvedOrigin.value.isLoopback) {
    controls.push({ id: 'target', status: 'failed', diagnostic: 'origin_not_loopback' });
    return blockAll('target_unverified');
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

  const fixtureControl = (f: Fixture, status: ControlResult['status'], diagnostic: DiagnosticCode) => {
    controls.push({ id: `fixture:${f.ref}`, status, diagnostic });
    fixtureVerified.set(f.ref, status === 'ok');
  };

  if (setupDiag !== 'ok' || !setupKey) {
    for (const f of content.fixtures) fixtureControl(f, 'not_run', 'setup_key_missing');
  } else {
    const headers: Record<string, string> = { apikey: setupKey, Accept: 'application/json', ...profileHeaders(content.resource) };
    // Legacy service_role keys are JWTs and must also be sent as the bearer.
    if (classifyApiKey(setupKey) === 'legacy-service-role') headers.Authorization = `Bearer ${setupKey}`;
    const out = await ctx.transport.send({ url: buildReadUrl(origin, content.resource, content.fixtures.map((f) => f.id)), headers });
    if (out.kind === 'failure') {
      for (const f of content.fixtures) fixtureControl(f, 'failed', transportDiagnostic(out.code));
    } else if (out.status !== 200) {
      for (const f of content.fixtures) fixtureControl(f, 'failed', statusDiagnostic(out.status));
    } else {
      const parsed = parseRows(out, content.resource);
      if (!parsed.ok || parsed.rows.length > content.fixtures.length) {
        for (const f of content.fixtures) fixtureControl(f, 'failed', 'response_malformed');
      } else {
        for (const f of content.fixtures) {
          const row = parsed.rows.find((x) => x.id === f.id);
          if (!row) fixtureControl(f, 'failed', 'fixture_missing');
          else if (row.owner !== ownerUserId(f)) fixtureControl(f, 'failed', 'fixture_owner_mismatch');
          else if (row.marker !== f.marker) fixtureControl(f, 'failed', 'fixture_marker_mismatch');
          else fixtureControl(f, 'ok', 'ok');
        }
      }
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
    const out = await ctx.transport.send({ url: new URL('/auth/v1/user', origin), headers: appHeaders(token) });
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

  // ---- 7/8. Reads ----------------------------------------------------------
  const fixtureByRef = new Map(content.fixtures.map((f) => [f.ref, f] as const));
  const ownerControlPassed = new Map<string, boolean>();
  const results = new Map<string, AssertionResult>();

  const read = async (e: Expectation): Promise<AssertionResult> => {
    const actor = actorByRef.get(e.actorRef)!;
    const fixture = fixtureByRef.get(e.fixtureRef)!;
    let bearer: string | null;
    if (actor.kind === 'authenticated') {
      const t = tokens.get(actor.ref);
      if (!t) return assertionFor(e, 'blocked', distinct ? 'actor_unverified' : 'actors_not_distinct');
      bearer = t;
    } else {
      bearer = anonBearer; // anonymous: no user token, no inherited session
    }
    const out = await ctx.transport.send({
      url: buildReadUrl(origin, content.resource, [fixture.id]),
      headers: { ...appHeaders(bearer), ...profileHeaders(content.resource) },
    });
    if (out.kind === 'failure') {
      return assertionFor(e, 'blocked', transportDiagnostic(out.code), 'no_response', out.status);
    }
    const fixtureOk = fixtureVerified.get(fixture.ref) === true;
    const isOwnerRead = e.expected === 'exact_fixture_returned';

    if (out.status !== 200) {
      if (isOwnerRead && isPostgrestPermissionDenied(out)) {
        return fixtureOk
          ? assertionFor(e, 'failed', 'owner_read_forbidden', 'error_response', out.status)
          : assertionFor(e, 'blocked', 'fixture_unverified', 'error_response', out.status);
      }
      return assertionFor(e, 'blocked', statusDiagnostic(out.status), 'error_response', out.status);
    }
    const parsed = parseRows(out, content.resource);
    if (!parsed.ok) return assertionFor(e, 'blocked', 'response_malformed', 'error_response', out.status);
    const { rows } = parsed;
    const match = rows.find((r) => r.id === fixture.id);
    const exact = match !== undefined && match.owner === ownerUserId(fixture) && match.marker === fixture.marker;

    if (isOwnerRead) {
      if (rows.length === 0) {
        return fixtureOk
          ? assertionFor(e, 'failed', 'owner_read_returned_no_rows', 'no_rows', 200)
          : assertionFor(e, 'blocked', 'fixture_unverified', 'no_rows', 200);
      }
      if (rows.length === 1 && exact) {
        return fixtureOk
          ? assertionFor(e, 'passed', 'ok', 'exact_fixture_returned', 200)
          : assertionFor(e, 'blocked', 'fixture_unverified', 'exact_fixture_returned', 200);
      }
      if (match) return assertionFor(e, 'blocked', 'fixture_returned_inconsistent', 'fixture_returned_inconsistent', 200);
      return assertionFor(e, 'blocked', 'unexpected_rows', 'unexpected_rows', 200);
    }

    // Denied read.
    if (exact) {
      // Concrete disclosure: retained as failed regardless of other controls.
      return assertionFor(e, 'failed', 'fixture_disclosed', 'exact_fixture_returned', 200);
    }
    if (match) return assertionFor(e, 'blocked', 'fixture_returned_inconsistent', 'fixture_returned_inconsistent', 200);
    if (rows.length > 0) return assertionFor(e, 'blocked', 'unexpected_rows', 'unexpected_rows', 200);
    // Well-formed empty result: denial only if every dependency held.
    if (!fixtureOk) return assertionFor(e, 'blocked', 'fixture_unverified', 'no_rows', 200);
    if (ownerControlPassed.get(fixture.ref) !== true) return assertionFor(e, 'blocked', 'owner_control_not_passed', 'no_rows', 200);
    if (!distinct) return assertionFor(e, 'blocked', 'actors_not_distinct', 'no_rows', 200);
    return assertionFor(e, 'passed', 'ok', 'no_rows', 200);
  };

  // Owner reads first: they are the positive controls the denied reads depend on.
  for (const e of content.expectations.filter((x) => x.expected === 'exact_fixture_returned')) {
    const r = await read(e);
    results.set(e.id, r);
    if (r.status === 'passed') ownerControlPassed.set(e.fixtureRef, true);
  }
  for (const e of content.expectations.filter((x) => x.expected === 'fixture_not_disclosed')) {
    results.set(e.id, await read(e));
  }

  return finish(
    content.expectations.map((e) => results.get(e.id)!),
    content,
  );
}
