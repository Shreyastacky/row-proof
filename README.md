# RowProof

**Keep agreed access rules intact as your app changes.**

RowProof is an early-stage tool for recording who should be able to read which records, keeping the owner's approved expectations separate from routine code edits, and rerunning checks after changes to report exactly what passed, failed, or could not be assessed.

The first supported integration is Supabase: two synthetic users should each read their own invoice and never receive the other's through the direct Data API; an anonymous client should receive neither.

## Current status

**A working local prototype of one access boundary.** Phases 1–5 of the [roadmap](ROADMAP.md) are implemented. The contract tests, runner tests and a real-HTTP integration harness pass from a fresh checkout. The harness runs against disposable local Supabase stacks, including a separate throwaway instance with a deliberately broken policy. The CI workflow is written and its steps were reproduced locally, but it has **not yet run on GitHub Actions**.

What this is not: a hosted service, a security certification, a scanner, or evidence about production. There is no approval authority beyond what you configure. The local approval store is self-attested, and base-branch protection for `baseline/` is not configured. See [what remains](ROADMAP.md#maintainer-actions-this-work-cannot-do).

The existing RowProof checklist/kit and the separate `ship-safe-check` secrets scanner are earlier products, not this implementation.

## The supported boundary

| Assertion | Required observation |
| --- | --- |
| User A reads invoice A | Exact synthetic fixture returned (id, owner, marker) |
| User B reads invoice B | Exact synthetic fixture returned |
| User A reads invoice B | Invoice B not disclosed |
| User B reads invoice A | Invoice A not disclosed |
| Anonymous reads invoice A | Not disclosed |
| Anonymous reads invoice B | Not disclosed |

A denial passes only as a well-formed empty result, and only after the target, keys, fixtures (checked through a separate setup channel), verified identities, and that fixture's owner read have all succeeded. A failed login, missing fixture, timeout, 403/404/429 or redirect never becomes a pass.

## Quick start

Requires Node 22.12+, pnpm 10 (`corepack enable`), and Docker. Full details: [docs/INTEGRATION.md](docs/INTEGRATION.md).

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm verify
```

```bash
pnpm integration
```

`pnpm integration` starts and destroys local Supabase stacks (about 2.5 minutes once images are cached) and stops any running `rowproof-demo` stack.

### The workflow, by hand

```bash
pnpm build && pnpm stack:up && pnpm fixture:provision
```

```bash
pnpm rowproof propose --rule examples/invoice-owner-read.rule.json --store .rowproof/approvals --proposed-by you --out .rowproof/proposal.json
```

```bash
pnpm rowproof diff --proposal .rowproof/proposal.json --store .rowproof/approvals
```

```bash
pnpm rowproof approve --proposal .rowproof/proposal.json --store .rowproof/approvals --approver owner --acknowledge <hash printed by diff> --promote
```

```bash
pnpm rowproof run --store .rowproof/approvals --rule invoice-owner-read --credentials .rowproof/local.env
```

Exit codes: **0** every required assertion passed with valid controls; **1** at least one demonstrated violation (even if other checks are blocked); **2** blocked or incomplete without a demonstrated violation.

## Layout

```text
packages/contracts/    JSON Schema bundle (authoritative), canonical hashing, approval semantics,
                       read-only approved-baseline reader, outcome rules
packages/runner/       rowproof CLI: propose/diff/approve/promote/history and run
packages/local-fixture/ privileged local-only setup: synthetic users and fixtures
supabase/              disposable stack config, migration (owner-only RLS), lab-only broken policy
tests/integration/     real-HTTP harness: healthy and throwaway broken-policy instances
baseline/              approval store that CI reads from the base branch (placeholder approval)
examples/              canonical rule and a valid/invalid/unsupported contract corpus
scripts/               stack lifecycle and trusted-baseline retrieval
apps/web/              hosted control plane (not implemented; Phase 7)
docs/                  scope, architecture, acceptance, decisions, integration instructions
```

## Result language

- **passed / failed**: a supported assertion completed against the named fixtures and environment.
- **blocked**: execution or setup did not produce a trustworthy assessment.
- **not assessed**: the requested behaviour is outside supported coverage.
- **current / stale / unknown**: freshness, kept separate and based only on available observations. v1 has no dependency observer, so every result says `unknown`.

A passing run describes those six checks, on that target, at that time. It does not certify an application, cover other access paths, or establish production parity. A customer-controlled runner can forge results; provenance identifies a producer, not honest execution.

## Further reading

[Product scope](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Acceptance scenarios](docs/ACCEPTANCE.md) · [Decisions and pinned versions](docs/DECISIONS.md) · [Running the checks](docs/INTEGRATION.md) · [Roadmap](ROADMAP.md)

## Repository visibility and rights

This repository is public for development visibility. No open-source license has been selected; public visibility alone does not grant a license to reuse the project. See [contribution guidance](CONTRIBUTING.md) and [security reporting](SECURITY.md).
