import { describe, expect, it } from 'vitest';
import { validateSchema } from '@rowproof/contracts';
import { serializeResult } from '../src/report.js';
import {
  baseEnv,
  createFake,
  INVOICE_B,
  LEGACY_ANON,
  LEGACY_SERVICE,
  ORIGIN,
  SECRET,
  USER_A,
  USER_B,
  userToken,
} from './fake-supabase.js';
import { approvedBaseline, byId, control, exampleRule, runEngine } from './helpers.js';

const ALL_PASS = {
  'a-reads-a': { status: 'passed', diagnostic: 'ok' },
  'b-reads-b': { status: 'passed', diagnostic: 'ok' },
  'a-reads-b': { status: 'passed', diagnostic: 'ok' },
  'b-reads-a': { status: 'passed', diagnostic: 'ok' },
  'anon-reads-a': { status: 'passed', diagnostic: 'ok' },
  'anon-reads-b': { status: 'passed', diagnostic: 'ok' },
};

describe('healthy owner-only boundary', () => {
  it('passes all six assertions with valid controls and exits 0', async () => {
    const fake = createFake();
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)).toEqual(ALL_PASS);
    expect(result.summary).toMatchObject({ outcome: 'pass', completeness: 'complete', exitCode: 0 });
    expect(result.controls.every((c) => c.status === 'ok')).toBe(true);
    expect(validateSchema('RunResult', result).ok).toBe(true);
    expect(result.freshness).toEqual({ state: 'unknown', reason: 'no_dependency_observer', dependencies: [] });
  });

  it('never adds an owner filter to reads, so an exposed row cannot be hidden by the query', async () => {
    const fake = createFake();
    await runEngine(fake.fetch, { env: baseEnv(fake) });
    const reads = fake.requests.filter((r) => r.url.pathname === '/rest/v1/invoices');
    expect(reads.length).toBe(7); // 1 setup verification + 6 assertions
    for (const r of reads) {
      expect([...r.url.searchParams.keys()].sort()).toEqual(['id', 'limit', 'select']);
      expect(r.url.searchParams.has('owner_id')).toBe(false);
    }
  });

  it('keeps the setup secret out of every assertion and identity request, and sends no user token anonymously', async () => {
    const fake = createFake();
    await runEngine(fake.fetch, { env: baseEnv(fake) });
    const [setup, ...rest] = fake.requests;
    expect(setup!.headers.apikey).toBe(SECRET);
    for (const r of rest) {
      expect(JSON.stringify(r.headers)).not.toContain(SECRET);
      expect(r.url.origin).toBe(ORIGIN);
    }
    const anonReads = rest.filter((r) => r.url.pathname === '/rest/v1/invoices' && !r.headers.authorization);
    expect(anonReads.length).toBe(2);
  });
});

