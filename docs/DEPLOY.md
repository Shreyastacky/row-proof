# Deploying the website

`apps/web` is a static site with no build step. Security and caching headers are in `apps/web/_headers` (Cloudflare Pages, Netlify) and `apps/web/vercel.json` (Vercel).

## Cloudflare Pages (recommended)

The workflow `.github/workflows/site.yml` deploys on every push that touches `apps/web`:
- `main` deploys to production;
- any other branch gets its own preview URL.

One-time setup:

1. **API token.** In the Cloudflare dashboard, go to **My Profile → API Tokens → Create Token → Custom token**. Grant the permission **Account → Cloudflare Pages → Edit**, scoped to your account.
2. **Account ID.** It's shown on the right of any zone's Overview page, or under **Workers & Pages**.
3. **GitHub secrets.** In the repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. **Deploy.** Push to the branch, or run the workflow from **Actions → site → Run workflow**. The first run creates a Pages project named `pyx`, with its site at `https://pyx.pages.dev` if that name is free. If it isn't, change `PROJECT` in the workflow.
5. **Custom domain (optional).** Go to **Workers & Pages → pyx → Custom domains → Set up a domain**.

The alternative needs no secrets: in **Workers & Pages → Create → Pages → Connect to Git**, pick this repository and set:
- **Framework preset:** None.
- **Build command:** leave it empty.
- **Build output directory:** `apps/web`.

## After the first deploy

Check these:
- `https://<your-site>/` loads, and the lens follows the pointer.
- `https://<your-site>/.well-known/security.txt` is served.
- `https://<your-site>/verify.html`: "41 vs 42" shows two gained-access lines.
- Response headers include `Content-Security-Policy`, plus `Cache-Control` on `/assets/fonts/*`.

Then set `contactEmail`, `bookingUrl` and the checkout links in `apps/web/config.js`, and push.
