import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHashOf, parseStrictJson, type RuleProposal, type RunResult } from '@pyx/contracts';
import { main } from '../src/cli.js';
import { runCommand } from '../src/commands/run.js';
import type { CliIO } from '../src/io.js';
import { baseEnv, createFake } from './fake-supabase.js';
import { exampleRule, repoRoot } from './helpers.js';

let dir: string;
let out: string[];
let err: string[];

function io(env: Record<string, string | undefined> = {}): CliIO {
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env, cwd: dir };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pyx-cli-'));
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function approveExample(rule = `${repoRoot}examples/invoice-owner-read.rule.json`, file = 'p1.json'): Promise<RuleProposal> {
  expect(await main(['propose', '--rule', rule, '--store', 'store', '--proposed-by', 'dev', '--out', file], io())).toBe(0);
  const proposal = JSON.parse(await readFile(join(dir, file), 'utf8')) as RuleProposal;
  expect(
    await main(['approve', '--proposal', file, '--store', 'store', '--approver', 'owner', '--acknowledge', proposal.contentHash, '--promote'], io()),
  ).toBe(0);
  return proposal;
}

describe('approval workflow', () => {
  it('propose -> diff -> approve with the exact hash -> active baseline', async () => {
    const p = await approveExample();
    out = [];
    expect(await main(['history', '--store', 'store', '--rule', 'invoice-owner-read'], io())).toBe(0);
    expect(out.join('')).toContain(`* r1 ${p.contentHash}`);
    expect(out.join('')).toContain('local-self-attested');
  });

  it('a changed expectation produces a new hash and a readable permission diff, and needs a new approval', async () => {
    await approveExample();
    const changed = exampleRule();
    changed.title = 'Renamed rule';
    changed.declaredScope.covers = 'Changed scope wording.';
    await writeFile(join(dir, 'changed.json'), JSON.stringify(changed));
    expect(await main(['propose', '--rule', 'changed.json', '--store', 'store', '--proposed-by', 'ai', '--proposer-kind', 'ai-assistant', '--out', 'p2.json'], io())).toBe(0);
    const p2 = JSON.parse(await readFile(join(dir, 'p2.json'), 'utf8')) as RuleProposal;
    expect(p2.basedOn?.revision).toBe(1);
    out = [];
    expect(await main(['diff', '--proposal', 'p2.json', '--store', 'store'], io())).toBe(0);
    expect(out.join('')).toContain('/title');
    expect(out.join('')).toContain(p2.contentHash);

    // Approving with the OLD hash is refused.
    const oldHash = contentHashOf(exampleRule());
    expect(await main(['approve', '--proposal', 'p2.json', '--store', 'store', '--approver', 'owner', '--acknowledge', oldHash, '--promote'], io())).toBe(2);
    expect(err.join('')).toContain('acknowledgment_mismatch');
    // The active baseline is untouched.
    out = [];
    await main(['history', '--store', 'store', '--rule', 'invoice-owner-read'], io());
    expect(out.join('')).toContain(`* r1 ${oldHash}`);
  });

  it('a proposal edited after it was hashed cannot be approved', async () => {
    expect(await main(['propose', '--rule', `${repoRoot}examples/invoice-owner-read.rule.json`, '--store', 'store', '--proposed-by', 'dev', '--out', 'p.json'], io())).toBe(0);
    const p = JSON.parse(await readFile(join(dir, 'p.json'), 'utf8')) as RuleProposal;
    p.content.expectations[2]!.expected = 'exact_fixture_returned';
    await writeFile(join(dir, 'p.json'), JSON.stringify(p));
    expect(await main(['approve', '--proposal', 'p.json', '--store', 'store', '--approver', 'owner', '--acknowledge', p.contentHash], io())).toBe(2);
    expect(err.join('')).toContain('content_hash_mismatch');
  });

  it('a stale proposal and an identical re-approval are refused', async () => {
    await approveExample();
    expect(await main(['approve', '--proposal', 'p1.json', '--store', 'store', '--approver', 'owner', '--acknowledge', contentHashOf(exampleRule())], io())).toBe(2);
    expect(err.join('')).toContain('stale_proposal');
    err = [];
    expect(await main(['propose', '--rule', `${repoRoot}examples/invoice-owner-read.rule.json`, '--store', 'store', '--proposed-by', 'dev', '--out', 'p3.json'], io())).toBe(0);
    expect(await main(['approve', '--proposal', 'p3.json', '--store', 'store', '--approver', 'owner', '--acknowledge', contentHashOf(exampleRule())], io())).toBe(2);
    expect(err.join('')).toContain('no_change');
  });

  it('revisions are immutable and history is preserved across promotions', async () => {
    await approveExample();
    const changed = exampleRule();
    changed.title = 'Second revision';
    await writeFile(join(dir, 'r2.json'), JSON.stringify(changed));
    await approveExample(join(dir, 'r2.json'), 'p2.json');
    const revs = await readdir(join(dir, 'store/invoice-owner-read/revisions'));
    const promos = await readdir(join(dir, 'store/invoice-owner-read/promotions'));
    expect(revs.sort()).toEqual(['r000001.json', 'r000002.json']);
    expect(promos.sort()).toEqual(['p000001.json', 'p000002.json']);
    // Roll back explicitly by promoting revision 1 again.
    const h1 = contentHashOf(exampleRule());
    expect(await main(['promote', '--store', 'store', '--rule', 'invoice-owner-read', '--revision', '1', '--acknowledge', h1, '--by', 'owner'], io())).toBe(0);
    out = [];
    await main(['history', '--store', 'store', '--rule', 'invoice-owner-read'], io());
    expect(out.join('')).toContain(`* r1 ${h1}`);
    expect(out.join('')).toMatch(/ {2}r2 /);
  });
});

