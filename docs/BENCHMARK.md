# Pyx mutation benchmark

Each row is one deliberate change made to a throwaway local Supabase stack, followed by a real
`pyx run` over HTTP. Nothing here is simulated. The harness that produces it is
`tests/integration/harness.mjs`; regenerate this page with `pnpm integration` and
`node scripts/build-benchmark.mjs`.

Run: 2026-11-05T06:41:10.695Z · Node v22.23.4 · Docker 29.9.2 · Supabase CLI 2.122.1

| | Count |
| --- | --- |
| Detected (reported as a violation, exit 1) | 8 |
| Blocked (no trustworthy assessment, exit 2, never a pass) | 7 |
| Missed (the run passed) | 1 |
| Unsupported (outside v1 scope, not assessed) | 0 |
| Behaved as designed | 16 of 16 |

## Access regressions: these must be detected

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
| App route fetches with the secret key and only checks sign-in | app route | data-api, rpc-get-invoice, app-invoice-route | **detected** |
| SELECT policy `using (true)` for every signed-in user | policy | data-api | **detected** |
| SELECT policy open to the anon role | policy | data-api | **detected** |
| Owner SELECT policy dropped (owners lose access) | policy | data-api | **detected** |
| SELECT grant revoked from authenticated | grant | data-api | **detected** |
| SECURITY DEFINER RPC without an owner check | rpc | data-api, rpc-get-invoice, app-invoice-route | **detected** |
| Owner policy typo: `owner_id = owner_id` | policy | data-api | **detected** |
| Row level security disabled on the table | policy | data-api | **detected** |

## Broken test setups: these must block, never pass

A tool that turns a broken test environment into a green check is worse than no tool.

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
| Token signed by another project | identity | data-api | **blocked** |
| Both user tokens belong to the same account | identity | data-api | **blocked** |
| Expired user token | identity | data-api | **blocked** |
| Test record deleted before the run | test environment | data-api | **blocked** |
| Test record re-assigned to another user | test environment | data-api | **blocked** |
| Test record marker changed | test environment | data-api | **blocked** |
| Target not reachable | transport | data-api | **blocked** |

## Known gaps: published on purpose

| Change | Layer | Paths checked | Result |
| --- | --- | --- | --- |
| Same RPC bug, but the rule lists only the Data API path | rpc | data-api | **missed** |

Pyx checks the request paths a rule lists. The RPC bug above is detected when the rule lists the
RPC and missed when it does not. `pyx init` and `pyx doctor` list the paths a rule covers so the gap is visible.

## Out of scope in v1 (reported as not assessed, never as a pass)

- Writes (INSERT, UPDATE, DELETE) and their policies
- Tenant membership, shared records and delegated roles
- Storage buckets, Realtime and Edge Functions
- Remote or production projects (local disposable stacks only)
