# Publishability audit (5 November 2026)

Scores out of 10. "Before" is the state after the minimal website pass. "After" is this pass, measured the same way.

| Area | Before | After | Evidence after this pass | What caps it |
| --- | --- | --- | --- | --- |
| Core product | 8 | 9 | 261 unit tests. 33/33 real-stack scenarios plus a ledger check. First run on GitHub-hosted runners is green: unit tests, package smoke, site check, the full real-stack harness and the base-branch assessment ([run 1](https://github.com/Shreyastacky/row-proof/actions/runs/41991447363)). | Windows/macOS untested; no independent security review |
| Packaging | 6 | 8.5 | Stale schema removed from the tarball (folder cleaned on every build); author set; npm README rewritten for the current CLI; CHANGELOG; provenance release workflow | Not yet published to npm |
| Website | 7 | 9.5 | Lighthouse 98–100 in all four categories on index, trust and verify, mobile and desktop. Layout shift 0.66 → 0. AA contrast. Accessible names. Text ≥ 12px. Cache headers, robots.txt, 404 page, touch icon | Not deployed; no canonical URL or sitemap until there is a domain |
| Trust | 6 | 7 | Request ledger, verifier, benchmark, trust page, security.txt, CODEOWNERS, bug and security templates | No founder identity, customers, testimonials or independent review; Gmail contact |
| Legal/commercial | 4 | 5 | README license text corrected: client services are permitted by the FSL, and the old text implied otherwise. Terms and privacy pages exist | Placeholder licensor; terms not reviewed by a lawyer; no payment links; no domain; "Pyx" clashes with Astral's pyx |
| Repo hygiene | 6 | 8.5 | CODEOWNERS for the baseline, workflows and schemas; bug template; private security route; CHANGELOG; deploy guide | Branch protection not configured; work not merged to `main` |
| Deployment | 2 | 6 | Cloudflare Pages workflow (production from `main`, previews per branch); deploy guide | Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, or the dashboard Git integration |
| **Overall** | **~6** | **~7.6** | | |

## Owner actions that unlock the remaining points

1. **Name.** Get a clearance search on "Pyx", or rename. Renaming is mechanical. +1 legal.
2. **Deploy.**
   - Add the two Cloudflare secrets (docs/DEPLOY.md).
   - Buy a domain and use a domain email in `config.js` and `security.txt`.
   - Set a canonical URL.

   +3 deployment, +1 trust.
3. **Publish.** Tag `v0.1.0` after configuring npm trusted publishing. +1.5 packaging.
4. **Legal.** Put your legal name in `LICENSE.md`, have the terms reviewed, and add Stripe payment links. +2 legal.
5. **People.**
   - Add a founder section with your name and photo.
   - Run the first three founding-customer setups and publish their reviews.
   - Commission an independent review of the runner.

   +3 trust.
6. **Protect `main`.** Require code-owner review; then merge this branch. +1.5 hygiene.