describe('sensitivity to the intended regression (mocked transport)', () => {
  it('a permissive authenticated policy produces failed cross-user assertions and exit 1', async () => {
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(byId(result)['b-reads-a']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(byId(result)['anon-reads-a']!.status).toBe('passed');
    expect(result.summary).toMatchObject({ outcome: 'fail', exitCode: 1 });
  });

  it('a policy open to everyone also fails the anonymous assertions', async () => {
    const fake = createFake();
    fake.policy = 'permissive-all';
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(result.summary.counts.failed).toBe(4);
  });

  it('a denied owner read is a failed permitted assertion; dependent denials are blocked, not passed', async () => {
    const fake = createFake();
    fake.policy = 'deny-all';
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    const r = byId(result);
    expect(r['a-reads-a']).toEqual({ status: 'failed', diagnostic: 'owner_read_returned_no_rows' });
    expect(r['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'owner_control_not_passed' });
    expect(r['anon-reads-b']).toEqual({ status: 'blocked', diagnostic: 'owner_control_not_passed' });
    expect(result.summary).toMatchObject({ outcome: 'fail', exitCode: 1, completeness: 'incomplete' });
  });

  it('owner read denied by a missing grant (PostgREST 42501) is a failed permitted assertion', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.url.pathname === '/rest/v1/invoices' && req.headers.authorization === `Bearer ${fake.tokenA}`
        ? new Response(JSON.stringify({ code: '42501', message: 'permission denied for table invoices' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-a']).toEqual({ status: 'failed', diagnostic: 'owner_read_forbidden' });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'http_status_unexpected' });
  });

  it('a disclosure is retained as failed even when other controls are blocked', async () => {
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    const env = { ...baseEnv(fake), ROWPROOF_SETUP_SECRET_KEY: undefined };
    const { result } = await runEngine(fake.fetch, { env });
    expect(control(result, 'setup-key')).toEqual({ status: 'failed', diagnostic: 'setup_key_missing' });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(byId(result)['a-reads-a']).toEqual({ status: 'blocked', diagnostic: 'fixture_unverified' });
    expect(result.summary).toMatchObject({ outcome: 'fail', exitCode: 1, completeness: 'incomplete' });
  });
});

describe('identity controls', () => {
  it('same-user sessions cannot produce an isolation pass', async () => {
    const fake = createFake();
    const second = userToken(USER_A);
    fake.users.set(second, { id: USER_A });
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_B_TOKEN: second } });
    expect(control(result, 'identity:user-b')).toEqual({ status: 'failed', diagnostic: 'user_id_mismatch' });
    expect(byId(result)['b-reads-a']!.status).toBe('blocked');
    expect(byId(result)['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'owner_control_not_passed' });
    expect(result.summary.exitCode).toBe(2);
  });

  it('distinct-identity check catches two verified actors that resolve to one user', async () => {
    const fake = createFake();
    const content = exampleRule();
    const shared = userToken(USER_A);
    fake.users.set(shared, { id: USER_A });
    // Auth claims user-b's token is user A; expected ids differ so this is a mismatch, never a pass.
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_B_TOKEN: shared }, baseline: approvedBaseline(content) });
    expect(result.summary.outcome).not.toBe('pass');
  });

  it('a token the Auth service rejects (expired, wrong project, invalid) is blocked', async () => {
    const fake = createFake();
    const foreign = userToken(USER_B); // not registered with this fake Auth service
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_B_TOKEN: foreign } });
    expect(control(result, 'identity:user-b')).toEqual({ status: 'failed', diagnostic: 'token_rejected_by_auth' });
    expect(result.summary.exitCode).toBe(2);
  });

  it('a token issued for another origin is blocked even if accepted', async () => {
    const fake = createFake();
    const t = userToken(USER_B, { iss: 'http://127.0.0.1:64321/auth/v1' });
    fake.users.set(t, { id: USER_B });
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_B_TOKEN: t } });
    expect(control(result, 'identity:user-b')).toEqual({ status: 'failed', diagnostic: 'token_issuer_mismatch' });
  });

  it('a token about to expire is blocked', async () => {
    const fake = createFake();
    const t = userToken(USER_B, { exp: Math.floor(Date.now() / 1000) + 10 });
    fake.users.set(t, { id: USER_B });
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_B_TOKEN: t } });
    expect(control(result, 'identity:user-b')).toEqual({ status: 'failed', diagnostic: 'token_expired_or_expiring' });
  });

  it('an anonymous-sign-in user cannot stand in for an ordinary user', async () => {
    const fake = createFake();
    fake.users.set(fake.tokenB, { id: USER_B, is_anonymous: true });
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'identity:user-b')).toEqual({ status: 'failed', diagnostic: 'token_anonymous_user' });
  });

  it('elevated credentials are refused in user and app-key contexts before anything is sent with them', async () => {
    const fake = createFake();
    const asUser = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_USER_A_TOKEN: SECRET } });
    expect(control(asUser.result, 'identity:user-a')).toEqual({ status: 'failed', diagnostic: 'token_elevated_role' });
    expect(fake.requests.filter((r) => r.url.pathname !== '/rest/v1/invoices' || r.headers.apikey !== SECRET).every((r) => !JSON.stringify(r.headers).includes(SECRET))).toBe(true);

    const fake2 = createFake();
    const legacyAsUser = await runEngine(fake2.fetch, { env: { ...baseEnv(fake2), ROWPROOF_USER_A_TOKEN: LEGACY_SERVICE } });
    expect(control(legacyAsUser.result, 'identity:user-a')).toEqual({ status: 'failed', diagnostic: 'token_elevated_role' });

    const fake3 = createFake();
    const asApiKey = await runEngine(fake3.fetch, { env: { ...baseEnv(fake3), ROWPROOF_PUBLISHABLE_KEY: SECRET } });
    expect(control(asApiKey.result, 'api-key')).toEqual({ status: 'failed', diagnostic: 'api_key_elevated' });
    expect(asApiKey.requestsMade).toBe(0);
    expect(asApiKey.result.summary.exitCode).toBe(2);
  });

  it('the setup channel refuses a non-elevated key', async () => {
    const fake = createFake();
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_SETUP_SECRET_KEY: 'sb_publishable_notasecret0001' } });
    expect(control(result, 'setup-key')).toEqual({ status: 'failed', diagnostic: 'setup_key_wrong_class' });
    expect(result.summary.exitCode).toBe(2);
  });
});

