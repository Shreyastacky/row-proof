# Pyx

**Owner-approved access rules for Supabase, checked against real requests on every release.**

Pyx turns *"Alice reads Alice's invoices, Bob never sees them"* into a versioned rule that the person responsible for the data approves. It then proves the rule through the real Supabase Data API, with real Auth tokens, on a disposable local stack built from your migrations. If a policy change, including one an AI coding tool made, exposes one user's rows to another, the run exits **1** and names the exact record, rule revision and commit.

- **Approved intent, separate from code.** The owner approves an exact content hash. A pull request can't quietly redefine "correct": CI reads the baseline from your protected branch.
- **Fails closed.** Owner reads are positive controls. Timeouts, 401/403/404/429, redirects and malformed responses are *blocked*, never a pass.
- **No production access, no customer data.** Synthetic users and records only. Credentials never appear in any output.
- **Evidence people can read.** HTML reports (white-label, print-to-PDF), JUnit for CI, and Markdown summaries for pull requests.

Website: [`apps/web`](apps/web) (static, deploy anywhere). Sample report: [`apps/web/sample-report.html`](apps/web/sample-report.html).

## Quick start

Requires Node 22.12+, Docker and the Supabase CLI, in a Supabase project.

```bash
npm install -g pyx-cli
```

```bash
supabase start
```

```bash
pyx init --table invoices --owner-column owner_id --marker-column title
```

```bash
pyx fixture provision --rule invoices-owner-read.rule.json
```

```bash
pyx doctor --rule invoices-owner-read.rule.json --credentials .pyx/local.env
```

```bash
pyx propose --rule invoices-owner-read.rule.json --store .pyx/approvals --proposed-by you --out proposal.json
```

```bash
pyx diff --proposal proposal.json --store .pyx/approvals
```

```bash
pyx approve --proposal proposal.json --store .pyx/approvals --approver owner --acknowledge <hash printed by diff> --promote
```

```bash
pyx run --store .pyx/approvals --rule invoices-owner-read --credentials .pyx/local.env --html report.html --junit junit.xml
```

`init` works for any table with an owner column (uuid of `auth.users`), an id column and a text column that can hold a synthetic marker. If the table has other required columns, pass `--fixture-defaults defaults.json` to `fixture provision`. Provisioning refuses to touch any existing user or row that is not one of Pyx's synthetic records.

For CI in your own repository, copy [`examples/ci/pyx.yml`](examples/ci/pyx.yml).

**Exit codes:** `0` every approved expectation held with all controls established · `1` at least one demonstrated violation (even if other checks are blocked) · `2` blocked or incomplete, never a pass.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Scaffold a six-assertion rule for a user-owned table, with fresh random synthetic ids |
| `fixture provision \| verify` | Create and independently verify synthetic users and records on a **local** stack |
| `doctor` | Check Node, rule, baseline, keys, tokens, target, Auth and the Data API route, with fixes |
| `validate`, `hash` | Validate a rule or proposal; print its canonical content hash |
| `propose`, `diff`, `approve`, `promote`, `history` | Approval workflow: proposals have no authority; approval binds one acknowledged hash |
| `run` | Execute the approved matrix (reads the approval store only); `--html`, `--junit`, `--summary-md` |
| `report` | Build an HTML evidence report from one or more result files (`--client`, `--prepared-by`) |

## Scope, stated plainly

Supported today: SELECT through the Supabase Data API (PostgREST) on single-owner tables, against local disposable stacks. Not supported yet: writes, tenant membership, shared or delegated records, storage, edge functions, custom APIs, remote environments. A pass covers the listed assertions on that target at that time. It is not a penetration test, a certification, or evidence about production. Local approvals are self-attested: anyone who can write the approval store can change them. Protect the store in your repository.

## This repository

```text
packages/contracts/     JSON Schema bundle (authoritative), RFC 8785 hashing, approval semantics, read-only baseline
packages/runner/        pyx CLI source: engine, bounded transport, approvals, reports, design system
packages/local-fixture/ privileged local-only fixture setup and verification
packages/cli/           the published `pyx` npm package (single-file bundle)
supabase/               disposable demo stack: migrations, lab-only broken policy
tests/integration/      real-HTTP harness: healthy and throwaway broken-policy instances (27 scenarios)
apps/web/               the website
baseline/               demo approval store read by CI from the base branch (placeholder approval)
examples/               canonical rule, contract corpus, sample results, customer CI template
docs/                   decisions, integration, acceptance, architecture, product scope
```

Development:

```bash
pnpm install --frozen-lockfile && pnpm verify
```

```bash
pnpm integration
```

```bash
pnpm package
```

`pnpm integration` runs the real-HTTP harness with Docker. `pnpm package` builds and smoke-tests the npm tarball from a clean install. See [docs/INTEGRATION.md](docs/INTEGRATION.md), [docs/DECISIONS.md](docs/DECISIONS.md) and the [roadmap](ROADMAP.md).

## License

[FSL-1.1-ALv2](LICENSE.md). You may use, modify and run Pyx for free for any purpose except a competing commercial product or service, including professional services you provide to your own clients. Each release becomes Apache-2.0 two years after it is published.

Security reports: see [SECURITY.md](SECURITY.md). Earlier, unrelated products by the same author (the Ship Safe checklist/kit and `ship-safe-check`) are not part of Pyx.
