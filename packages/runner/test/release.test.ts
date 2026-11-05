import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCredentialValues } from '@pyx/contracts';
import { compareCommand, buildReproPack } from '../src/commands/release.js';
import { compareResults, renderComparison } from '../src/compare.js';
import { renderHtmlReport } from '../src/html-report.js';
import type { CliIO } from '../src/io.js';
import { baseEnv, createFake } from './fake-supabase.js';
import { approvedBaseline, runEngine, threePathRule } from './helpers.js';

async function runWith(setup: (f: ReturnType<typeof createFake>) => void) {
  const fake = createFake();
  setup(fake);
  const { result } = await runEngine(fake.fetch, { env: baseEnv(fake), baseline: approvedBaseline(threePathRule()) });
  return result;
}

describe('pyx compare', () => {
  it('keeps checks unverified when both runs are blocked', async () => {
    const blocked = await runWith((f) => f.rows.splice(1, 1));
    const c = compareResults(blocked, blocked, { before: 'a', after: 'b' });
    expect(c.counts.now_unverified).toBeGreaterThan(0);
    expect(c.changes.filter((x) => x.after === 'blocked').every((x) => x.change === 'now_unverified')).toBe(true);
    expect(c.exitCode).toBe(2);
  });
  it('names exactly who gained access, on which path', async () => {
    const before = await runWith(() => undefined);
    const after = await runWith((f) => (f.rpcPolicy = 'leaky'));
    const c = compareResults(before, after, { before: 'release-41', after: 'release-42' });
    const gained = c.changes.filter((x) => x.change === 'gained_access');
    expect(gained.map((x) => `${x.path}:${x.actorRef}->${x.fixtureRef}`).sort()).toEqual([
      'rpc-get-invoice:anonymous->invoice-a',
      'rpc-get-invoice:anonymous->invoice-b',
      'rpc-get-invoice:user-a->invoice-b',
      'rpc-get-invoice:user-b->invoice-a',
    ]);
    expect(c.counts.unchanged).toBe(14);
    expect(c.exitCode).toBe(1);
    const text = renderComparison(c);
    expect(text).toContain('GAINED ACCESS  user-a can now read invoice-b  [rpc-get-invoice]');
  });

  it('reports a fix as fixed and exits 0 when the after run is clean', async () => {
    const before = await runWith((f) => (f.appPolicy = 'leaky'));
    const after = await runWith(() => undefined);
    const c = compareResults(before, after, { before: 'a', after: 'b' });
    expect(c.counts.access_removed).toBe(2);
    expect(c.regressions).toBe(0);
    expect(c.exitCode).toBe(0);
  });

  it('an owner who loses access is a regression too', async () => {
    const before = await runWith(() => undefined);
    const after = await runWith((f) => (f.appPolicy = 'gone'));
    const c = compareResults(before, after, { before: 'a', after: 'b' });
    expect(c.counts.lost_access).toBe(2);
    expect(c.counts.now_unverified).toBeGreaterThan(0); // dependent denials cannot be shown any more
    expect(c.exitCode).toBe(1);
  });

  it('a check that could not run is never reported as unchanged or fixed', async () => {
    const before = await runWith((f) => (f.policy = 'permissive-authenticated'));
    const after = await runWith((f) => f.rows.splice(1, 1));
    const c = compareResults(before, after, { before: 'a', after: 'b' });
    // B's record is gone, so "user-a can no longer read invoice-b" cannot be claimed ...
    expect(c.changes.find((x) => x.path === 'data-api' && x.actorRef === 'user-a' && x.fixtureRef === 'invoice-b')!.change).toBe('now_unverified');
    // ... while A's record is intact and its fix is real.
    expect(c.changes.find((x) => x.path === 'data-api' && x.actorRef === 'user-b' && x.fixtureRef === 'invoice-a')!.change).toBe('access_removed');
    expect(c.exitCode).toBe(2);
  });

  describe('command', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'pyx-compare-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads two result files, prints the review, and appends Markdown', async () => {
      await writeFile(join(dir, 'a.json'), JSON.stringify(await runWith(() => undefined)));
      await writeFile(join(dir, 'b.json'), JSON.stringify(await runWith((f) => (f.policy = 'permissive-authenticated'))));
      const out: string[] = [];
      const io: CliIO = { stdout: (s) => out.push(s), stderr: (s) => out.push(s), env: {}, cwd: dir };
      const code = await compareCommand(['a.json', 'b.json', '--summary-md', 's.md', '--out', 'c.json'], io);
      expect(code).toBe(1);
      expect(out.join('')).toContain('user-b can now read invoice-a  [data-api]');
      expect(await readFile(join(dir, 's.md'), 'utf8')).toContain('Access changed');
      expect(JSON.parse(await readFile(join(dir, 'c.json'), 'utf8')).regressions).toBe(2);
    });
  });
});