describe('legacy anon-key compatibility is explicit', () => {
  it('a legacy anon JWT is refused when the rule declares a publishable key', async () => {
    const fake = createFake();
    const { result } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_PUBLISHABLE_KEY: LEGACY_ANON } });
    expect(control(result, 'api-key')).toEqual({ status: 'failed', diagnostic: 'api_key_wrong_class' });
  });

  it('a rule that declares legacy-anon works and sends the anon key as bearer for anonymous reads', async () => {
    const fake = createFake();
    const content = exampleRule();
    content.target.apiKey = { kind: 'legacy-anon', credential: { source: 'env', name: 'ROWPROOF_LEGACY_ANON_KEY' } };
    const env = { ...baseEnv(fake), ROWPROOF_LEGACY_ANON_KEY: LEGACY_ANON, ROWPROOF_SETUP_SECRET_KEY: LEGACY_SERVICE };
    const { result } = await runEngine(fake.fetch, { env, baseline: approvedBaseline(content) });
    expect(byId(result)).toEqual(ALL_PASS);
    const anon = fake.requests.filter((r) => r.headers.authorization === `Bearer ${LEGACY_ANON}`);
    expect(anon.length).toBe(2);
  });
});

describe('fixture controls', () => {
  it('a missing fixture blocks its owner read and every dependent denial', async () => {
    const fake = createFake();
    fake.rows = fake.rows.filter((r) => r.id !== INVOICE_B);
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'fixture:invoice-b')).toEqual({ status: 'failed', diagnostic: 'fixture_missing' });
    const r = byId(result);
    expect(r['b-reads-b']).toEqual({ status: 'blocked', diagnostic: 'fixture_unverified' });
    expect(r['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'fixture_unverified' });
    expect(r['anon-reads-b']).toEqual({ status: 'blocked', diagnostic: 'fixture_unverified' });
    expect(r['a-reads-a']!.status).toBe('passed');
    expect(result.summary).toMatchObject({ outcome: 'blocked', exitCode: 2 });
  });

  it('a fixture with the wrong owner or marker is blocked', async () => {
    const fake = createFake();
    fake.rows[1]!.owner_id = USER_A;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'fixture:invoice-b')).toEqual({ status: 'failed', diagnostic: 'fixture_owner_mismatch' });
    // A now legitimately owns B's row: reading it is not a disclosure of B's fixture.
    expect(byId(result)['a-reads-b']!.status).toBe('blocked');
    expect(result.summary.outcome).not.toBe('pass');

    const fake2 = createFake();
    fake2.rows[0]!.fixture_marker = 'synthetic-tampered';
    const r2 = await runEngine(fake2.fetch, { env: baseEnv(fake2) });
    expect(control(r2.result, 'fixture:invoice-a')).toEqual({ status: 'failed', diagnostic: 'fixture_marker_mismatch' });
    expect(byId(r2.result)['a-reads-a']).toEqual({ status: 'blocked', diagnostic: 'fixture_returned_inconsistent' });
  });

  it('HTTP 200 with a different fixture or absent owner fields cannot pass the owner control', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.url.pathname === '/rest/v1/invoices' && req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id')?.includes('0a')
        ? new Response(JSON.stringify([{ id: INVOICE_B, owner_id: USER_B, fixture_marker: 'synthetic-invoice-b' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-a']).toEqual({ status: 'blocked', diagnostic: 'unexpected_rows' });
    expect(byId(result)['b-reads-a']).toEqual({ status: 'blocked', diagnostic: 'owner_control_not_passed' });

    const fake2 = createFake();
    fake2.override = (req) =>
      req.url.pathname === '/rest/v1/invoices' && req.headers.authorization === `Bearer ${fake2.tokenA}`
        ? new Response(JSON.stringify([{ id: '1a5e0000-0000-4000-8000-00000000000a' }]), { status: 200, headers: { 'content-type': 'application/json' } })
        : undefined;
    const r2 = await runEngine(fake2.fetch, { env: baseEnv(fake2) });
    expect(byId(r2.result)['a-reads-a']).toEqual({ status: 'blocked', diagnostic: 'response_malformed' });
  });
});

describe('target controls', () => {
  it('a target URL that differs from the approved origin sends nothing', async () => {
    const fake = createFake();
    for (const targetUrl of ['http://127.0.0.1:54322', 'http://localhost:54321', 'https://127.0.0.1:54321', 'http://evil.example']) {
      const { result, requestsMade } = await runEngine(fake.fetch, { env: baseEnv(fake), targetUrl });
      expect(requestsMade, targetUrl).toBe(0);
      expect(control(result, 'target')).toEqual({ status: 'failed', diagnostic: 'origin_mismatch' });
      expect(result.assertions.every((a) => a.status === 'blocked' && a.diagnostic === 'target_unverified')).toBe(true);
    }
    expect(fake.requests).toEqual([]);
  });

  it('a missing target URL blocks', async () => {
    const fake = createFake();
    const { result, requestsMade } = await runEngine(fake.fetch, { env: { ...baseEnv(fake), ROWPROOF_SUPABASE_URL: undefined } });
    expect(requestsMade).toBe(0);
    expect(result.summary.exitCode).toBe(2);
  });

  it('unsupported approved intent is not assessed and sends nothing', async () => {
    const fake = createFake();
    const content = exampleRule();
    const baseline = approvedBaseline(content);
    baseline.revision.content.resource.operation = 'update'; // simulate content from a newer tool version
    const { result, requestsMade } = await runEngine(fake.fetch, { env: baseEnv(fake), baseline });
    expect(requestsMade).toBe(0);
    expect(result.assertions.every((a) => a.status === 'not_assessed' && a.diagnostic === 'unsupported_operation')).toBe(true);
    expect(result.summary.exitCode).toBe(2);
  });
});

describe('output safety', () => {
  it('never serializes tokens, keys, or provider response bodies, even when the provider echoes them', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.url.pathname === '/rest/v1/invoices' && !req.headers.authorization
        ? new Response(JSON.stringify({ message: `bad request with ${req.headers.apikey} and amount 3400` }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    const out = await runEngine(fake.fetch, { env: baseEnv(fake) });
    const text = serializeResult(out.result, out.sensitiveValues);
    for (const secret of Object.values(baseEnv(fake))) if (secret.length > 25) expect(text).not.toContain(secret);
    expect(text).not.toContain('3400');
    expect(text).not.toContain('amount');
    expect(text).not.toMatch(/eyJ|sb_secret_|sb_publishable_/);
    expect(byId(out.result)['anon-reads-a']).toEqual({ status: 'blocked', diagnostic: 'http_status_unexpected' });
  });

  it('collects every loaded credential for the leak check', async () => {
    const fake = createFake();
    const out = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(new Set(out.sensitiveValues)).toEqual(new Set([baseEnv(fake).ROWPROOF_PUBLISHABLE_KEY, SECRET, fake.tokenA, fake.tokenB]));
  });
});
