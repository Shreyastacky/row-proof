# Implementation roadmap

Initial plan: 5 November 2026. Every item below is unfinished unless explicitly marked complete. Stack choices are proposals, not implemented dependencies.

## 0. Repository foundation — complete

- [x] Define the first supported permission boundary.
- [x] Document trust limits and result states.
- [x] Add an ordered backlog and acceptance scenarios.
- [x] Keep internal research, generated reports, and credentials out of tracked content.

## 1. Freeze the first rule contract — next

**Deliverable:** versioned JSON Schemas for rule proposals, approvals, and run results, with valid and invalid examples.

- Define project/environment identity, allowlisted origin, resource/table, SELECT operation, ownership model, synthetic identities, fixtures, and explicit expected outcomes.
- Require a synthetic fixture marker plus ID; never infer a pass from HTTP status alone.
- Separate a proposed rule from an approved immutable revision. Record approver, time, revision, and content hash.
- Define assertion statuses separately from evidence freshness. Preserve unknown dependency state.
- Specify bounded redacted result fields: rule hash/revision, runner version, source commit, environment, observed policy/config fingerprints, timestamp, assertion outcome, and safe diagnostic code.
- Reject credential values, raw rows, unsupported operations, and malformed or oversized payloads.

**Done when:** examples validate; changed permission intent cannot reuse an old approval; result schemas cannot encode a blanket security verdict. See [the proposal example](examples/invoice-rule.proposed.json).

## 2. Build a disposable Supabase demo

**Deliverable:** local schema/migrations, synthetic seed script, fixture checks, and reset instructions.

- Add one `invoices` table with `id`, `owner_id`, and synthetic fixture marker.
- Create two ordinary users A/B, each owning a known invoice.
- Enable RLS and the required grants, with an owner-only SELECT policy.
- Keep setup/admin credentials separate from ordinary read clients.
- Make setup repeatable without real data or committed credentials.

**Done when:** a fresh local instance reproduces both owner reads and all four denied reads; fixtures and identity ownership can be verified independently.

## 3. Implement the local read-only runner

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

## 4. Prove sensitivity to the intended regression

**Deliverable:** an integration harness running against disposable local Supabase instances.

- Confirm the correct policy passes.
- In a throwaway local clone only, introduce a permissive SELECT policy and prove a cross-user fixture disclosure fails.
- Confirm missing fixtures, same-user sessions, failed auth, network failure, unexpected responses, and target mismatch cannot pass isolation.
- Destroy the throwaway instance after the run. No mutation command may target remote staging or production.
- Add regression coverage for redaction and unknown/unsupported states.

**Done when:** clean and deliberately broken configurations produce their expected different outcomes reproducibly from a fresh checkout.

## 5. Make customer-run CI reproducible

**Deliverable:** a pinned example GitHub Actions workflow plus fixture setup/run/teardown instructions.

- Run the synthetic demo in CI with minimal permissions and pinned dependencies/actions.
- Treat the approved rule revision as an explicit input; do not silently accept changes from the implementation branch.
- Keep any credentials in the customer's environment and upload only bounded redacted artifacts.
- Attach rule hash, source commit, runner version, target identity, and observed fingerprints to results.
- Document that workflow provenance does not prove honest fixtures or a secure application.

**Done when:** the healthy demo is green, the broken-policy demo is red, and setup failures are visibly blocked rather than passed.

## 6. Preserve rule approvals and compare intent

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

1. Finalize the rule/result schemas and approval semantics.
2. Build the two-user local Supabase fixture.
3. Implement the read runner with positive controls and blocked states.
4. Prove it detects the deliberately permissive local policy.
5. Put that exact demonstration in CI.

The first prototype is complete only when steps 1–5 work from a fresh checkout. A dashboard alone does not complete that milestone.
