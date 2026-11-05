/**
 * PRIVILEGED, LOCAL-ONLY fixture setup. Uses the local stack's secret key and
 * the supported Auth admin API to (re)create synthetic users and invoices that
 * match a rule, signs each user in to obtain an access token, and independently
 * verifies identities and fixtures. Every SDK error is checked.
 *
 * This is setup tooling. The runner never calls it, and it never touches a
 * non-loopback target.
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedActor, RuleContent } from '@pyx/contracts';
import { assertLocalTarget, StackError, type StackInfo } from './stack.js';

const CLIENT_OPTS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export interface ProvisionResult {
  /** Environment entries for the runner. Values are credentials: write them only to a 0600 file. */
  env: Record<string, string>;
  users: Array<{ ref: string; id: string }>;
  fixtures: Array<{ ref: string; id: string; ownerId: string; marker: string }>;
}

export function syntheticEmail(ruleId: string, actorRef: string): string {
  return `${actorRef}.${ruleId}@synthetic.pyx.test`;
}

function fail(step: string, error: { status?: number | undefined; code?: string | undefined } | null): never {
  // Report the step and a status/code, not raw provider payloads.
  const detail = error ? [error.status, error.code].filter((x) => x !== undefined).join('/') : 'no data';
  const hints: Record<string, string> = {
    '23502': 'a required column has no value; pass --fixture-defaults <json> with values for the other NOT NULL columns',
    '23503': 'a foreign key is not satisfied; give the referenced columns valid values via --fixture-defaults',
    '23514': 'a CHECK constraint rejected the fixture; adjust --fixture-defaults or the marker column choice',
    '42501': 'the setup key lacks privileges on this table; grant select/insert/delete to service_role',
    '42P01': 'the table does not exist; apply your migrations to the local stack first',
    PGRST205: 'the table is not exposed by the Data API; check the name and [api] schemas',
  };
  const hint = error?.code ? hints[error.code] : undefined;
  throw new StackError(`${step} failed (${detail || 'error'})${hint ? `: ${hint}` : ''}`);
}

function authActors(rule: RuleContent): AuthenticatedActor[] {
  return rule.actors.filter((a): a is AuthenticatedActor => a.kind === 'authenticated');
}

async function verifyIdentity(stack: StackInfo, token: string, expectedId: string, ref: string): Promise<void> {
  // A fresh, isolated client per check: no shared session.
  const client = createClient(stack.apiUrl, stack.publishableKey, CLIENT_OPTS);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) fail(`getUser for ${ref}`, error);
  if (data.user.id !== expectedId) throw new StackError(`identity check failed for ${ref}: unexpected user id`);
}

export async function verifyFixtures(admin: SupabaseClient, rule: RuleContent): Promise<void> {
  const r = rule.resource;
  const ids = rule.fixtures.map((f) => f.id);
  const { data, error } = await admin.from(r.table).select(`${r.idColumn},${r.ownerColumn},${r.markerColumn}`).in(r.idColumn, ids);
  if (error || !data) fail('fixture verification read', error);
  const rows = data as unknown as Array<Record<string, string>>;
  const owners = new Map(authActors(rule).map((a) => [a.ref, a.expectedUserId] as const));
  for (const f of rule.fixtures) {
    const row = rows.find((x) => x[r.idColumn] === f.id);
    if (!row) throw new StackError(`fixture ${f.ref} is missing`);
    if (row[r.ownerColumn] !== owners.get(f.ownerRef)) throw new StackError(`fixture ${f.ref} has the wrong owner`);
    if (row[r.markerColumn] !== f.marker) throw new StackError(`fixture ${f.ref} has the wrong marker`);
  }
}

/** Extra column values for fixture rows, e.g. required NOT NULL columns in a customer table. */
export type FixtureDefaults = Record<string, string | number | boolean | null>;

const SAFE_COLUMN = /^[a-z_][a-z0-9_]{0,62}$/;

export function checkFixtureDefaults(rule: RuleContent, defaults: unknown): FixtureDefaults {
  if (defaults === undefined || defaults === null) return {};
  if (typeof defaults !== 'object' || Array.isArray(defaults)) throw new StackError('fixture defaults must be a JSON object of column -> value');
  const r = rule.resource;
  const out: FixtureDefaults = {};
  for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) {
    if (!SAFE_COLUMN.test(k)) throw new StackError(`fixture default column ${JSON.stringify(k.slice(0, 64))} is not a plain lowercase identifier`);
    if (k === r.idColumn || k === r.ownerColumn || k === r.markerColumn) throw new StackError(`fixture defaults cannot set ${k}; it comes from the rule`);
    if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new StackError(`fixture default ${k} must be a string, number, boolean or null`);
    if (typeof v === 'string' && v.length > 500) throw new StackError(`fixture default ${k} is too long`);
    out[k] = v as FixtureDefaults[string];
  }
  return out;
}

/**
 * Refuse to delete anything that is not provably one of our synthetic records.
 * A rule could name the id of a real user or row by mistake; provisioning must never remove it.
 */
