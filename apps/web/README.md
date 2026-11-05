# RowProof website

A static site with no framework, build step, cookies, analytics or third-party requests. It is styled by the same design system as RowProof's HTML evidence reports.

| File | Purpose |
| --- | --- |
| `index.html` | Landing page: problem, how it works, comparison, evidence, pricing, FAQ |
| `config.js` | **Edit this:** contact email, booking link, checkout links per offer |
| `sample-report.html` | Generated from real runs in `examples/results/` (release 41 pass, release 42 leak) |
| `privacy.html` | Plain privacy statement |
| `assets/theme.css` | Generated from `packages/runner/src/design/theme.ts`; do not edit |
| `assets/site.css`, `assets/site.js` | Site layout, the animated ledger instrument, and small progressive enhancements |
| `assets/fonts/` | Self-hosted Newsreader, Schibsted Grotesk and IBM Plex Mono (OFL-1.1; licence texts alongside) |
| `assets/og.png`, `assets/report-preview.png` | Rendered by `scripts/render-site-images.mjs` |
| `_headers`, `vercel.json` | Strict security headers (CSP, no framing, HSTS) |

## Regenerate generated files

```bash
pnpm build && node scripts/build-site.mjs
```

```bash
node scripts/render-site-images.mjs
```

The second command serves the site over a local HTTP server (browsers refuse web fonts from `file://`) and needs Playwright and is only required when the report design or sample results change.

## Deploy (free tiers are enough)

- **Vercel:** import the repository, set *Root Directory* to `apps/web`, framework *Other*, no build command.
- **Netlify / Cloudflare Pages:** publish directory `apps/web`, no build command. `_headers` applies the security headers.
- **GitHub Pages:** publish `apps/web` with a Pages workflow. Pages ignores `_headers`, so prefer the options above.

Then point your domain at it and update `contactEmail` to an address on that domain.

## Taking payments

Every pricing button reads `config.js`. With no checkout link it opens a pre-filled email brief, which is the recommended flow for the first pilots: scope first, then invoice. When you are ready for self-serve checkout, create a payment link per offer in Stripe (Payment Links), Polar or Lemon Squeezy and paste it into `checkout`.
