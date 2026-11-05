# Implementation roadmap

Initial plan: 5 November 2026. Updated 5 November 2026 after implementing Phases 1–5. Every item below is unfinished unless explicitly marked complete, and "complete" names the check that was actually run.

## Status at a glance

| Phase | State | Evidence |
| --- | --- | --- |
| 1 Contracts and baseline semantics | **complete** | 154 contract tests; `pnpm check:generated` |
| 2 Disposable fixture | **complete** | Fresh clone: `pnpm integration` provisions and verifies fixtures on a real stack |
| 3 Runner | **complete** | 93 runner unit tests + real-HTTP scenarios |
| 4 Sensitivity and failure tests | **complete** | `pnpm integration`: 33/33 scenarios as expected, real local Supabase; [benchmark](docs/BENCHMARK.md) 16/16 as designed |
| 5 Reproducible CI | **implemented; locally reproduced; GitHub-hosted run pending** | Workflow steps executed from a fresh clone in this environment; the workflow has not yet run on GitHub (it triggers on PRs and on `main`) |
| First technical milestone (1–5 from a fresh checkout) | **met locally**; confirm on GitHub Actions | See "Milestone gate" below |
| Product pass (Pyx) | **complete; see below** | rename, audit fixes, onboarding, reports, npm package, website |
| Audit response + release review | **complete; see below** | audit fixes, request paths, `compare` / `--compare-to` / `repro`, benchmark |
| 6–9 | not started | — |

### Milestone gate (run 5 November 2026)

