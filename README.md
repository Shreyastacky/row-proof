# Pyx

**Review who gained or lost access before each Supabase release.**

Pyx turns *"Alice reads Alice's invoices, Bob never sees them"* into a versioned rule that the person responsible for the data approves. It then signs in as real test users on a disposable local stack built from your migrations and asks for records they must not see, through every door your app has: the Data API, your RPC functions and your own API routes. Each pull request gets an access review against the base branch:

```text
$ pyx compare examples/results/release-41-pass.json examples/results/release-42-fail.json --before-label release-41 --after-label release-42
Pyx access review: invoice-three-paths
  before  release-41 6704db4781 · r1 · 2026-11-05 06:38 UTC · pass
  after   release-42 6704db4781 · r1 · 2026-11-05 06:38 UTC · fail

  GAINED ACCESS  user-a can now read invoice-b  [app-invoice-route]
  GAINED ACCESS  user-b can now read invoice-a  [app-invoice-route]

  2 regressions, 0 still exposed, 0 fixed, 0 unverified, 16 unchanged; exit 1
```

Those two results are real runs against the demo stack: release 42 is the demo app in `service-key-bug` mode. The table policy and the RPC still hold; only the API route leaks.

If anyone can read what they must not, the run exits **1**, names the record, the user, the request path, the rule revision and the commit, and `pyx repro` writes a curl script that shows it happening.

- **Every door, not just the table.** Security-definer RPC functions and server routes that use the secret key skip row-level security. Pyx checks them with the same users and records.
- **Approved intent, separate from code.** The owner approves an exact content hash. A pull request can't quietly redefine "correct": CI reads the baseline from your protected branch.
- **Fails closed.** Owner reads are positive controls. Timeouts, 401/403/404/429, redirects and malformed responses are *blocked*, never a pass.
- **No production access, no customer data.** Synthetic users and records only. Credentials never appear in any output.
- **Nothing hidden.** `--requests` writes a ledger of every request sent (purpose, identity by name, URL, status). Any result file can be recounted and compared in the browser with the [result verifier](apps/web/verify.html), which uses the CLI's own code. See the [trust page](apps/web/trust.html).
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

Then, on the next release:

```bash
pyx run --store .pyx/approvals --rule invoices-owner-read --credentials .pyx/local.env --out after.json --compare-to before.json
```

To check RPC functions and API routes too, add `paths` to the rule. See [`examples/invoice-three-paths.rule.json`](examples/invoice-three-paths.rule.json) and the demo app in [`examples/demo-app`](examples/demo-app/server.mjs), which has a healthy mode and a `service-key-bug` mode.

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
| `run` | Execute the approved matrix (reads the approval store only); `--html`, `--junit`, `--summary-md`, `--compare-to`, `--requests` (request ledger) |
| `report` | Build an HTML evidence report from one or more result files (`--client`, `--prepared-by`) |
| `compare` | Who gained or lost access between two results, cell by cell; exit 1 on a regression (also in the browser: `apps/web/verify.html`) |
| `repro` | A reproduction pack (README + curl script, no credentials) for every failing check |

## Scope, stated plainly

Supported today: reads by id on single-owner tables through the Supabase Data API, RPC functions (GET) and loopback application routes, against local disposable stacks. Not supported yet: writes, list queries, tenant membership, shared or delegated records, storage, edge functions, remote environments. What Pyx catches and misses is measured in [docs/BENCHMARK.md](docs/BENCHMARK.md). A pass covers the listed assertions on that target at that time. It is not a penetration test, a certification, or evidence about production. Local approvals are self-attested: anyone who can write the approval store can change them. Protect the store in your repository.

## This repository

```text
packages/contracts/     JSON Schema bundle (authoritative), RFC 8785 hashing, approval semantics, read-only baseline
packages/runner/        pyx CLI source: engine, bounded transport, approvals, reports, design system
packages/local-fixture/ privileged local-only fixture setup and verification
packages/cli/           the published `pyx` npm package (single-file bundle)
supabase/               disposable demo stack: migrations (table, RPC), lab-only broken policy and RPC
tests/integration/      real-HTTP harness: healthy and throwaway broken instances (33 scenarios) + benchmark
apps/web/               the website
baseline/               demo approval store read by CI from the base branch (placeholder approval)
examples/               rules (Data API; three paths), demo app, contract corpus, sample results, CI template
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

[FSL-1.1-ALv2](LICENSE.md). You may use, modify and run Pyx for free for any purpose except offering a competing commercial product or service. Using it in professional services you provide to your own clients is explicitly permitted. Each release becomes Apache-2.0 two years after it is published.

Security reports: see [SECURITY.md](SECURITY.md). Earlier, unrelated products by the same author (the Ship Safe checklist/kit and `ship-safe-check`) are not part of Pyx.