async function assertOnlySyntheticRecordsWillBeReplaced(admin: SupabaseClient, rule: RuleContent): Promise<void> {
  for (const a of authActors(rule)) {
    const { data, error } = await admin.auth.admin.getUserById(a.expectedUserId);
    if (error) {
      if (error.status === 404) continue;
      fail(`look up existing user ${a.ref}`, error);
    }
    const email = data.user?.email ?? '';
    if (data.user && (email !== syntheticEmail(rule.ruleId, a.ref) || data.user.user_metadata?.pyx_synthetic !== true)) {
      throw new StackError(`refusing: user id for ${a.ref} already belongs to a non-synthetic account; choose new ids (pyx init generates random ones)`);
    }
  }
  const r = rule.resource;
  const { data, error } = await admin.from(r.table).select(`${r.idColumn},${r.markerColumn}`).in(r.idColumn, rule.fixtures.map((f) => f.id));
  if (error || !data) fail('look up existing fixture rows', error);
  for (const row of data as unknown as Array<Record<string, unknown>>) {
    const marker = row[r.markerColumn];
    if (typeof marker !== 'string' || !/^synthetic-[a-z0-9-]{1,48}$/.test(marker)) {
      throw new StackError(`refusing: row ${String(row[r.idColumn])} exists and is not a synthetic fixture; choose new fixture ids`);
    }
  }
}

export async function provision(rule: RuleContent, stack: StackInfo, defaultsInput?: unknown): Promise<ProvisionResult> {
  assertLocalTarget(stack.apiUrl, rule.target.allowedOrigin);
  const defaults = checkFixtureDefaults(rule, defaultsInput);
  const admin = createClient(stack.apiUrl, stack.secretKey, CLIENT_OPTS);
  const actors = authActors(rule);
  const passwords = new Map<string, string>();
  const r = rule.resource;
  const ids = rule.fixtures.map((f) => f.id);

  // 0. Safety: only synthetic users and rows may be replaced.
  await assertOnlySyntheticRecordsWillBeReplaced(admin, rule);

  // 1. Remove previous synthetic fixture rows first (tables need not cascade on user deletion).
  const delRows = await admin.from(r.table).delete().in(r.idColumn, ids);
  if (delRows.error) fail('delete previous fixtures', delRows.error);

  // 2. Users: delete any previous synthetic user with the same id, then create.
  for (const a of actors) {
    const del = await admin.auth.admin.deleteUser(a.expectedUserId);
    if (del.error && del.error.status !== 404) fail(`delete previous user ${a.ref}`, del.error);
    const password = randomBytes(24).toString('base64url');
    passwords.set(a.ref, password);
    const { data, error } = await admin.auth.admin.createUser({
      id: a.expectedUserId,
      email: syntheticEmail(rule.ruleId, a.ref),
      password,
      email_confirm: true,
      user_metadata: { pyx_synthetic: true, actor_ref: a.ref },
    });
    if (error || !data.user) fail(`create user ${a.ref}`, error);
    if (data.user.id !== a.expectedUserId) throw new StackError(`created user ${a.ref} has an unexpected id`);
  }

  // 3. Insert exactly the declared fixtures (plus any declared extra column values).
  const owners = new Map(actors.map((a) => [a.ref, a.expectedUserId] as const));
  const rows = rule.fixtures.map((f) => ({ ...defaults, [r.idColumn]: f.id, [r.ownerColumn]: owners.get(f.ownerRef)!, [r.markerColumn]: f.marker }));
  const ins = await admin.from(r.table).insert(rows).select(r.idColumn);
  if (ins.error || !ins.data || ins.data.length !== rows.length) fail('insert fixtures', ins.error);

  // 4. Sign each user in with an isolated client to obtain an access token.
  const env: Record<string, string> = {
    PYX_SUPABASE_URL: rule.target.allowedOrigin,
    [rule.target.fixtureVerification.credential.name]: stack.secretKey,
  };
  if (rule.target.apiKey.kind === 'publishable') env[rule.target.apiKey.credential.name] = stack.publishableKey;
  else if (stack.legacyAnonKey) env[rule.target.apiKey.credential.name] = stack.legacyAnonKey;
  if (stack.legacyAnonKey) env.PYX_LEGACY_ANON_KEY = stack.legacyAnonKey;

  for (const a of actors) {
    const client = createClient(stack.apiUrl, stack.publishableKey, CLIENT_OPTS);
    const { data, error } = await client.auth.signInWithPassword({ email: syntheticEmail(rule.ruleId, a.ref), password: passwords.get(a.ref)! });
    if (error || !data.session) fail(`sign in ${a.ref}`, error);
    env[a.credential.name] = data.session.access_token;
  }

  // 5. Independent verification through the setup channel and the Auth service.
  for (const a of actors) await verifyIdentity(stack, env[a.credential.name]!, a.expectedUserId, a.ref);
  await verifyFixtures(admin, rule);

  return {
    env,
    users: actors.map((a) => ({ ref: a.ref, id: a.expectedUserId })),
    fixtures: rule.fixtures.map((f) => ({ ref: f.ref, id: f.id, ownerId: owners.get(f.ownerRef)!, marker: f.marker })),
  };
}

/** Re-verify an existing environment without mutating anything. */
export async function verifyOnly(rule: RuleContent, stack: StackInfo, env: Record<string, string | undefined>): Promise<void> {
  assertLocalTarget(stack.apiUrl, rule.target.allowedOrigin);
  const admin = createClient(stack.apiUrl, stack.secretKey, CLIENT_OPTS);
  for (const a of authActors(rule)) {
    const token = env[a.credential.name];
    if (!token) throw new StackError(`missing ${a.credential.name}`);
    await verifyIdentity(stack, token, a.expectedUserId, a.ref);
  }
  await verifyFixtures(admin, rule);
}
