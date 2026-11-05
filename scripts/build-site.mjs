#!/usr/bin/env node
// Builds generated parts of apps/web from the single design source and real results:
//   apps/web/assets/theme.css    <- packages/runner/src/design/theme.ts (THEME_CSS)
//   apps/web/sample-report.html  <- examples/results/*.json via the real report renderer
//   apps/web/favicon.svg         <- LOGO_SVG
// Run after `pnpm build`.  Images (report preview, OG card) are rendered separately by
// scripts/render-site-images.mjs because they need a browser.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const web = join(repo, 'apps', 'web');
const { THEME_CSS, LOGO_SVG } = await import(join(repo, 'packages/runner/dist/design/theme.js'));
const { renderHtmlReport } = await import(join(repo, 'packages/runner/dist/html-report.js'));
const { validateSchema } = await import(join(repo, 'packages/contracts/dist/index.js'));

mkdirSync(join(web, 'assets'), { recursive: true });
writeFileSync(join(web, 'assets', 'theme.css'), `/* GENERATED from packages/runner/src/design/theme.ts by scripts/build-site.mjs. Do not edit. */\n${THEME_CSS.trim()}\n`);

const dir = join(repo, 'examples', 'results');
const results = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const v = validateSchema('RunResult', JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!v.ok) throw new Error(`${f} is not a valid RunResult`);
    return v.value;
  });
const report = renderHtmlReport(results, { client: 'Invoice Portal (demo)', preparedBy: 'RowProof' }).replace(
  '<body class="rp rp-report">',
  '<body class="rp rp-report">\n<div class="rp-noprint" style="text-align:center;padding:10px 16px;font-size:13px;color:#a3b1c4;border-bottom:1px solid rgba(148,170,200,.14)">Sample report generated from a real run against a deliberately broken local policy · <a href="index.html">Back to RowProof</a></div>',
);
writeFileSync(join(web, 'sample-report.html'), report);

const favicon = LOGO_SVG.replace('class="rp-logo" ', 'xmlns="http://www.w3.org/2000/svg" width="32" height="32" ').replace(' aria-hidden="true" focusable="false"', '');
writeFileSync(join(web, 'favicon.svg'), favicon + '\n');
console.log(`site built: theme.css, sample-report.html (${results.length} runs), favicon.svg`);
