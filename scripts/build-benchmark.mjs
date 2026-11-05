#!/usr/bin/env node
// Writes docs/BENCHMARK.md (and apps/web/assets/benchmark.json) from an integration
// harness summary. Every row is a real run against a disposable local Supabase stack.
//
// Usage: node scripts/build-benchmark.mjs [artifacts/integration/<stamp>/summary.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
let file = process.argv[2];
if (!file) {
  const dir = join(repo, 'artifacts', 'integration');
  const latest = readdirSync(dir).sort().at(-1);
  if (!latest) throw new Error('no integration artifacts; run `pnpm integration` first');
  file = join(dir, latest, 'summary.json');
}
const s = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(s.benchmark) || s.benchmark.length === 0) throw new Error(`${file} has no benchmark rows`);

const rows = s.benchmark;
const tally = { detected: 0, missed: 0, blocked: 0, unsupported: 0 };
for (const r of rows) tally[r.got]++;
const asExpected = rows.filter((r) => r.got === r.want).length;
const mutations = rows.filter((r) => r.want === 'detected');
const faults = rows.filter((r) => r.want === 'blocked');
const gaps = rows.filter((r) => r.want === 'missed');

const mark = (r) => (r.got === r.want ? '' : ' ⚠ unexpected');
const line = (r) => `| ${r.mutation} | ${r.layer} | ${r.paths.join(', ')} | **${r.got}**${mark(r)} |`;

const md = `# Pyx mutation benchmark

Each row is one deliberate change made to a throwaway local Supabase stack, followed by a real
\`pyx run\` over HTTP. Nothing here is simulated. The harness that produces it is
\`tests/integration/harness.mjs\`; regenerate this page with \`pnpm integration\` and
\`node scripts/build-benchmark.mjs\`.

Run: ${s.ranAt} · Node ${s.environment.node} · Docker ${s.environment.docker} · Supabase CLI ${s.environment.supabaseCli}

| | Count |
| --- | --- |
| Detected (reported as a violation, exit 1) | ${tally.detected} |
| Blocked (no trustworthy assessment, exit 2, never a pass) | ${tally.blocked} |
| Missed (the run passed) | ${tally.missed} |
| Unsupported (outside v1 scope, not assessed) | ${tally.unsupported} |
| Behaved as designed | ${asExpected} of ${rows.length} |

## Access regressions: these must be detected

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
${mutations.map(line).join('\n')}

## Broken test setups: these must block, never pass

A tool that turns a broken test environment into a green check is worse than no tool.

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
${faults.map(line).join('\n')}

## Known gaps: published on purpose

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
${gaps.map(line).join('\n')}

Pyx checks the request paths a rule lists. The RPC bug above is detected when the rule lists the
RPC and missed when it does not. \`pyx init\` and \`pyx doctor\` list the paths a rule covers so the gap is visible.

## Out of scope in v1 (reported as not assessed, never as a pass)

- Writes (INSERT, UPDATE, DELETE) and their policies
- Tenant membership, shared records and delegated roles
- Storage buckets, Realtime and Edge Functions
- Remote or production projects (local disposable stacks only)
`;

writeFileSync(join(repo, 'docs', 'BENCHMARK.md'), md);
writeFileSync(
  join(repo, 'apps', 'web', 'assets', 'benchmark.json'),
  JSON.stringify({ ranAt: s.ranAt, tally, asExpected, total: rows.length, rows: rows.map(({ mutation, layer, want, got }) => ({ mutation, layer, want, got })) }, null, 2) + '\n',
);
// The site section: static HTML between markers, so it needs no script and passes the CSP.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tick = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
const caught = mutations.filter((r) => r.got === 'detected').length;
const safe = faults.filter((r) => r.got === 'blocked').length;
const section = `<!-- benchmark:start -->
  <div class="wrap center">
    <h2 class="reveal">Tested on real leaks.</h2>
    <div class="score reveal">
      <div class="score__item score__item--pass"><div class="score__n">${caught}/${mutations.length}</div><div class="score__l">seeded leaks caught</div></div>
      <div class="score__item score__item--warn"><div class="score__n">${safe}/${faults.length}</div><div class="score__l">broken setups stopped</div></div>
      <div class="score__item"><div class="score__n">${gaps.length}</div><div class="score__l">miss, published</div></div>
    </div>
    <p class="sub reveal"><a class="link" href="#" data-repo="/blob/HEAD/docs/BENCHMARK.md">See every run</a></p>
  </div>
<!-- benchmark:end -->`;
const indexPath = join(repo, 'apps', 'web', 'index.html');
const index = readFileSync(indexPath, 'utf8');
if (!/<!-- benchmark:start -->[\s\S]*<!-- benchmark:end -->/.test(index)) throw new Error('benchmark markers missing in apps/web/index.html');
writeFileSync(indexPath, index.replace(/<!-- benchmark:start -->[\s\S]*<!-- benchmark:end -->/, () => section));

console.log(`docs/BENCHMARK.md: ${rows.length} rows, ${asExpected} as designed (${JSON.stringify(tally)})`);
