# Proposed architecture

Status: the **execution plane is implemented** for the v1 Supabase SELECT adapter (local disposable targets only). The **control plane is not implemented**. Decisions and pinned versions: [DECISIONS.md](DECISIONS.md).

## Implemented modules

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `packages/contracts` | Schema bundle, generated types, strict JSON, RFC 8785 hashing, semantic rules, proposal/approval/revision builders and verifiers, outcome rules, read-only `ApprovedBaselineReader` | Ajv only; no Supabase, no Next.js, no hosted account model |
| `packages/runner` | CLI; local approval writer (propose/approve/promote); `run`: engine, bounded transport, credential classification, safe report | contracts |
| `packages/local-fixture` | Privileged local setup and verification (supabase-js admin API) | contracts, supabase-js |
| `tests/integration` | Real-HTTP harness against disposable stacks | everything above, Docker, Supabase CLI |

Provider-specific behaviour is confined to the engine's Supabase adapter (request templates, identity endpoint, response semantics). Hosted-facing identifiers (`organizationId`, `projectId`, `environmentId`) are explicit in rules and results, and `organizationId` may be null for local use.

## Execution plane

A customer-run CLI reads a versioned, explicitly approved rule and local credentials. It validates target/identity/fixture controls, runs bounded SELECT assertions, and writes a redacted result. Initially all output stays local.

Setup/admin access provisions and independently verifies synthetic fixtures. Ordinary-user clients perform assessed reads. They must not share sessions or inherit an administrative bypass.

The CLI must bind authorization to a verified non-production environment and allowlisted origin. Requests may not follow cross-origin redirects or silently change projects. The harness that deliberately weakens a policy is a separate local-only component with an explicit disposable-instance boundary.

## Control plane — later (not implemented)

A small authenticated web application stores organizations, projects, immutable rule revisions, approvals, and bounded run results. It accepts no database passwords, session tokens, private source, or raw invoice responses.

Logical entities:

- Organization and membership: tenant boundary and reviewer authority.
- Project and environment: expected origin, non-production scope, authorization record.
- Rule revision: immutable permission expectations, version, content hash, proposal state.
- Approval: actor, time, approved hash; changes require a new approval.
- Run: rule hash, runner version, source commit, environment and observed fingerprints.
- Assertion outcome: status, safe diagnostic code, bounded synthetic fixture reference.

All writes and reads must enforce membership server-side. Ingestion validates size/schema, authorization scope, replay/idempotency, and redaction before storing data. Rule approvals and result history should be auditable and exportable.

## Change and freshness

Source commit, approved expectation, actual policy/config state, and target identity are distinct inputs. Capture relevant helper/config dependencies where possible and mark incomplete coverage as unknown. A migration hash is not a substitute for the observed remote policy state.

Associate every result with its exact inputs and observation time. An observed relevant change can stale previous evidence. Unobserved changes cannot be claimed as detected.

## Proposed tools

- TypeScript + a supported Node LTS version for the CLI and shared contracts.
- Supabase local development for a disposable Postgres/Auth/Data API fixture.
- JSON Schema for portable rule/result contracts.
- A test framework selected during runner implementation for unit and real integration coverage.
- Next.js + Postgres/Supabase for the later control plane if the local prototype supports the hypothesis.
- GitHub Actions for the reproducible synthetic demo.

Pin supported versions when dependencies are introduced. There is no reason to provision paid hosting, build billing, or choose a production deployment before the local demonstration works.
