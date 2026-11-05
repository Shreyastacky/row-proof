/**
 * Semantic rules for RuleContent that JSON Schema cannot express: reference
 * integrity, a complete actor x fixture matrix, the supported v1 scope, and
 * defense-in-depth against credential values pasted into a rule.
 */
import { canonicalize } from './canonical.js';
import { parseExactOrigin } from './origin.js';
import type { AuthenticatedActor, RuleContent } from './types.generated.js';
import type { Issue } from './validate.js';

export const MAX_CANONICAL_RULE_BYTES = 32 * 1024;

/** Patterns for credential values that must never appear inside a rule or result. */
const CREDENTIAL_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, // JWT (Supabase legacy keys, user access tokens)
  /sb_secret_[A-Za-z0-9_-]{4,}/,
  /sb_publishable_[A-Za-z0-9_-]{4,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksLikeCredentialValue(text: string): boolean {
  return CREDENTIAL_VALUE_PATTERNS.some((p) => p.test(text));
}

function collectStrings(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}/${i}`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}/${k}`, out);
  }
}

/** Scan every string in a document for credential-shaped values. */
export function findCredentialValues(doc: unknown): Issue[] {
  const strings: Array<{ path: string; value: string }> = [];
  collectStrings(doc, '', strings);
  return strings
    .filter((s) => looksLikeCredentialValue(s.value))
    .map((s) => ({
      code: 'credential_value_in_document',
      path: s.path || '/',
      message: 'a credential-shaped value appears in the document; use an env credential reference instead',
      severity: 'error' as const,
    }));
}

function dupes<T>(items: T[]): Set<T> {
  const seen = new Set<T>();
  const d = new Set<T>();
  for (const it of items) (seen.has(it) ? d : seen).add(it);
  return d;
}

/**
 * Semantic validation. Assumes `content` already passed schema validation.
 * Returns issues with severity `error` (must fix) or `unsupported` (well-formed,
 * but outside what the v1 runner can assess).
 */