describe('run command', () => {
  it('returns incomplete when the comparison finds a dropped path, even if this run passes', async () => {
    await approveExample();
    const fake = createFake();
    const args = ['--store', 'store', '--rule', 'invoice-owner-read'];
    expect(await runCommand([...args, '--out', 'before.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).toBe(0);
    const previous = JSON.parse(await readFile(join(dir, 'before.json'), 'utf8')) as RunResult;
    previous.paths.push({ id: 'old-route', kind: 'http', route: 'http://127.0.0.1:8787/api/invoices/{id}' });
    previous.assertions.push(...previous.assertions.map((a) => ({ ...a, path: 'old-route' })));
    previous.summary.counts.passed = previous.assertions.length;
    await writeFile(join(dir, 'before.json'), JSON.stringify(previous));
    expect(await runCommand([...args, '--out', 'after.json', '--compare-to', 'before.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).toBe(2);
    expect(out.join('')).toContain('dropped');
  });
  it('rejects colliding outputs before sending requests, even with --force', async () => {
    const fake = createFake();
    await expect(runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'same.json', '--html', './same.json', '--force'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).rejects.toThrow('output paths must be distinct');
    expect(fake.requests).toHaveLength(0);
  });

  it('honors cancellation that happened before the command started', async () => {
    await approveExample();
    const fake = createFake();
    const controller = new AbortController();
    controller.abort();
    expect(await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'cancelled.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch, signal: controller.signal })).toBe(2);
    expect(fake.requests).toHaveLength(0);
  });
  it('writes a schema-valid result, prints a summary without secrets, and exits 0 when healthy', async () => {
    await approveExample();
    const fake = createFake();
    const env = baseEnv(fake);
    const code = await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'result.json'], io(env), { fetchImpl: fake.fetch });
    expect(code).toBe(0);
    const text = await readFile(join(dir, 'result.json'), 'utf8');
    const result = parseStrictJson(text) as unknown as RunResult;
    expect(result.summary.outcome).toBe('pass');
    expect(result.rule.contentHash).toBe(contentHashOf(exampleRule()));
    const printed = out.join('');
    expect(printed).toContain('Outcome: PASS');
    expect(printed).toContain('self-attested');
    for (const v of Object.values(env)) if (v.length > 25) {
      expect(printed).not.toContain(v);
      expect(text).not.toContain(v);
    }
  });

  it('exits 1 on a disclosure, 2 when blocked, 2 on a pin mismatch, and never overwrites a result file', async () => {
    await approveExample();
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    expect(await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'bad.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).toBe(1);
    expect(out.join('')).toContain('FAIL');

    const fake2 = createFake();
    expect(
      await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'blocked.json'], io({ ...baseEnv(fake2), PYX_USER_A_TOKEN: undefined }), {
        fetchImpl: fake2.fetch,
      }),
    ).toBe(2);

    expect(
      await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--revision', '7', '--out', 'pin.json'], io(baseEnv(fake2)), { fetchImpl: fake2.fetch }),
    ).toBe(2);
    const pinned = parseStrictJson(await readFile(join(dir, 'pin.json'), 'utf8')) as unknown as RunResult;
    expect(pinned.controls[0]).toEqual({ id: 'baseline', status: 'failed', diagnostic: 'baseline_pin_mismatch' });

    expect(await main(['run', '--store', 'store', '--rule', 'invoice-owner-read', '--out', 'bad.json'], io(baseEnv(fake2)))).toBe(2);
    expect(err.join('')).toContain('already exists'); // refused before assessing, not after
  });

  it('a run without an approved baseline is blocked and sends nothing', async () => {
    const fake = createFake();
    expect(await runCommand(['--store', 'empty-store', '--rule', 'invoice-owner-read', '--out', 'r.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).toBe(2);
    expect(fake.requests).toEqual([]);
  });

  it('runs the active approved revision, not a newer unapproved proposal or edited rule file', async () => {
    await approveExample();
    const edited = exampleRule();
    edited.expectations[2]!.expected = 'exact_fixture_returned'; // weaken intent in the "working tree"
    await writeFile(join(dir, 'invoice-owner-read.rule.json'), JSON.stringify(edited));
    const fake = createFake();
    fake.policy = 'permissive-authenticated';
    expect(await runCommand(['--store', 'store', '--rule', 'invoice-owner-read', '--out', 'r.json'], io(baseEnv(fake)), { fetchImpl: fake.fetch })).toBe(1);
  });

  it('rejects invalid invocations with exit 2', async () => {
    expect(await main(['run', '--rule', 'x'], io())).toBe(2);
    expect(await main(['run', '--store', 's', '--rule', 'x', '--bogus'], io())).toBe(2);
    expect(await main(['run', '--store', 's', '--rule', 'x', '--expect-hash', 'md5:1'], io())).toBe(2);
    expect(await main(['nope'], io())).toBe(2);
  });
});

describe('the assessment path cannot write approvals', () => {
  it('commands/run.ts does not import the approval writer, directly or transitively', async () => {
    const srcRoot = new URL('../src/', import.meta.url);
    const seen = new Set<string>();
    const visit = async (rel: string): Promise<void> => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const text = await readFile(new URL(rel, srcRoot), 'utf8');
      for (const m of text.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) {
        const target = new URL(m[1]!.replace(/\.js$/, '.ts'), new URL(rel, srcRoot)).href.slice(srcRoot.href.length);
        await visit(target);
      }
    };
    await visit('commands/run.ts');
    expect([...seen].some((f) => f.includes('approval/'))).toBe(false);
    expect(seen.has('engine.ts')).toBe(true);
  });
});