describe('pyx repro', () => {
  it('builds a pack with one replayable request per failing check and no credentials', async () => {
    const result = await runWith((f) => {
      f.rpcPolicy = 'leaky';
      f.appPolicy = 'leaky';
    });
    const pack = buildReproPack(result, threePathRule());
    expect(pack.failing).toBe(6);
    expect(pack.script).toContain('/rest/v1/rpc/get_invoice?p_id=1a5e0000-0000-4000-8000-00000000000b');
    expect(pack.script).not.toContain('${PYX_SUPABASE_URL}');
    expect(pack.script).toContain('http://127.0.0.1:54321/rest/v1/rpc/');
    expect(pack.script).toContain('Authorization: Bearer ${PYX_USER_A_TOKEN}');
    expect(pack.script).toContain('http://127.0.0.1:8787/api/invoices/');
    expect(pack.readme).toContain('## a-reads-b on `rpc-get-invoice`');
    expect(findCredentialValues(pack.script + pack.readme)).toEqual([]);
    // Anonymous requests to the RPC carry no bearer at all.
    const anonLine = pack.script.split('\n').find((l) => l.includes('rpc/get_invoice') && l.includes('00000000000a') && !l.includes('Bearer'));
    expect(anonLine).toBeDefined();
  });
});

describe('HTML report access review', () => {
  it('a multi-run report opens with who gained access since the previous run, failing path first', async () => {
    const before = await runWith(() => undefined);
    const after = await runWith((f) => (f.appPolicy = 'leaky'));
    after.observedAt = { startedAt: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:00:01.000Z' };
    const html = renderHtmlReport([before, after]);
    expect(html).toContain('Access review');
    expect(html).toContain('2 access changes since the previous run');
    expect(html).toContain('user-a can now read invoice-b');
    expect(html.indexOf('app-invoice-route</span>')).toBeLessThan(html.indexOf('data-api</span>'));
    expect(renderHtmlReport([after])).not.toContain('Access review');
  });
});

describe('request ledger', () => {
  it('records every request in order, by identity name only, and matches what the server saw', async () => {
    const fake = createFake();
    const out = await runEngine(fake.fetch, { env: baseEnv(fake), baseline: approvedBaseline(threePathRule()) });
    expect(out.requests).toHaveLength(fake.requests.length);
    expect(out.requests.map((q) => q.url)).toEqual(fake.requests.map((r) => `${r.url.origin}${r.url.pathname}${r.url.search}`));
    expect(out.requests[0]).toMatchObject({ n: 1, purpose: 'fixture-check', as: 'setup-key', status: 200 });
    expect(out.requests.at(-1)).toMatchObject({ purpose: 'fixture-recheck' });
    expect(out.requests.filter((q) => q.purpose === 'read')).toHaveLength(18);
    expect(new Set(out.requests.filter((q) => q.purpose === 'read').map((q) => q.path))).toEqual(new Set(['data-api', 'rpc-get-invoice', 'app-invoice-route']));
    const text = JSON.stringify(out.requests);
    for (const v of out.sensitiveValues) expect(text).not.toContain(v);
    expect(findCredentialValues(out.requests)).toEqual([]);
  });

  it('a request the budget refused is listed as not sent', async () => {
    const fake = createFake();
    const out = await runEngine(fake.fetch, { env: baseEnv(fake), limits: { maxRequests: 3 } });
    expect(out.requests.filter((q) => q.failure === 'request_budget_exhausted').length).toBeGreaterThan(0);
    expect(fake.requests).toHaveLength(3);
  });

  it('appears in the HTML report as an appendix', async () => {
    const fake = createFake();
    const out = await runEngine(fake.fetch, { env: baseEnv(fake) });
    const html = renderHtmlReport([out.result], { requests: out.requests });
    expect(html).toContain(`Every request Pyx sent: ${out.requests.length}`);
    expect(html).toContain('/auth/v1/user');
    for (const v of out.sensitiveValues) expect(html).not.toContain(v);
  });
});
