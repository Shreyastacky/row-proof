/**
 * Regression tests for the findings of the external design audit: a fixture
 * that changes mid-run, disclosure by id without the marker, and an anonymous
 * context that is secretly signed in.
 */
import { describe, expect, it } from 'vitest';
import { validateSchema } from '@pyx/contracts';
import { baseEnv, createFake, INVOICE_A, INVOICE_B, USER_A } from './fake-supabase.js';
import { byId, control, runEngine } from './helpers.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fixture stability (audit: a vanished fixture must not read as isolation)', () => {
  it('a fixture deleted after the owner read blocks every pass instead of reporting denial', async () => {
    const fake = createFake();
    fake.after = (req) => {
      // b-reads-b has just been answered: delete B before anyone else reads it.
      if (req.headers.authorization === `Bearer ${fake.tokenB}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`) {
        fake.rows = fake.rows.filter((r) => r.id !== INVOICE_B);
      }
    };
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'fixtures-stable')).toEqual({ status: 'failed', diagnostic: 'fixture_unstable' });
    const r = byId(result);
    expect(r['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'fixture_unstable' });
    expect(r['anon-reads-b']).toEqual({ status: 'blocked', diagnostic: 'fixture_unstable' });
    expect(result.assertions.some((a) => a.status === 'passed')).toBe(false);
    expect(result.summary).toMatchObject({ outcome: 'blocked', exitCode: 2 });
    expect(validateSchema('RunResult', result).ok).toBe(true);
  });

  it('a fixture that changes owner mid-run is unstable too', async () => {
    const fake = createFake();
    fake.after = (req) => {
      if (req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_A}`) {
        fake.rows[1]!.owner_id = USER_A;
      }
    };
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'fixtures-stable')).toEqual({ status: 'failed', diagnostic: 'fixture_unstable' });
    expect(result.summary.outcome).not.toBe('pass');
  });

  it('a disclosure observed before the change is still reported as failed', async () => {
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    fake.after = (req) => {
      if (req.url.searchParams.get('id') === `eq.${INVOICE_A}` && req.headers.authorization === `Bearer ${fake.tokenB}`) {
        fake.rows = fake.rows.filter((r) => r.id !== INVOICE_A);
      }
    };
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['b-reads-a']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(result.summary).toMatchObject({ outcome: 'fail', exitCode: 1 });
  });
});

describe('disclosure by id (audit: id without marker must fail)', () => {
  it('a forbidden read returning the row id but no marker is a disclosure', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`
        ? json(200, [{ id: INVOICE_B, owner_id: null, fixture_marker: null }])
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(result.assertions.find((a) => a.id === 'a-reads-b')!.observation).toBe('fixture_returned_inconsistent');
    expect(result.summary.exitCode).toBe(1);
  });

  it('a forbidden read returning the row with an altered marker is a disclosure', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`
        ? json(200, [{ id: INVOICE_B, owner_id: 'redacted', fixture_marker: 'masked' }])
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
  });

  it('the marker leaking through an error body is a disclosure', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`
        ? json(500, { message: 'duplicate key: synthetic-invoice-b' })
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
  });

  it('an error that only echoes the requested id is not a disclosure', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`
        ? json(400, { message: `bad request for ${INVOICE_B}` })
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'http_status_unexpected' });
  });

  it('a longer marker that merely starts with the fixture marker is not a match', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.headers.authorization === `Bearer ${fake.tokenA}` && req.url.searchParams.get('id') === `eq.${INVOICE_B}`
        ? json(500, { message: 'synthetic-invoice-bb' })
        : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(byId(result)['a-reads-b']!.status).toBe('blocked');
  });
});

describe('anonymous context (audit: validate it independently)', () => {
  it('is checked against Auth and must be refused', async () => {
    const fake = createFake();
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'identity:anonymous')).toEqual({ status: 'ok', diagnostic: 'ok' });
    const probe = fake.requests.filter((r) => r.url.pathname === '/auth/v1/user' && !r.headers.authorization);
    expect(probe.length).toBe(1);
  });

  it('anonymous headers that Auth accepts as a user block every anonymous assertion', async () => {
    const fake = createFake();
    fake.override = (req) =>
      req.url.pathname === '/auth/v1/user' && !req.headers.authorization ? json(200, { id: USER_A, is_anonymous: false }) : undefined;
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(control(result, 'identity:anonymous')).toEqual({ status: 'failed', diagnostic: 'anonymous_context_invalid' });
    const r = byId(result);
    expect(r['anon-reads-a']).toEqual({ status: 'blocked', diagnostic: 'anonymous_context_invalid' });
    expect(r['anon-reads-b']).toEqual({ status: 'blocked', diagnostic: 'anonymous_context_invalid' });
    expect(r['a-reads-b']!.status).toBe('passed');
    expect(result.summary).toMatchObject({ outcome: 'blocked', exitCode: 2 });
  });
});
