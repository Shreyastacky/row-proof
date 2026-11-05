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
import type { AuthenticatedActor, RuleContent } from '@rowproof/contracts';
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
  return `${actorRef}.${ruleId}@synthetic.rowproof.test`;
}

function fail(step: string, error: { status?: number | undefined; code?: string | undefined } | null): never {
  // Report the step and a status/code, not raw provider payloads.
  const detail = error ? [error.status, error.code].filter((x) => x !== undefined).join('/') : 'no data';
  throw new StackError(`${step} failed (${detail || 'error'})`);
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

export async function provision(rule: RuleContent, stack: StackInfo): Promise<ProvisionResult> {
  assertLocalTarget(stack.apiUrl, rule.target.allowedOrigin);
  const admin = createClient(stack.apiUrl, stack.secretKey, CLIENT_OPTS);
  const actors = authActors(rule);
  const passwords = new Map<string, string>();

  // 1. Users: delete any previous synthetic user with the same id, then create.
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
      user_metadata: { rowproof_synthetic: true, actor_ref: a.ref },
    });
    if (error || !data.user) fail(`create user ${a.ref}`, error);
    if (data.user.id !== a.expectedUserId) throw new StackError(`created user ${a.ref} has an unexpected id`);
  }

  // 2. Fixtures: remove any rows with these ids, then insert exactly the declared fixtures.
  const r = rule.resource;
  const ids = rule.fixtures.map((f) => f.id);
  const del = await admin.from(r.table).delete().in(r.idColumn, ids);
  if (del.error) fail('delete previous fixtures', del.error);
  const owners = new Map(actors.map((a) => [a.ref, a.expectedUserId] as const));
  const rows = rule.fixtures.map((f) => ({ [r.idColumn]: f.id, [r.ownerColumn]: owners.get(f.ownerRef)!, [r.markerColumn]: f.marker }));
  const ins = await admin.from(r.table).insert(rows).select(r.idColumn);
  if (ins.error || !ins.data || ins.data.length !== rows.length) fail('insert fixtures', ins.error);

  // 3. Sign each user in with an isolated client to obtain an access token.
  const env: Record<string, string> = {
    ROWPROOF_SUPABASE_URL: rule.target.allowedOrigin,
    [rule.target.fixtureVerification.credential.name]: stack.secretKey,
  };
  if (rule.target.apiKey.kind === 'publishable') env[rule.target.apiKey.credential.name] = stack.publishableKey;
  else if (stack.legacyAnonKey) env[rule.target.apiKey.credential.name] = stack.legacyAnonKey;
  if (stack.legacyAnonKey) env.ROWPROOF_LEGACY_ANON_KEY = stack.legacyAnonKey;

  for (const a of actors) {
    const client = createClient(stack.apiUrl, stack.publishableKey, CLIENT_OPTS);
    const { data, error } = await client.auth.signInWithPassword({ email: syntheticEmail(rule.ruleId, a.ref), password: passwords.get(a.ref)! });
    if (error || !data.session) fail(`sign in ${a.ref}`, error);
    env[a.credential.name] = data.session.access_token;
  }

  // 4. Independent verification through the setup channel and the Auth service.
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
