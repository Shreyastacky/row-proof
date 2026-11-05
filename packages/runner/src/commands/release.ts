/**
 * Release review commands.
 *
 *   pyx compare <before.json> <after.json>   who gained or lost access between two runs
 *   pyx repro <result.json> --store <dir>     a reproduction pack for every failing cell
 *
 * Both read validated result files and the read-only approved baseline. Neither
 * loads credentials: a repro pack refers to credentials by env variable name only.
 */
import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BaselineError,
  findCredentialValues,
  hashesEqual,
  openFileBaselineReader,
  parseStrictJson,
  StrictJsonError,
  validateSchema,
  type AuthenticatedActor,
  type RuleContent,
  type RunResult,
} from '@pyx/contracts';
import { compareResults, CompareError, renderComparison, renderComparisonMarkdown } from '../compare.js';
import { plannedPaths } from '../engine.js';
import { explain } from '../explain.js';
import { readTextFile, UsageError, type CliIO } from '../io.js';
import { assertOutputSafe } from '../report.js';

export async function loadResult(io: CliIO, p: string): Promise<RunResult> {
  let raw: unknown;
  try {
    raw = parseStrictJson(await readTextFile(resolve(io.cwd, p), 1024 * 1024), { maxBytes: 1024 * 1024 });
  } catch (e) {
    if (e instanceof StrictJsonError) throw new UsageError(`${p}: ${e.message}`);
    throw e;
  }
  const v = validateSchema('RunResult', raw);
  if (!v.ok) throw new UsageError(`${p} is not a valid Pyx result`);
  return v.value;
}

function label(r: RunResult, fallback: string): string {
  return r.source.commit ? r.source.commit.slice(0, 10) : fallback;
}

const COMPARE_HELP = `pyx compare <before.json> <after.json> [options]

Shows who gained or lost access between two runs of the same approved rule,
cell by cell (request path, user, record).

Options:
  --before-label <text>   name for the first run (default: its commit or "before")
  --after-label <text>    name for the second run (default: its commit or "after")
  --out <file>            also write the comparison as JSON
  --summary-md <file>     append a Markdown table (e.g. $GITHUB_STEP_SUMMARY)

Exit codes: 0 no violations and fully verified, 1 someone can read what they must
not (new or still present) or an owner lost access, 2 incomplete or not comparable.
`;

export async function compareCommand(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      'before-label': { type: 'string' },
      'after-label': { type: 'string' },
      out: { type: 'string' },
      'summary-md': { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    io.stdout(COMPARE_HELP);
    return 0;
  }
  if (positionals.length !== 2) throw new UsageError('usage: pyx compare <before.json> <after.json>');
  for (const flag of ['before-label', 'after-label'] as const) {
    const v = values[flag];
    if (v !== undefined && (v.length > 60 || /[\u0000-\u001f]/.test(v))) throw new UsageError(`--${flag} must be at most 60 printable characters`);
  }
  const before = await loadResult(io, positionals[0]!);
  const after = await loadResult(io, positionals[1]!);
  let c;
  try {
    c = compareResults(before, after, {
      before: values['before-label'] ?? label(before, 'before'),
      after: values['after-label'] ?? label(after, 'after'),
    });
  } catch (e) {
    if (e instanceof CompareError) {
      io.stderr(`${e.message}\n`);
      return 2;
    }
    throw e;
  }
  const text = renderComparison(c);
  assertOutputSafe(text, []);
  io.stdout(text);
  if (values.out) {
    const out = resolve(io.cwd, values.out);
    if (existsSync(out) && !values.force) throw new UsageError(`output file already exists: ${out} (use --force to replace it)`);
    await writeFile(out, JSON.stringify(c, null, 2) + '\n', { mode: 0o644 });
  }
  if (values['summary-md']) await appendFile(resolve(io.cwd, values['summary-md']), renderComparisonMarkdown(c), 'utf8');
  return c.exitCode;
}

// ---------------------------------------------------------------- repro

