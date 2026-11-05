# Running the checks

Everything here uses synthetic data in a disposable local Supabase stack. No hosted project, paid service or real credential is involved.

## Requirements

- Node.js 22.12+ (CI uses 24; see `.node-version`)
- pnpm 10.28.0 (`corepack enable` picks it up from `packageManager`)
- A Docker-compatible runtime with a running daemon (Docker Desktop, Docker Engine, OrbStack, Colima, Podman with Docker API)
- About 2 GB of free disk for images on first run

## Fast checks (no Docker)

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm verify
```

```bash
pnpm package
```

`package` builds the `pyx` npm tarball and runs it from a clean install. `verify` checks that generated types match the schema, builds, runs the contract and runner unit tests, and typechecks.

## Full real-HTTP integration gate

```bash
pnpm integration
```

The harness (`tests/integration/harness.mjs`):

1. **Stage A:** stops any `pyx-demo` stack, starts a fresh one from `supabase/`, provisions synthetic users and invoices, approves the example rule into a temporary store through the CLI, then runs identity, credential, target, baseline and limit scenarios. It also starts the demo app (`examples/demo-app/server.mjs`) on 127.0.0.1:8787 and checks the three-path rule: all 18 assertions pass with the healthy app, and the app route fails (while the table and RPC pass) in `service-key-bug` mode.
2. **Stage B:** stops it, copies the config into a temporary directory with a unique `pyx-lab-*` project id, and starts that **separate throwaway instance**. It writes a random nonce into the lab database, and every mutation first proves inside the same psql session that it reached that database. It then applies the deliberately permissive policy (`supabase/lab/permissive-select.sql`), a SECURITY DEFINER RPC without an owner check (`supabase/lab/leaky-rpc.sql`), an `owner_id = owner_id` typo, disabled RLS and other broken variants (each followed by `db reset`, re-binding and re-provisioning), checks that the approved baseline is read from a protected git ref rather than a PR tree, then destroys the instance and checks that no containers or volumes remain.
3. **Stage C:** with no stack running, checks that a connection failure is blocked.
4. Scans every captured output and result file for credential values and credential-shaped text.

It prints one line per scenario, exits 0 only if every scenario behaves as expected, and writes redacted artifacts to `artifacts/integration/<timestamp>/` (`summary.json` with a `benchmark` section, and per-run result files). `node scripts/build-benchmark.mjs` turns the latest summary into [BENCHMARK.md](BENCHMARK.md) and the website's benchmark section. It always tears down, including on Ctrl-C.

**Warning:** the harness stops the local `pyx-demo` stack and deletes its local data.

Typical duration after images are cached: about 4 minutes. 33 scenarios, including onboarding a customer-shaped table with `init`, `doctor`, all output formats, and refusal to touch non-synthetic users or rows.

### If Docker image pulls are blocked

The Supabase CLI pulls from `public.ecr.aws` by default. In networks that block it but allow Docker Hub:

```bash
export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io
```

### If ports are busy

The stack uses ports 54321 (API) and 54322 (database). Stop whatever holds them, or stop other local Supabase projects with `supabase stop` in their directories.

## Manual walkthrough

```bash
pnpm install --frozen-lockfile && pnpm build
```

```bash
pnpm stack:up
```

```bash
pnpm fixture:provision
```

```bash
pnpm pyx run --store baseline --rule invoice-owner-read --credentials .pyx/local.env
```

Expected: six PASS lines and exit 0. `fixture:provision` writes credentials only to `.pyx/local.env` (mode 0600, git-ignored). Note that `baseline/` currently holds a placeholder approval; see [baseline/README.md](../baseline/README.md).

To see a regression, use the harness. Do **not** apply `supabase/lab/permissive-select.sql` to a stack you keep.

```bash
pnpm stack:down
```

## CI

`.github/workflows/pyx.yml` runs three jobs on `pull_request` and on pushes to `main`:

| Job | What it proves | What it does not prove |
| --- | --- | --- |
| `verify` | Contracts, generated types, unit tests, typecheck | Anything about a real database |
| `integration` | The full harness above on a GitHub-hosted runner, with redacted artifacts uploaded | That the runner in a PR is trustworthy (the PR supplies it) |
| `assess-with-base-branch-baseline` | The approved baseline comes from the **base branch** via `scripts/fetch-trusted-baseline.mjs`; edits to `baseline/` in the PR are flagged and ignored | That the base branch is protected; that the runner is the released one |

Actions are pinned to full commit SHAs, permissions are `contents: read`, checkout does not persist credentials, no secrets are used, and `pull_request_target` is not used.

### Not configured (needs a maintainer decision)

- **Branch protection or rulesets** on `main` that require the designated owner's review for `baseline/`. Without this, anyone with push access can rewrite approvals.
- **A trusted assessment path:** a pinned, released runner executed by a workflow the candidate PR cannot change (for example a required workflow from a separate repository). The current jobs are development tests of the candidate runner.
- **Artifact attestations.** If added, they identify which workflow produced an artifact. They do not prove honest execution or application security.
