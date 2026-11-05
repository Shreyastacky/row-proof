/**
 * Paired request paths: the same actors and fixtures checked through the Data
 * API, an RPC function and an application route. The point is the case where
 * the table policy is right and another path leaks anyway.
 */
import { describe, expect, it } from 'vitest';
import { checkRuleContentSemantics, validateSchema } from '@pyx/contracts';
import { APP_ORIGIN, baseEnv, createFake, PUBLISHABLE, SECRET } from './fake-supabase.js';
import { approvedBaseline, byPath, control, runEngine, threePathRule } from './helpers.js';

const run = (fake: ReturnType<typeof createFake>) => runEngine(fake.fetch, { env: baseEnv(fake), baseline: approvedBaseline(threePathRule()) });

describe('three request paths', () => {
  it('detects JSON-escaped disclosures on app routes even with an approved denial status', async () => {
    const fake = createFake();
    fake.appPolicy = 'leaky';
    const fetch: typeof fake.fetch = async (url, init) => {
      const response = await fake.fetch(url, init);
      if (url.origin !== APP_ORIGIN || response.status !== 200) return response;
      const body = await response.text();
      const escaped = body.replace(/[a-z]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      return new Response(escaped, { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const { result } = await runEngine(fetch, { env: baseEnv(fake), baseline: approvedBaseline(threePathRule()) });
    expect(byPath(result)['app-invoice-route/a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(result.summary.exitCode).toBe(1);
  });
  it('the example rule is valid and in scope', () => {
    expect(validateSchema('RuleContent', threePathRule()).ok).toBe(true);
    expect(checkRuleContentSemantics(threePathRule())).toEqual([]);
  });

  it('a healthy stack passes all 18 assertions across the three paths', async () => {
    const fake = createFake();
    const { result } = await run(fake);
    expect(result.paths.map((p) => p.id)).toEqual(['data-api', 'rpc-get-invoice', 'app-invoice-route']);
    expect(result.assertions).toHaveLength(18);
    expect(result.assertions.every((a) => a.status === 'passed')).toBe(true);
    expect(result.summary).toMatchObject({ outcome: 'pass', completeness: 'complete', exitCode: 0 });
    expect(validateSchema('RunResult', result).ok).toBe(true);
  });

  it('an RPC that skips the owner check fails on that path while the table passes', async () => {
    const fake = createFake();
    fake.rpcPolicy = 'leaky';
    const { result } = await run(fake);
    const r = byPath(result);
    expect(r['data-api/a-reads-b']).toEqual({ status: 'passed', diagnostic: 'ok' });
    expect(r['rpc-get-invoice/a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(r['rpc-get-invoice/anon-reads-a']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(r['app-invoice-route/a-reads-b']).toEqual({ status: 'passed', diagnostic: 'ok' });
    expect(result.summary.exitCode).toBe(1);
  });

  it('an RPC that raises insufficient_privilege for others counts as a denial', async () => {
    const fake = createFake();
    fake.rpcPolicy = 'raise';
    const { result } = await run(fake);
    expect(result.summary).toMatchObject({ outcome: 'pass', exitCode: 0 });
  });

  it('an app route that returns any invoice to any signed-in user fails on that path only', async () => {
    const fake = createFake();
    fake.appPolicy = 'leaky';
    const { result } = await run(fake);
    const r = byPath(result);
    expect(r['app-invoice-route/a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(r['app-invoice-route/b-reads-a']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    // Anonymous is still refused with 401, which the rule approves as a denial.
    expect(r['app-invoice-route/anon-reads-a']).toEqual({ status: 'passed', diagnostic: 'ok' });
    expect(r['data-api/a-reads-b']).toEqual({ status: 'passed', diagnostic: 'ok' });
  });

  it('an app route that refuses but names the record in a success response is a disclosure', async () => {
    const fake = createFake();
    fake.appPolicy = 'echo-id';
    const { result } = await run(fake);
    expect(byPath(result)['app-invoice-route/a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
  });

  it('an app route that loses the owner read fails the owner control and blocks its denials', async () => {
    const fake = createFake();
    fake.appPolicy = 'gone';
    const { result } = await run(fake);
    const r = byPath(result);
    expect(r['app-invoice-route/a-reads-a']).toEqual({ status: 'failed', diagnostic: 'owner_read_forbidden' });
    expect(r['app-invoice-route/a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'owner_control_not_passed' });
    expect(r['data-api/a-reads-b']).toEqual({ status: 'passed', diagnostic: 'ok' });
  });

  it('a status the rule does not approve as a denial blocks instead of passing', async () => {
    const fake = createFake();
    const content = threePathRule();
    const app = content.paths![1]!;
    if (app.kind !== 'http') throw new Error('expected the app path');
    app.deniedStatuses = [403];
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake), baseline: approvedBaseline(content) });
    expect(byPath(result)['app-invoice-route/a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'not_found' });
  });

  it('Supabase keys never reach the application origin, and anonymous app calls carry no token', async () => {
    const fake = createFake();
    await run(fake);
    const appCalls = fake.requests.filter((r) => r.url.origin === APP_ORIGIN);
    expect(appCalls).toHaveLength(6);
    for (const r of appCalls) {
      expect(JSON.stringify(r.headers)).not.toContain(SECRET);
      expect(JSON.stringify(r.headers)).not.toContain(PUBLISHABLE);
      expect(r.headers.apikey).toBeUndefined();
    }
    expect(appCalls.filter((r) => !r.headers.authorization)).toHaveLength(2);
  });

  it('a non-loopback app origin on a local rule is refused before any request', async () => {
    const fake = createFake();
    const content = threePathRule();
    const app = content.paths![1]!;
    if (app.kind !== 'http') throw new Error('expected the app path');
    app.origin = 'https://app.example.com';
    expect(checkRuleContentSemantics(content).map((i) => i.code)).toContain('origin_not_loopback');
    // Approval refuses it outright ...
    expect(() => approvedBaseline(content)).toThrow(/origin_not_loopback/);
    // ... and the engine re-checks, even if a tampered baseline got this far.
    const baseline = approvedBaseline(threePathRule());
    baseline.revision.content.paths = content.paths!;
    const { result, requestsMade } = await runEngine(fake.fetch, { env: baseEnv(fake), baseline });
    expect(requestsMade).toBe(0);
    expect(result.assertions.every((a) => a.status === 'not_assessed')).toBe(true);
    expect(control(result, 'target')).toEqual({ status: 'not_run', diagnostic: 'not_executed' });
  });

  it('rejects a reserved or repeated path id', () => {
    const content = threePathRule();
    content.paths![0]!.id = 'data-api';
    expect(checkRuleContentSemantics(content).map((i) => i.code)).toContain('reserved_path_id');
    const dup = threePathRule();
    dup.paths![1]!.id = dup.paths![0]!.id;
    expect(checkRuleContentSemantics(dup).map((i) => i.code)).toContain('duplicate_path_id');
  });
});