const REPRO_HELP = `pyx repro <result.json> --store <approval store> [--out <dir>]

Writes a reproduction pack for every failing cell of a run: a README a
developer can follow, a repro.sh that replays each failing request with curl,
the approved rule, and the result. Credentials are referenced by env variable
name only; run the script with your own local credentials file.
`;

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildReproPack(result: RunResult, content: RuleContent): { readme: string; script: string; failing: number } {
  const failing = result.assertions.filter((a) => a.status === 'failed');
  const paths = new Map(plannedPaths(content).map((p) => [p.id, p] as const));
  const actors = new Map(content.actors.map((a) => [a.ref, a] as const));
  const fixtures = new Map(content.fixtures.map((f) => [f.ref, f] as const));
  const r = content.resource;
  const apiKeyVar = content.target.apiKey.credential.name;
  const legacyAnon = content.target.apiKey.kind === 'legacy-anon';

  const script: string[] = [
    '#!/usr/bin/env bash',
    '# Pyx reproduction pack. Replays each failing request against your LOCAL disposable stack.',
    '# Usage: ./repro.sh <credentials.env>   (the file `pyx fixture provision` wrote)',
    '# Synthetic records only. This script contains no credentials.',
    'set -euo pipefail',
    'if [ "$#" -ne 1 ]; then echo "usage: $0 <credentials.env>" >&2; exit 2; fi',
    'set -a; . "$1"; set +a',
    'reproduced=0',
    '',
  ];
  const readme: string[] = [
    `# Reproduce: ${content.title}`,
    '',
    `Rule \`${content.ruleId}\` revision ${result.rule.revision ?? '-'} (\`${(result.rule.contentHash ?? '').slice(0, 19)}…\`), run \`${result.runId}\` at ${result.observedAt.startedAt}.`,
    '',
    failing.length === 0
      ? 'This run has no failing assertions, so there is nothing to reproduce.'
      : `${failing.length} failing check${failing.length === 1 ? '' : 's'}. Each is one request by one user for one synthetic record.`,
    '',
  ];

  for (const a of failing) {
    const path = paths.get(a.path);
    const actor = actors.get(a.actorRef);
    const fixture = fixtures.get(a.fixtureRef);
    if (!path || !actor || !fixture) continue;
    const e = explain(a.diagnostic);
    const bearerVar = actor.kind === 'authenticated' ? (actor as AuthenticatedActor).credential.name : legacyAnon ? apiKeyVar : null;
    let url: string;
    const headers: string[] = [];
    if (path.spec === null) {
      url = `${content.target.allowedOrigin}/rest/v1/${r.table}?select=${r.idColumn},${r.ownerColumn},${r.markerColumn}&${r.idColumn}=eq.${fixture.id}&limit=2`;
      headers.push(`-H "apikey: \${${apiKeyVar}}"`);
      if (r.schema !== 'public') headers.push(`-H ${sh(`Accept-Profile: ${r.schema}`)}`);
      if (bearerVar) headers.push(`-H "Authorization: Bearer \${${bearerVar}}"`);
    } else if (path.spec.kind === 'rpc') {
      url = `${content.target.allowedOrigin}/rest/v1/rpc/${path.spec.function}?${path.spec.idArg}=${fixture.id}`;
      headers.push(`-H "apikey: \${${apiKeyVar}}"`);
      if (r.schema !== 'public') headers.push(`-H ${sh(`Accept-Profile: ${r.schema}`)}`);
      if (bearerVar) headers.push(`-H "Authorization: Bearer \${${bearerVar}}"`);
    } else {
      url = `${path.spec.origin}${path.spec.pathTemplate.replace('{id}', fixture.id)}`;
      if (actor.kind === 'authenticated') headers.push(`-H "Authorization: Bearer \${${(actor as AuthenticatedActor).credential.name}}"`);
    }
    const who = actor.kind === 'authenticated' ? `${actor.ref} (signed in)` : `${actor.ref} (no session)`;
    const expect =
      a.expected === 'fixture_not_disclosed'
        ? `must not see ${fixture.ref}; the response should not contain ${fixture.marker}`
        : `must see their own ${fixture.ref} (${fixture.marker})`;
    readme.push(`## ${a.id} on \`${a.path}\``, '', `- Who: ${who}`, `- Rule: ${expect}`, `- Observed: ${a.diagnostic}${a.httpStatus === null ? '' : `, HTTP ${a.httpStatus}`}`, `- What it means: ${e.meaning}`, `- Next: ${e.next}`, '');
    readme.push('```bash', `curl -sS "${url}" ${headers.join(' ')}`, '```', '');
    const check =
      a.expected === 'fixture_not_disclosed'
        ? `if printf '%s' "$body" | grep -q ${sh(fixture.marker)}; then echo "REPRODUCED ${a.path}/${a.id}: ${actor.ref} received ${fixture.ref}"; reproduced=$((reproduced+1)); else echo "not reproduced ${a.path}/${a.id}"; fi`
        : `if printf '%s' "$body" | grep -q ${sh(fixture.marker)}; then echo "not reproduced ${a.path}/${a.id}"; else echo "REPRODUCED ${a.path}/${a.id}: ${actor.ref} cannot read ${fixture.ref}"; reproduced=$((reproduced+1)); fi`;
    script.push(`# ${a.id} on ${a.path}: ${a.diagnostic}`, `body=$(curl -sS "${url}" ${headers.join(' ')} || true)`, check, '');
  }
  script.push('echo "$reproduced reproduced"', '[ "$reproduced" -gt 0 ]', '');
  readme.push(
    '## Run all of them',
    '',
    '```bash',
    './repro.sh .pyx/local.env',
    '```',
    '',
    'After a fix, re-run `pyx run` and compare the two results with `pyx compare before.json after.json`.',
    '',
    '_Synthetic records on a disposable local stack only. Not a certification and not evidence about production._',
    '',
  );
  return { readme: readme.join('\n'), script: script.join('\n'), failing: failing.length };
}

