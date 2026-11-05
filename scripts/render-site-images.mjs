#!/usr/bin/env node
// Renders site images with a headless browser (dev-only; needs Playwright installed):
//   apps/web/assets/report-preview.png  screenshot of the sample report (1200x900)
//   apps/web/assets/og.png              social share card (1200x630)
//   [--screens <dir>]                   optional full-page screenshots of the site for review
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const url = (f) => pathToFileURL(join(web, f)).href;

const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url('sample-report.html'));
  await page.addStyleTag({ content: '.rp-noprint{display:none!important}' });
  await page.screenshot({ path: join(web, 'assets', 'report-preview.png') });

  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.goto(url('og-card.html'));
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
}
