import { describe, expect, it } from 'vitest';
import { byId, runEngine } from './helpers.js';
import { baseEnv, createFake } from './fake-supabase.js';
import { ABORT_CANCELLED } from '../src/transport.js';

function onAssertionReads(fake: ReturnType<typeof createFake>, respond: () => Response | Promise<Response>) {
  fake.override = (req) =>
    req.url.pathname === '/rest/v1/invoices' && req.headers.apikey !== baseEnv(fake).PYX_SETUP_SECRET_KEY ? respond() : undefined;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

describe('transport failures are blocked, never a denial pass', () => {
  it.each([
    ['429 rate limit', () => json(429, { message: 'slow down' }), 'rate_limited'],
    ['500 server error', () => json(500, { message: 'boom' }), 'server_error'],
    ['generic 404', () => json(404, { code: 'PGRST205' }), 'not_found'],
    ['401 on a read', () => json(401, { message: 'JWT expired' }), 'auth_rejected'],
    ['HTML body', () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'response_malformed'],
    ['non-array JSON', () => json(200, { rows: [] }), 'response_malformed'],
    ['invalid JSON', () => new Response('[{', { status: 200, headers: { 'content-type': 'application/json' } }), 'response_malformed'],
    ['invalid UTF-8', () => new Response(new Uint8Array([0x5b, 0xff, 0x5d]), { status: 200, headers: { 'content-type': 'application/json' } }), 'response_malformed'],
    ['same-origin redirect', () => new Response(null, { status: 302, headers: { location: '/rest/v1/other' } }), 'redirect_rejected'],
    ['cross-origin redirect', () => new Response(null, { status: 307, headers: { location: 'https://evil.example/' } }), 'redirect_rejected'],
  ])('%s', async (_label, respond, diagnostic) => {
    const fake = createFake();
    onAssertionReads(fake, respond);
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    for (const a of result.assertions) expect(a).toMatchObject({ status: 'blocked', diagnostic });
    expect(result.summary).toMatchObject({ outcome: 'blocked', exitCode: 2 });
  });

  it('never follows a redirect (one fetch per request)', async () => {
    const fake = createFake();
    onAssertionReads(fake, () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:54321/rest/v1/invoices' } }));
    const { requestsMade } = await runEngine(fake.fetch, { env: baseEnv(fake) });
    expect(fake.requests.length).toBe(requestsMade);
  });

  it('stops reading an oversized body (declared or streamed)', async () => {
    const big = JSON.stringify([{ id: 'x'.repeat(5000) }]);
    const fake = createFake();
    onAssertionReads(fake, () => new Response(big, { status: 200, headers: { 'content-type': 'application/json' } }));
    const r1 = await runEngine(fake.fetch, { env: baseEnv(fake), limits: { maxResponseBytes: 1024 } });
    expect(r1.result.assertions.every((a) => a.diagnostic === 'response_too_large')).toBe(true);

    const fake2 = createFake();
    onAssertionReads(fake2, () => {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(enc.encode('['.padEnd(512, ' ')));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r2 = await runEngine(fake2.fetch, { env: baseEnv(fake2), limits: { maxResponseBytes: 2048 } });
    expect(r2.result.assertions.every((a) => a.diagnostic === 'response_too_large')).toBe(true);
  });

  it('times out slow responses', async () => {
    const fake = createFake();
    const inner = fake.fetch;
    fake.fetch = async (url, init) => {
      if (url.pathname === '/rest/v1/invoices' && new Headers(init.headers).get('apikey') !== baseEnv(fake).PYX_SETUP_SECRET_KEY) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 2_000);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return inner(url, init);
    };
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake), limits: { requestTimeoutMs: 100 } });
    expect(result.assertions.every((a) => a.diagnostic === 'timeout')).toBe(true);
  });

  it('network errors are blocked', async () => {
    const fake = createFake();
    const { result } = await runEngine(
      async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:54321');
      },
      { env: baseEnv(fake) },
    );
    expect(result.controls.find((c) => c.id === 'fixture:invoice-a')!.diagnostic).toBe('network_error');
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(result.summary.exitCode).toBe(2);
  });

  it('enforces the request budget', async () => {
    const fake = createFake();
    const { result, requestsMade } = await runEngine(fake.fetch, { env: baseEnv(fake), limits: { maxRequests: 6 } });
    expect(requestsMade).toBe(6);
    // setup + 2 identity checks + anonymous context + 2 owner reads = 6; the first denied read is over budget.
    expect(byId(result)['a-reads-b']).toEqual({ status: 'blocked', diagnostic: 'request_budget_exhausted' });
    // The owner read succeeded, but fixture stability could not be re-checked, so it cannot count as a pass.
    expect(byId(result)['b-reads-b']).toEqual({ status: 'blocked', diagnostic: 'request_budget_exhausted' });
    expect(result.controls.find((c) => c.id === 'fixtures-stable')).toEqual({ id: 'fixtures-stable', status: 'failed', diagnostic: 'request_budget_exhausted' });
    expect(result.summary.exitCode).toBe(2);
  });

  it('cancellation stops the run, blocks the rest, and keeps an earlier disclosure as a failure', async () => {
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    const controller = new AbortController();
    const inner = fake.fetch;
    let reads = 0;
    fake.fetch = async (url, init) => {
      const res = await inner(url, init);
      if (url.pathname === '/rest/v1/invoices' && ++reads === 4) controller.abort(ABORT_CANCELLED); // after a-reads-b
      return res;
    };
    const { result } = await runEngine(fake.fetch, { env: baseEnv(fake), signal: controller.signal });
    const r = byId(result);
    expect(r['a-reads-b']).toEqual({ status: 'failed', diagnostic: 'fixture_disclosed' });
    expect(r['b-reads-a']).toEqual({ status: 'blocked', diagnostic: 'cancelled' });
    expect(r['anon-reads-b']).toEqual({ status: 'blocked', diagnostic: 'cancelled' });
    expect(result.summary).toMatchObject({ outcome: 'fail', exitCode: 1, completeness: 'incomplete' });
  });
});
