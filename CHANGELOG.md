# Changelog

All notable changes to `pyx-cli`. Versions follow [semantic versioning](https://semver.org); the result and rule schemas are versioned separately (`urn:pyx:schemas:v1`).

## 0.1.0 — unreleased

First public release.

- **Approved access rules.** Rules are content-hashed (RFC 8785 + SHA-256) and approved by the data owner. Promotions bind the approval record's digest. CI reads the baseline from a protected branch.
- **Real checks through every door.** Synthetic users and records on a disposable local Supabase stack, checked through the Data API, RPC functions and loopback application routes, with per-path owner controls.
- **Fails closed.** Identity is verified against the target's Auth service. The anonymous context is validated. Fixtures are re-checked after the reads. Disclosure by id or marker fails. Every untrustworthy condition is blocked, never passed.
- **Release review.** `pyx compare` and `pyx run --compare-to` show who gained or lost access. `pyx repro` writes a credential-free curl script for each failure.
- **Evidence.**
  - HTML report that opens with the access review;
  - JUnit and Markdown summaries;
  - a request ledger (`--requests`);
  - an in-browser result verifier on the website.
- **Onboarding.** `pyx init`, `pyx fixture provision | verify`, `pyx doctor`.
- **Measured.** A public mutation benchmark generated from real runs (`docs/BENCHMARK.md`).
