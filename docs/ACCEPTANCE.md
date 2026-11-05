# Acceptance scenarios

Required behaviours. Status as of 5 November 2026: **U** = covered by unit tests (`pnpm verify`; mocked transport where the spec allows), **I** = verified over real HTTP against local Supabase (`pnpm integration`), **-** = not yet implemented. Hosted-boundary items are later phases.

## Valid controls and read isolation

| Scenario | Required result | Status |
| --- | --- | --- |
| A reads A's exact invoice ID and marker | passed owner assertion | U I |
| B reads B's exact invoice ID and marker | passed owner assertion | U I |
| A reads B, B reads A; owner controls valid | passed only when the target fixture is not disclosed using supported response semantics | U I |
| Anonymous reads A and B; controls valid | separate passed assertions only when neither fixture is disclosed | U I |
| A permissive local policy exposes B's fixture to A | failed with a safe fixture reference and reproducible local case | U I (throwaway instance) |
| HTTP 200 with incorrect/absent owner fixture | owner control cannot pass; dependent denied checks cannot establish isolation | U I |

## Invalid execution and scope

| Scenario | Required behavior | Status |
| --- | --- | --- |
| A and B authenticate as the same user | blocked, no isolation pass | U I |
| Expired or invalid user token | blocked; do not mislabel auth failure as enforced isolation | U I |
| Wrong project/origin or cross-origin redirect | stop with blocked status before proceeding against the other target | U (redirects) I (origins, forged token) |
| Production target or missing environment authorization | reject/stop | U (non-loopback rejected; remote is unsupported) |
| Fixture missing or ownership inconsistent | blocked, no isolation pass | U I |
| Setup/admin credential used for an ordinary user read | reject/stop | U I |
| Timeout, 429, server error, unknown payload shape, generic 404 | blocked or incomplete, never a denial pass | U (I: connection refused, 403) |
| Response exceeds bounds or run exceeds request/time budget | stop with blocked/incomplete diagnostics | U (I: request budget) |
| Unsupported operation, route, or ownership model | not assessed with reason | U I |
| Some assertions pass while others are blocked/unassessed | no overall passing matrix | U I |
| Valid disclosure failure plus another blocked assertion | retain the failure; also show incompleteness | U |

## Rule approval and evidence

- Changing intent produces a new proposal/hash and requires a new authorized approval. **U I** (authorization is local and self-attested)
- An ordinary implementation edit cannot overwrite the approved baseline. **U I** (baseline read from the base ref; ref protection not configured)
- Runs retain their exact approved rule hash even after a new revision is approved. **U I**
- An observed relevant policy/config change makes older evidence stale pending a matching run. **-** (Phase 8; results report `unknown`)
- Unknown dependencies and absent observers remain visible; no invented continuous-monitoring claim. **U I** (`no_dependency_observer`)
- A staging run never appears as a production assessment. **U** (only local-disposable targets are assessable)

## Data handling and hosted boundaries — later

- Tokens, passwords, raw rows, and private source do not appear in stdout, JSON results, logs, crash reports, or uploaded artifacts. **U I** for the runner and fixture tooling (hosted paths later)
- Public demonstration fixtures and examples contain synthetic information only.
- Redaction tests cover nested payloads and error paths. **U** (provider echoing credentials in error bodies)
- Ingestion rejects malformed, oversized, sensitive, duplicate/replayed, or unauthorized submissions as appropriate.
- Organization A cannot read, upload to, approve rules for, or delete Organization B's data, including through guessed IDs.
- Revoked credentials and removed memberships lose access immediately according to the documented revocation design.
- Stored data can be exported/deleted under the implemented retention controls.

## Reproducibility gate

From a fresh checkout: start a disposable local instance, provision synthetic users/fixtures, run the approved matrix, show correct-policy success, show permissive-policy failure in a separate throwaway local instance, then tear it down. Preserve only redacted artifacts. CI must reproduce those outcomes.

**Status:** met from a fresh clone in a local Linux/Docker environment on 5 November 2026 (`pnpm integration`, 24/24; 27/27 after the RowProof product pass). GitHub Actions reproduction is written (`.github/workflows/rowproof.yml`) but has not run yet.