From `git clone --branch claude/happy-gauss-8cs58v` into an empty directory: `pnpm install --frozen-lockfile`, then `pnpm verify` (exit 0; 147 + 11 + 53 tests), then `pnpm integration` (exit 0; 24/24 scenarios, healthy and throwaway broken-policy instances, 0 containers left), then the `assess-with-base-branch-baseline` job steps (exit 3 against `origin/main`, which has no baseline yet, so NOT RUN; exit 0 with this branch as the trusted ref). Environment: Linux, Node 22.23.4, Docker 29.9.2, Supabase CLI 2.122.1, images pulled from Docker Hub (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`). The pnpm store was warm, so a cold machine also downloads packages.

**Not yet verified:** the same workflow on GitHub-hosted runners (default ECR image registry, Node 24). Open a PR to trigger it.

### Product pass: Pyx (5 November 2026)

- **Renamed to Pyx** ([D8](docs/DECISIONS.md)); licensed FSL-1.1-ALv2 ([D9](docs/DECISIONS.md)).
- **Audit fixes:**
  - a lost exit-1 when the output file existed;
  - fixture setup that could delete a real user or row, now refused;
  - non-cascading foreign keys broke re-provisioning;
  - Node intercepting `--env-file` (now `--credentials`, [D10](docs/DECISIONS.md));
  - dirty-tree commits now recorded;
  - proposal-id collisions;
  - Windows paths in the harness;
  - a bundling auto-run bug.
- **Onboarding:** `init` for any user-owned table, `fixture provision --fixture-defaults`, and `doctor` with fixes.
- **Outputs:** HTML evidence report (white-label, print-ready), JUnit, Markdown step summary, `report` across runs, and a plain-language meaning and next step for every diagnostic.
- **Distribution:** single-file npm package `pyx-cli` (`pnpm package` smoke-tests a clean install; the installed tarball was also run end to end against a real stack), and a customer CI template at `examples/ci/pyx.yml`.
- **Website:** `apps/web`, a static site with a liquid-glass dark design shared with the reports, services pricing, CTAs configured in `config.js`, and strict security headers.
- **Verified:** `pnpm verify` (147 + 11 + 63 tests), `pnpm integration` 27/27, `pnpm package`.

### Audit response and release review (5 November 2026)

Driven by the external design audit (`RowProof_audit_and_premium_strategy.md`). Positioning: *review who gained or lost access before each Supabase release.*

- **Trustworthy runner (audit rank 1):**
  - a forbidden response carrying the record's id, even without the marker, now **fails**;
  - the marker leaking through an error body fails, and an error that only echoes the requested id does not;
  - the fixtures are re-checked after the reads, so a record deleted or re-owned mid-run blocks every pass (`fixtures-stable`);
  - the anonymous context is validated against Auth (`identity:<anon>`);
  - promotions and the active pointer carry an `approvalDigest`, so editing the approver after promotion is rejected;
  - lab mutations are bound to a nonce inside the lab database;
  - [D6, D14, D16](docs/DECISIONS.md).
- **Paired request paths (rank 2):** rules may list an RPC function and loopback app routes. The same matrix runs on each path, with per-path owner controls, and Supabase keys never reach the app origin ([D13](docs/DECISIONS.md)). Supporting pieces: `get_invoice` RPC migration, `examples/demo-app` (healthy / `service-key-bug`), `examples/invoice-three-paths.rule.json`.
- **Release review (rank 4):**
  - `pyx compare` and `pyx run --compare-to` report gained access, lost access, still exposed, fixed and unverified, cell by cell;
  - `pyx repro` writes a README and a curl script without credentials;
  - the HTML report opens with the access review;
  - the CI template runs the base branch first and then the PR with `--compare-to` ([D15](docs/DECISIONS.md)).
- **Public benchmark:** [docs/BENCHMARK.md](docs/BENCHMARK.md), generated from real runs. 8/8 access bugs detected, 7/7 broken setups blocked, and 1 published gap (an RPC the rule does not list). It also appears on the website.
- **Publishability:** terms page, footer links, a mobile overflow fix, and the package smoke now runs `compare` from the installed tarball.
- **Verified:**
  - `pnpm verify`: 154 + 11 + 93 tests;
  - `pnpm integration`: 33/33;
  - `pnpm package`.
- **Next (audit rank 3):** membership-removal and session tests, so a user removed from a team loses access on every path.
- **Later (rank 5):** agency release history and client sign-off.

### Website v3 and trust features (5 November 2026)

- **Research-driven redesign ([D17](docs/DECISIONS.md)).** The site was rebuilt around published critiques of generated-looking sites and Apple's Liquid Glass guidance:
  - neutral near-black canvas, with glass only on the nav and the hero lens;
  - an editorial grid, and tables instead of card rows;
  - real CLI output next to the claims.

  The hero is a ledger of 18 requests that all say "200 OK". A liquid-glass lens reveals the two leaks.
- **Trust features:**
  - `pyx run --requests` request ledger, also shown in the HTML report ([D18](docs/DECISIONS.md));
  - `apps/web/verify.html`, a result verifier that recounts a result, flags a tampered verdict and compares two releases in the browser with the CLI's own code;
  - `apps/web/trust.html`, which shows a real ledger from an integration run;
  - `/.well-known/security.txt`;
  - `.github/workflows/release.yml`, which publishes to npm with provenance on `v*` tags. It needs a trusted publisher or an `NPM_TOKEN`.
- **No invented social proof.** There is a founding-customer offer instead. The strongest missing trust signal is a real founder section with a name and face, which only the owner can add.

### Maintainer actions this work cannot do

0. Publish: `npm publish` from `packages/cli` (needs your npm account and 2FA), deploy `apps/web`, buy a domain, and set `contactEmail` / checkout links in `apps/web/config.js`. Replace the licensor name in `LICENSE.md`. Run a trademark clearance search on "Pyx". Astral (the makers of `uv`) launched a Python package registry named **pyx** in 2025, so expect search competition and possible objections in the developer-tools class ([D8](docs/DECISIONS.md)).

1. Replace the placeholder approval in `baseline/` with the designated owner's own approval ([baseline/README.md](baseline/README.md)).
2. Protect `main`: a ruleset or branch protection requiring the owner's review for `baseline/` (for example CODEOWNERS plus required code-owner review). Until then, CI results are development tests, not independent assessments.
3. Decide whether to adopt a trusted assessment path (a pinned released runner in a workflow the PR cannot modify).

## GitHub work tracker

| Order | Work item |
| --- | --- |
| 1 | [Rule/result contracts and approval semantics](https://github.com/Shreyastacky/ship-safe/issues/1) |
| 2 | [Disposable Supabase invoice demo](https://github.com/Shreyastacky/ship-safe/issues/2) |
| 3 | [Local read-only runner](https://github.com/Shreyastacky/ship-safe/issues/3) |
| 4 | [Known-bad policy and failure-path validation](https://github.com/Shreyastacky/ship-safe/issues/4) |
| 5 | [Reproducible customer-run CI](https://github.com/Shreyastacky/ship-safe/issues/5) |
| 6 | [Rule approval history and intent diffs](https://github.com/Shreyastacky/ship-safe/issues/6) |
| 7 | [Minimal hosted control plane](https://github.com/Shreyastacky/ship-safe/issues/7) |
| 8 | [Observed drift and evidence freshness](https://github.com/Shreyastacky/ship-safe/issues/8) |
| Alongside prototype work | [Design partner validation](https://github.com/Shreyastacky/ship-safe/issues/9) |

## 0. Repository foundation — complete

- [x] Define the first supported permission boundary.
- [x] Document trust limits and result states.
- [x] Add an ordered backlog and acceptance scenarios.
- [x] Keep internal research, generated reports, and credentials out of tracked content.

## 1. Freeze the first rule contract — complete (5 November 2026)

**Verified:** `pnpm verify` includes the contract suite (147 tests) and `pnpm check:generated` pass. Schema bundle: `packages/contracts/schemas/pyx.v1.schema.json`. Canonical rule: `examples/invoice-owner-read.rule.json`. Corpus: 27 valid, invalid and unsupported cases in `examples/contracts/cases.json`. Decisions: [docs/DECISIONS.md](docs/DECISIONS.md) D1–D4.

- [x] Schemas for RuleContent, RuleProposal, Approval, ApprovedRevision, Promotion, ActiveBaseline and RunResult; types generated from the same file with a drift check.
- [x] RFC 8785 canonicalization and SHA-256 content hash; RFC sample vector and golden hash pinned; strict parser rejects duplicate keys.
- [x] Proposal and approval are separate records; approval requires the exact acknowledged hash; revisions and promotions are immutable.
- [x] Read-only `ApprovedBaselineReader` re-verifies hashes, the active pointer and promotions, rejects symlinks and oversized files, and supports revision/hash pins.
- [x] Gate: changing any leaf of approved content fails verification (every leaf is perturbed in `approval.test.ts`); re-hashing without re-approval fails.
- [x] Result schema has no field for a security verdict, score, raw row, body or header, and rejects them (`outcome.test.ts`).
- [x] Hosted-facing identifiers (`organizationId` nullable, `projectId`, `environmentId`) are explicit; local use needs no account.
- Limitation: the local store is self-attested; a filesystem owner can forge it. This is recorded as provenance, not hidden.

**Original deliverable:** versioned JSON Schemas for rule proposals, approvals, and run results, with valid and invalid examples.

- Define project/environment identity, allowlisted origin, resource/table, SELECT operation, ownership model, synthetic identities, fixtures, and explicit expected outcomes.
- Require a synthetic fixture marker plus ID; never infer a pass from HTTP status alone.
- Separate a proposed rule from an approved immutable revision. Record approver, time, revision, and content hash.
- Define assertion statuses separately from evidence freshness. Preserve unknown dependency state.
- Specify bounded redacted result fields: rule hash/revision, runner version, source commit, environment, observed policy/config fingerprints, timestamp, assertion outcome, and safe diagnostic code.
- Reject credential values, raw rows, unsupported operations, and malformed or oversized payloads.

**Done when:** examples validate; changed permission intent cannot reuse an old approval; result schemas cannot encode a blanket security verdict. All three conditions are met; see [the canonical rule](examples/invoice-owner-read.rule.json) and [the case manifest](examples/contracts/cases.json). The earlier illustrative `invoice-rule.proposed.json` was replaced by these validated files.

## 2. Build a disposable Supabase demo — complete (5 November 2026)

**Implemented:** `supabase/config.toml` (CLI 2.122.1 template trimmed to Postgres, Auth, PostgREST and the gateway; signups off), migration `supabase/migrations/20261105000000_invoices_owner_read.sql` (explicit grants plus an owner-only SELECT policy), `packages/local-fixture` (admin-API provisioning, sign-in, independent verification, credentials in a 0600 env file), and `scripts/stack.mjs` (up/reset/down/status; refuses linked directories and keeps CLI key output out of logs). Manually verified on a real local stack: provisioning, re-provisioning, `fixture:verify`, public signup refused (422), and a real healthy run of all six assertions.


**Deliverable:** local schema/migrations, synthetic seed script, fixture checks, and reset instructions.

- Add one `invoices` table with `id`, `owner_id`, and synthetic fixture marker.
- Create two ordinary users A/B, each owning a known invoice.
- Enable RLS and the required grants, with an owner-only SELECT policy.
- Keep setup/admin credentials separate from ordinary read clients.
- Make setup repeatable without real data or committed credentials.

**Done when:** a fresh local instance reproduces both owner reads and all four denied reads; fixtures and identity ownership can be verified independently.

## 3. Implement the local read-only runner — complete (5 November 2026)

**Implemented:** `packages/runner`: propose/diff/approve/promote/history (local writer) and `run` (read-only baseline), the bounded fetch transport, identity verification via the target's Auth service, six assertions with dependency rules, a schema-validated and leak-checked JSON result, a terminal summary, and exit codes 0/1/2. 53 unit tests with a mocked transport cover transport failures, response shapes, limits, cancellation and output safety. Decisions D5 and D6 in [docs/DECISIONS.md](docs/DECISIONS.md).


**Deliverable:** a CLI that consumes an approved rule revision and writes a local redacted JSON result.

- Proposed implementation: TypeScript on a supported Node LTS release; choose and pin the actual version during setup.
- Validate authorization/scope declaration, non-production target identity, origin allowlist, distinct verified users, token validity, and fixtures before assessing isolation.
- Reject redirects to another origin and administrative/bypass credentials for ordinary-user assertions. Keep target verification independent of user-supplied labels.
- Perform exact owner reads first, then cross-user and anonymous reads using isolated clients.
- Define supported response semantics explicitly; filtered empty results may be expected denial only after controls succeed. Generic 404s/errors are not proof of enforcement.
- Bound requests, concurrency, response bytes, retries, and total runtime. Handle interruption safely.
- Emit safe error codes, local reproduction instructions, and documented CI exit codes for failures, blocked runs, and incomplete coverage.
- Keep tokens, passwords, and full response bodies out of stdout, logs, and result files. No hosted upload by default.

**Done when:** every applicable runner scenario in [ACCEPTANCE.md](docs/ACCEPTANCE.md) passes, including setup failures and credential separation.

## 4. Prove sensitivity to the intended regression — complete (5 November 2026)

**Verified by actually running** `pnpm integration` (tests/integration/harness.mjs) in this environment, including from a fresh clone: 24/24 scenarios behaved as expected against real local Supabase (CLI 2.122.1, Postgres 17, GoTrue 2.197.0, PostgREST 16.5) over real HTTP, in about 2.5 minutes. Teardown left 0 containers and 0 volumes.

- [x] Healthy policy passes all six (exit 0); the runner's identity result agrees with supabase-js `getUser(jwt)`.
- [x] Separate throwaway lab instance (unique project id, copied config) with the deliberately permissive policy: `a-reads-b` and `b-reads-a` fail with `fixture_disclosed` (exit 1); the lab is then destroyed and its volumes deleted.
- [x] Lab variants: anonymous-open policy (anonymous disclosures fail), owner policy dropped (owner reads fail, denials blocked), SELECT grant revoked (403 is never a denial pass), missing / wrong-owner / wrong-marker fixtures (blocked, never pass or false disclosure).
- [x] Same-user sessions, forged-signature (wrong-project) token, expired token rejected by the real Auth service, token about to expire, elevated keys in user and app-key contexts, legacy anon key (declared vs undeclared), wrong target origins, missing setup channel, baseline pin mismatch, tampered store, request budget, connection refused.
- [x] Weakening the proposed rule alongside the broken policy is refused at approval, and the run still reports the disclosure against the approved hash.
- [x] A PR branch that changes the app and forges a hash-consistent weakened approval in its own `baseline/` cannot change the assessment: the baseline from `main` still reports the disclosure, and the forged store is not assessable (never a pass).
- [x] Leak scan: no loaded credential (keys, tokens, minted tokens, JWT secret) or credential-shaped text appears in any captured CLI output or result file.
- [x] Transport failures (redirects, timeouts, 429, 5xx, generic 404, oversized/malformed/invalid-UTF-8 bodies, network errors, cancellation, request budget) are covered with a mocked transport in `packages/runner/test`, as the spec directs. Authorization behaviour is covered only by the real-HTTP harness.


**Deliverable:** an integration harness running against disposable local Supabase instances.

- Confirm the correct policy passes.
- In a throwaway local clone only, introduce a permissive SELECT policy and prove a cross-user fixture disclosure fails.
- Confirm missing fixtures, same-user sessions, failed auth, network failure, unexpected responses, and target mismatch cannot pass isolation.
- Destroy the throwaway instance after the run. No mutation command may target remote staging or production.
- Add regression coverage for redaction and unknown/unsupported states.

**Done when:** clean and deliberately broken configurations produce their expected different outcomes reproducibly from a fresh checkout.

## 5. Make customer-run CI reproducible — implemented; locally reproduced; GitHub-hosted run pending

**Implemented:** [.github/workflows/pyx.yml](.github/workflows/pyx.yml) with jobs `verify`, `integration` (the harness, with redacted artifacts uploaded) and `assess-with-base-branch-baseline` (baseline materialized from the base branch by `scripts/fetch-trusted-baseline.mjs`; edits to `baseline/` in a PR are flagged and ignored). Actions pinned to full SHAs (checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.0, upload-artifact v7.0.2), `contents: read`, no persisted credentials, no secrets, no `pull_request_target`, teardown always runs. Instructions: [docs/INTEGRATION.md](docs/INTEGRATION.md).

- [x] Healthy demo green, broken-policy demo red, setup failures blocked (harness, fresh clone).
- [x] Approved baseline is an explicit input from a separate ref, not the PR tree (harness boundary scenario plus the CI job).
- [x] Results carry rule hash, revision, source commit, runner version, target and provenance; freshness is `unknown` (no observer).
- [ ] Workflow observed green on GitHub-hosted runners.
- [ ] Base-branch protection for `baseline/` (maintainer action; not configured).
- [ ] Trusted assessment with a pinned released runner outside the PR's control (not configured; CI jobs are development tests).


**Deliverable:** a pinned example GitHub Actions workflow plus fixture setup/run/teardown instructions.

- Run the synthetic demo in CI with minimal permissions and pinned dependencies/actions.
- Treat the approved rule revision as an explicit input; do not silently accept changes from the implementation branch.
- Keep any credentials in the customer's environment and upload only bounded redacted artifacts.
- Attach rule hash, source commit, runner version, target identity, and observed fingerprints to results.
- Document that workflow provenance does not prove honest fixtures or a secure application.

**Done when:** the healthy demo is green, the broken-policy demo is red, and setup failures are visibly blocked rather than passed.

## 6. Preserve rule approvals and compare intent — next

**Already in place locally (self-attested):** immutable revisions and promotions, `history`, a matrix-style intent diff, stale-proposal and no-change refusal, and runs bound to one approved hash. **Remaining:** separately authorized promotion, audited reviewer identity, replay/concurrency handling beyond exclusive file creation, and clear local-vs-authenticated provenance end to end.


**Deliverable:** revision history and a readable approval diff; start locally if that avoids premature hosting.

- Show changes to identity, resource, operation, fixtures, and allowed/denied expectations.
- Require the designated owner's explicit approval before a new rule version becomes the baseline.
- Preserve the previous revision and associate every run with exactly one approved hash.
- Distinguish an implementation change from a change to intended permissions.

**Done when:** editing both app code and proposed expectations cannot silently replace the approved baseline.

## 7. Add the smallest hosted control plane

**Deliverable:** authenticated organizations/projects, rule review, and redacted run history.

- Proposed stack: Next.js/TypeScript with Postgres/Supabase; confirm after the local path works. No hosting provider is selected yet.
- Enforce organization boundaries on every server operation and storage read/write; derive org membership from authentication.
- Add scoped/revocable upload authorization, schema validation, payload limits, replay handling, idempotency, and rate limits.
- Reject credentials and raw source/records at ingestion; sanitize data before storage and rendering.
- Default evidence to private; implement deletion, retention, and access revocation before sensitive pilot data.
- Build one rule per row, one concrete failure, setup diagnostics, and a next action. No overall security score.

**Done when:** cross-organization access tests fail closed, revoked credentials stop working, duplicate submissions are handled, and sensitive fields are rejected.

## 8. Model observed drift and evidence freshness

**Deliverable:** release comparisons with honest current/stale/unknown states.

- Compare approved rule revision, target, source commit, and observed policy/config/helper dependencies.
- Mark evidence stale after an observed relevant change without a matching valid rerun.
- Treat incomplete fingerprints or unknown dependencies as review needed; migration hashes alone do not establish live policy state.
- Show last-observed time, missing observers, route coverage, and staging/production gaps.

**Done when:** an out-of-band change without an observer is never presented as detected, and a staging pass is never presented as a production pass.

## 9. Validate the workflow with design partners

**Deliverable:** measured setup/maintenance effort and evidence of paid repeat use.

- Begin written discovery alongside the local prototype: ask qualified Supabase agencies for redacted permission matrices and existing tests.
- Proposed experiment: ten qualified discussions, five recent workflow artifacts, three paid pilots, then at least two paying repeat uses on the next eligible release over roughly sixty days.
- Measure baseline docs-plus-agent effort, setup time, founder intervention, maintenance time, and reproducibility.
- Under-twenty-minute supported setup is a target to measure, not a published benefit.
- Obtain experienced security review of the runner before relying on it commercially. Review concrete terms/data handling before accepting sensitive paid-pilot information.
- Use written briefs and email by default; calls only where needed.

**Done when:** repeat use demonstrates customer value beyond founder-delivered consulting. These thresholds are proposed decision rules, not market benchmarks.

## Defer

Writes/deletes, shared/delegated access, storage, edge functions, arbitrary app APIs, autonomous fixes, production probing, generalized scanning, compliance badges, billing automation, and a broad client portal.

## Immediate work sequence

1. ~~Finalize the rule/result schemas and approval semantics.~~ Done.
2. ~~Build the two-user local Supabase fixture.~~ Done.
3. ~~Implement the read runner with positive controls and blocked states.~~ Done.
4. ~~Prove it detects the deliberately permissive local policy.~~ Done (real local Supabase).
5. Put that exact demonstration in CI. Workflow written and reproduced locally; **confirm on GitHub Actions**.
6. Maintainer: replace the placeholder approval and protect `baseline/` on `main`.
7. Phase 6: authenticated, audited approval and promotion.

The first prototype is complete only when steps 1–5 work from a fresh checkout. That holds locally; GitHub-hosted confirmation is pending. A dashboard alone does not complete that milestone.