export function checkRuleContentSemantics(content: RuleContent): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: 'error' });
  const unsupported = (code: string, path: string, message: string) =>
    issues.push({ code, path, message, severity: 'unsupported' });

  issues.push(...findCredentialValues(content));

  // Size bound on the canonical form.
  if (Buffer.byteLength(canonicalize(content), 'utf8') > MAX_CANONICAL_RULE_BYTES) {
    err('rule_too_large', '/', `canonical rule exceeds ${MAX_CANONICAL_RULE_BYTES} bytes`);
  }

  // ---- Target --------------------------------------------------------------
  const origin = parseExactOrigin(content.target.allowedOrigin);
  if (!origin.ok) {
    err('origin_not_exact', '/target/allowedOrigin', `allowedOrigin must be exactly scheme://host[:port] (${origin.reason})`);
  } else if (content.target.environmentClass === 'local-disposable') {
    if (!origin.value.isLoopback) {
      err('origin_not_loopback', '/target/allowedOrigin', 'local-disposable targets must use a loopback host');
    }
    if (origin.value.scheme !== 'http' && origin.value.scheme !== 'https') {
      err('origin_not_exact', '/target/allowedOrigin', 'unsupported scheme');
    }
  }
  if (content.target.environmentClass !== 'local-disposable') {
    unsupported(
      'unsupported_environment_class',
      '/target/environmentClass',
      'only local-disposable targets are supported; remote non-production support needs separate implementation and tests',
    );
  }

  // ---- Resource ------------------------------------------------------------
  const r = content.resource;
  if (r.operation !== 'select') {
    unsupported('unsupported_operation', '/resource/operation', 'only select is supported in v1');
  }
  if (r.ownershipModel !== 'single-owner-column') {
    unsupported('unsupported_ownership_model', '/resource/ownershipModel', 'only single-owner-column ownership is supported in v1');
  }
  if (new Set([r.idColumn, r.ownerColumn, r.markerColumn]).size !== 3) {
    err('resource_columns_not_distinct', '/resource', 'idColumn, ownerColumn and markerColumn must be distinct');
  }

  // ---- Extra request paths -------------------------------------------------
  const extra = content.paths ?? [];
  for (const d of dupes(extra.map((p) => p.id))) err('duplicate_path_id', '/paths', `path id ${d} is declared more than once`);
  extra.forEach((p, i) => {
    if (p.id === 'data-api') err('reserved_path_id', `/paths/${i}/id`, "'data-api' is reserved for the resource's Data API route");
    if (p.kind === 'http') {
      const o = parseExactOrigin(p.origin);
      if (!o.ok) err('origin_not_exact', `/paths/${i}/origin`, `origin must be exactly scheme://host[:port] (${o.reason})`);
      else if (content.target.environmentClass === 'local-disposable' && !o.value.isLoopback) {
        err('origin_not_loopback', `/paths/${i}/origin`, 'application routes of a local-disposable rule must use a loopback host');
      }
      if (new Set(p.deniedStatuses).size !== p.deniedStatuses.length) {
        err('duplicate_denied_status', `/paths/${i}/deniedStatuses`, 'deniedStatuses must not repeat a status');
      }
    }
  });
  for (const d of dupes(extra.filter((p) => p.kind === 'rpc').map((p) => (p.kind === 'rpc' ? p.function : '')))) {
    err('duplicate_rpc_path', '/paths', `rpc function ${d} is listed more than once`);
  }

  // ---- Actors --------------------------------------------------------------
  const actorRefs = content.actors.map((a) => a.ref);
  for (const d of dupes(actorRefs)) err('duplicate_actor_ref', '/actors', `actor ref ${d} is declared more than once`);
  const authActors = content.actors.filter((a): a is AuthenticatedActor => a.kind === 'authenticated');
  const anonActors = content.actors.filter((a) => a.kind === 'anonymous');
  for (const d of dupes(authActors.map((a) => a.expectedUserId))) {
    err('duplicate_expected_user', '/actors', `two actors expect the same user id ${d}; identities must be distinct`);
  }
  const credentialNames = [
    content.target.apiKey.credential.name,
    content.target.fixtureVerification.credential.name,
    ...authActors.map((a) => a.credential.name),
  ];
  for (const d of dupes(credentialNames)) {
    err('duplicate_credential_ref', '/', `credential reference ${d} is used for more than one purpose`);
  }
  if (authActors.length < 2) {
    err('insufficient_actors', '/actors', 'at least two authenticated actors are required to assess isolation');
  }
  if (anonActors.length < 1) {
    err('anonymous_actor_required', '/actors', 'the v1 matrix requires an anonymous actor');
  }
  if (anonActors.length > 1) {
    err('duplicate_anonymous_actor', '/actors', 'declare at most one anonymous actor');
  }

  // ---- Fixtures ------------------------------------------------------------
  const actorByRef = new Map(content.actors.map((a) => [a.ref, a] as const));
  const fixtureRefs = content.fixtures.map((f) => f.ref);
  for (const d of dupes(fixtureRefs)) err('duplicate_fixture_ref', '/fixtures', `fixture ref ${d} is declared more than once`);
  for (const d of dupes(content.fixtures.map((f) => f.id))) err('duplicate_fixture_id', '/fixtures', `fixture id ${d} is reused`);
  for (const d of dupes(content.fixtures.map((f) => f.marker))) {
    err('duplicate_fixture_marker', '/fixtures', `fixture marker ${d} is reused`);
  }
  content.fixtures.forEach((f, i) => {
    const owner = actorByRef.get(f.ownerRef);
    if (!owner) err('unknown_owner_ref', `/fixtures/${i}/ownerRef`, `owner ${f.ownerRef} is not a declared actor`);
    else if (owner.kind !== 'authenticated') {
      err('owner_not_authenticated', `/fixtures/${i}/ownerRef`, 'a fixture owner must be an authenticated actor');
    }
  });
  const owners = new Set(content.fixtures.map((f) => f.ownerRef));
  if (owners.size < 2 && content.fixtures.length > 0) {
    err('insufficient_owners', '/fixtures', 'fixtures must belong to at least two distinct authenticated actors');
  }

  // ---- Expectations / matrix ----------------------------------------------
  const fixtureByRef = new Map(content.fixtures.map((f) => [f.ref, f] as const));
  for (const d of dupes(content.expectations.map((e) => e.id))) {
    err('duplicate_expectation_id', '/expectations', `expectation id ${d} is reused`);
  }
  const cells = new Map<string, number>();
  content.expectations.forEach((e, i) => {
    const path = `/expectations/${i}`;
    const actor = actorByRef.get(e.actorRef);
    const fixture = fixtureByRef.get(e.fixtureRef);
    if (!actor) err('unknown_actor_ref', `${path}/actorRef`, `actor ${e.actorRef} is not declared`);
    if (!fixture) err('unknown_fixture_ref', `${path}/fixtureRef`, `fixture ${e.fixtureRef} is not declared`);
    const key = `${e.actorRef}\u0000${e.fixtureRef}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    if (actor && fixture && r.ownershipModel === 'single-owner-column') {
      const derived = actor.ref === fixture.ownerRef ? 'exact_fixture_returned' : 'fixture_not_disclosed';
      if (e.expected !== derived) {
        unsupported(
          'unsupported_expectation',
          `${path}/expected`,
          `under single-owner ownership ${e.actorRef} reading ${e.fixtureRef} must be ${derived}; shared or delegated access is not supported in v1`,
        );
      }
    }
  });
  for (const [key, count] of cells) {
    if (count > 1) {
      const [a, f] = key.split('\u0000');
      err('matrix_duplicate_cell', '/expectations', `${a} -> ${f} has ${count} expectations`);
    }
  }
  for (const a of content.actors) {
    for (const f of content.fixtures) {
      if (!cells.has(`${a.ref}\u0000${f.ref}`)) {
        err('matrix_incomplete', '/expectations', `missing expectation for ${a.ref} reading ${f.ref}`);
      }
    }
  }

  return issues;
}
