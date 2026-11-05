import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schemaBundle, validateRuleContent, type RunResult } from '@rowproof/contracts';
import { renderJunit, renderMarkdownSummary } from '../src/ci-formats.js';
import { scaffoldRule } from '../src/commands/tools.js';
import { runCommand } from '../src/commands/run.js';
import { main } from '../src/cli.js';
import { EXPLANATIONS } from '../src/explain.js';
import { esc, renderHtmlReport } from '../src/html-report.js';
import type { CliIO } from '../src/io.js';
import { baseEnv, createFake } from './fake-supabase.js';
import { repoRoot, runEngine } from './helpers.js';

async function sampleResults(): Promise<{ pass: RunResult; fail: RunResult; blocked: RunResult; secrets: string[] }> {
  const ok = createFake();
  const pass = await runEngine(ok.fetch, { env: baseEnv(ok) });
  const bad = createFake();
  bad.policy = 'permissive-authenticated';
  const fail = await runEngine(bad.fetch, { env: baseEnv(bad) });
  const blk = createFake();
  const blocked = await runEngine(blk.fetch, { env: { ...baseEnv(blk), ROWPROOF_USER_A_TOKEN: undefined } });
  return { pass: pass.result, fail: fail.result, blocked: blocked.result, secrets: [...pass.sensitiveValues, ...fail.sensitiveValues] };
}

describe('explanations', () => {
  it('cover every diagnostic code in the schema, with a meaning and a next step', () => {
    const codes = ((schemaBundle as { $defs: { DiagnosticCode: { enum: string[] } } }).$defs.DiagnosticCode.enum).slice().sort();
    expect(Object.keys(EXPLANATIONS).sort()).toEqual(codes);
    for (const e of Object.values(EXPLANATIONS)) {
      expect(e.meaning.length).toBeGreaterThan(10);
      expect(e.next.length).toBeGreaterThan(3);
    }
  });
});

describe('HTML evidence report', () => {
  it('renders the verdict, matrix, plain-language findings, and scope limits without scripts or credentials', async () => {
    const { fail, secrets } = await sampleResults();
    const html = renderHtmlReport([fail], { client: 'Acme <script>alert(1)</script>', preparedBy: 'Northwind Agency' });
    expect(html).toContain('Proof matrix');
    expect(html).toContain('>Fail<');
    expect(html).toContain('A user who must not see this record received it');
    expect(html).toContain('not a security certification');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Acme &lt;script&gt;');
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // no external requests or links other than the target origin
    for (const s of secrets) expect(html).not.toContain(s);
  });

  it('shows history when given several runs and keeps the latest as the headline', async () => {
    const { pass, fail } = await sampleResults();
    const later = { ...pass, observedAt: { startedAt: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:00:01.000Z' } };
    const html = renderHtmlReport([later, fail]);
    expect(html).toContain('2 runs in this report');
    expect(html.indexOf('rp-verdict rp-pass')).toBeGreaterThan(-1);
  });

  it('escapes all five HTML-significant characters', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('CI formats', () => {
  it('JUnit marks failures, blocked checks and failed controls, and is well-formed text', async () => {
    const { pass, fail, blocked } = await sampleResults();
    expect(renderJunit(pass)).toContain('tests="6" failures="0" errors="0" skipped="0"');
    const f = renderJunit(fail);
    expect(f).toContain('failures="2"');
    expect((f.match(/<failure /g) ?? []).length).toBe(2);
    const b = renderJunit(blocked);
    expect(b).toMatch(/errors="[1-9]/);
    expect(b).toContain('name="control identity:user-a"');
    expect(f).not.toMatch(/[<>]\s*[<>]{2}/);
  });

  it('Markdown summary states the outcome and escapes table-breaking characters', async () => {
    const { fail } = await sampleResults();
    const md = renderMarkdownSummary(fail);
    expect(md).toContain('RowProof: FAIL');
    expect(md).toContain('❌ FAIL');
    const hostile = { ...fail, rule: { ...fail.rule, ruleId: 'x|y`z' } };
    expect(renderMarkdownSummary(hostile)).toContain('x\\|y\\`z');
  });
});

describe('init', () => {
  it('scaffolds a valid, supported rule with fresh random ids for any user-owned table', () => {
    const a = scaffoldRule({ table: 'project_notes', ownerColumn: 'author_id', idColumn: 'id', markerColumn: 'title', schema: 'public', ruleId: 'notes-owner-read', projectId: 'app', origin: 'http://127.0.0.1:54321', noun: 'project-note' });
    const b = scaffoldRule({ table: 'project_notes', ownerColumn: 'author_id', idColumn: 'id', markerColumn: 'title', schema: 'public', ruleId: 'notes-owner-read', projectId: 'app', origin: 'http://127.0.0.1:54321', noun: 'project-note' });
    const v = validateRuleContent(a);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.issues).toEqual([]);
    expect(a.expectations).toHaveLength(6);
    expect(a.fixtures[0]!.id).not.toBe(b.fixtures[0]!.id);
  });

  it('rejects identifiers that are not plain lowercase SQL names', async () => {
    const io: CliIO = { stdout: () => undefined, stderr: () => undefined, env: {}, cwd: tmpdir() };
    expect(await main(['init', '--table', 'Invoices; drop', '--owner-column', 'owner_id', '--marker-column', 'm'], io)).toBe(2);
  });
});

describe('run output safety', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rowproof-out-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('an existing output path stops the run before any request is sent', async () => {
    await writeFile(join(dir, 'r.json'), '{}');
    const fake = createFake();
    const err: string[] = [];
    const io: CliIO = { stdout: () => undefined, stderr: (s) => err.push(s), env: baseEnv(fake), cwd: dir };
    expect(await main(['run', '--store', `${repoRoot}baseline`, '--rule', 'invoice-owner-read', '--out', 'r.json'], io)).toBe(2);
    expect(err.join('')).toContain('already exists');
    expect(fake.requests).toEqual([]);
    expect(await readFile(join(dir, 'r.json'), 'utf8')).toBe('{}');
  });

  it('writes HTML, JUnit and an appended Markdown summary alongside the JSON result', async () => {
    const fake = createFake();
    const out: string[] = [];
    const io: CliIO = { stdout: (s) => out.push(s), stderr: () => undefined, env: baseEnv(fake), cwd: dir };
    await writeFile(join(dir, 'summary.md'), '# existing\n');
    const code = await runCommand(['--store', `${repoRoot}baseline`, '--rule', 'invoice-owner-read', '--out', 'r.json', '--html', 'r.html', '--junit', 'j.xml', '--summary-md', 'summary.md'], io, { fetchImpl: fake.fetch });
    expect(code).toBe(0);
    expect(await readFile(join(dir, 'r.html'), 'utf8')).toContain('Proof matrix');
    expect(await readFile(join(dir, 'j.xml'), 'utf8')).toContain('<testsuites');
    const md = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(md.startsWith('# existing\n')).toBe(true);
    expect(md).toContain('RowProof: PASS');
  });
});
