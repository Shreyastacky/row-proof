# @ship-safe/runner

The `ship-safe` CLI. Customer-run; credentials stay in the customer's environment; output stays local.

## Commands

| Command | Writes | Purpose |
| --- | --- | --- |
| `validate <file>` | nothing | Schema and semantic validation of rule content or a proposal |
| `hash <rule.json>` | nothing | Canonical content hash |
| `propose` | proposal file | Create a proposal (no authority) based on the active revision |
| `diff` | nothing | Intent changes versus the active approved revision, as matrix cells |
| `approve` | approval store | Approve exactly one acknowledged hash; `--promote` makes it active |
| `promote` | approval store | Make an approved revision active (explicit rollback/forward) |
| `history` | nothing | Revisions, approvers, provenance, active marker |
| `run` | result JSON | Execute the approved matrix; **reads the store only** |

`run --help` lists limits and pins. Defaults: 32 requests, 5 s per request, 60 s per run, 64 KiB per response, concurrency 1, no retries.

## Trust boundaries in code

- `src/commands/run.ts` never imports `src/approval/writer.ts` (a test walks the import graph).
- `src/transport.ts` is the only network path: one exact origin, GET, `redirect: 'manual'`, bounded.
- `src/engine.ts` orders controls before assertions and never adds an owner filter to reads.
- `src/report.ts` validates the result against the schema and refuses to write or print it if any loaded credential appears.

Tests: `pnpm --filter @ship-safe/runner test` (mocked transport for failure modes). Real authorization behaviour is covered only by `tests/integration`.
