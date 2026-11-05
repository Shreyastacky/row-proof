#!/usr/bin/env node
// Renders site images with a headless browser (dev-only; needs Playwright installed):
//   apps/web/assets/report-preview.png  screenshot of the sample report (1200x900)
//   apps/web/assets/og.png              social share card (1200x630)
//   [--screens <dir>]                   optional full-page screenshots of the site for review
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('Playwright is not installed. Install it globally or run `npx playwright@<version>`; this script is optional.');
  process.exit(2);
}
const { values } = parseArgs({ options: { screens: { type: 'string' } } });
const repo = fileURLToPath(new URL('..', import.meta.url));
const web = join(repo, 'apps', 'web');
// Serve over http: browsers refuse web fonts from file:// URLs, which would render fallback faces.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(web, path || 'index.html');
  if (!file.startsWith(web)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const url = (f) => base + f;

const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url('sample-report.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.rp-noprint{display:none!important}' });
  await page.screenshot({ path: join(web, 'assets', 'report-preview.png') });

  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.goto(url('og-card.html'));
  await og.evaluate(() => document.fonts.ready);
  await og.screenshot({ path: join(web, 'assets', 'og.png') });

  if (values.screens) {
    mkdirSync(values.screens, { recursive: true });
    for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const p = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
      await p.goto(url('index.html'));
      await p.waitForTimeout(300);
      await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in')));
      await p.screenshot({ path: join(values.screens, `site-${name}.png`), fullPage: true });
      await p.screenshot({ path: join(values.screens, `site-${name}-hero.png`) });
    }
    const r = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await r.goto(url('sample-report.html'));
    await r.screenshot({ path: join(values.screens, 'report-full.png'), fullPage: true });
  }
  console.log('rendered report-preview.png and og.png');
} finally {
  await browser.close();
  server.close();
}