export async function reproCommand(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { store: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    io.stdout(REPRO_HELP);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('usage: pyx repro <result.json> --store <approval store> [--out <dir>]');
  const store = values.store ?? io.env.PYX_APPROVAL_STORE;
  if (!store) throw new UsageError('missing --store (or PYX_APPROVAL_STORE)');
  const result = await loadResult(io, positionals[0]!);
  if (result.rule.revision === null || result.rule.contentHash === null) throw new UsageError('the result has no approved revision to reproduce');
  let content: RuleContent;
  try {
    const rev = await openFileBaselineReader(resolve(io.cwd, store)).readRevision(result.rule.ruleId, result.rule.revision);
    if (!hashesEqual(rev.revision.contentHash, result.rule.contentHash)) throw new UsageError('the store holds a different rule for this revision than the one the result was produced from');
    content = rev.revision.content;
  } catch (e) {
    if (e instanceof BaselineError) throw new UsageError(`approved revision unavailable: ${e.code}`);
    throw e;
  }
  const pack = buildReproPack(result, content);
  const files: Array<[string, string, number]> = [
    ['README.md', pack.readme, 0o644],
    ['repro.sh', pack.script, 0o755],
    ['rule.json', JSON.stringify(content, null, 2) + '\n', 0o644],
    ['result.json', JSON.stringify(result, null, 2) + '\n', 0o644],
  ];
  for (const [name, text] of files) {
    assertOutputSafe(text, []);
    if (findCredentialValues(text).length > 0) throw new UsageError(`refusing to write ${name}: it contains a credential-shaped value`);
  }
  const dir = resolve(io.cwd, values.out ?? `pyx-repro-${result.runId.slice(0, 8)}`);
  if (existsSync(dir) && !values.force) throw new UsageError(`output directory already exists: ${dir} (use --force to replace its files)`);
  await mkdir(dir, { recursive: true });
  for (const [name, text, mode] of files) await writeFile(join(dir, name), text, { mode });
  io.stdout(`wrote ${dir} (${pack.failing} failing check${pack.failing === 1 ? '' : 's'})\n`);
  return 0;
}
