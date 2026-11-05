# Acceptance scenarios

These are required behaviors to implement and test, not tests that currently pass.

## Valid controls and read isolation

| Scenario | Required result |
| --- | --- |
| A reads A's exact invoice ID and marker | passed owner assertion |
| B reads B's exact invoice ID and marker | passed owner assertion |
| A reads B, B reads A; owner controls valid | passed only when the target fixture is not disclosed using supported response semantics |
| Anonymous reads A and B; controls valid | separate passed assertions only when neither fixture is disclosed |
| A permissive local policy exposes B's fixture to A | failed with a safe fixture reference and reproducible local case |
| HTTP 200 with incorrect/absent owner fixture | owner control cannot pass; dependent denied checks cannot establish isolation |

## Invalid execution and scope

| Scenario | Required behavior |
| --- | --- |
| A and B authenticate as the same user | blocked, no isolation pass |
| Expired or invalid user token | blocked; do not mislabel auth failure as enforced isolation |
| Wrong project/origin or cross-origin redirect | stop with blocked status before proceeding against the other target |
| Production target or missing environment authorization | reject/stop |
| Fixture missing or ownership inconsistent | blocked, no isolation pass |
| Setup/admin credential used for an ordinary user read | reject/stop |
| Timeout, 429, server error, unknown payload shape, generic 404 | blocked or incomplete, never a denial pass |
| Response exceeds bounds or run exceeds request/time budget | stop with blocked/incomplete diagnostics |
| Unsupported operation, route, or ownership model | not assessed with reason |
| Some assertions pass while others are blocked/unassessed | no overall passing matrix |
| Valid disclosure failure plus another blocked assertion | retain the failure; also show incompleteness |

## Rule approval and evidence

- Changing intent produces a new proposal/hash and requires a new authorized approval.
- An ordinary implementation edit cannot overwrite the approved baseline.
- Runs retain their exact approved rule hash even after a new revision is approved.
- An observed relevant policy/config change makes older evidence stale pending a matching run.
- Unknown dependencies and absent observers remain visible; no invented continuous-monitoring claim.
- A staging run never appears as a production assessment.

## Data handling and hosted boundaries — later

- Tokens, passwords, raw rows, and private source do not appear in stdout, JSON results, logs, crash reports, or uploaded artifacts.
- Public demonstration fixtures and examples contain synthetic information only.
- Redaction tests cover nested payloads and error paths.
- Ingestion rejects malformed, oversized, sensitive, duplicate/replayed, or unauthorized submissions as appropriate.
- Organization A cannot read, upload to, approve rules for, or delete Organization B's data, including through guessed IDs.
- Revoked credentials and removed memberships lose access immediately according to the documented revocation design.
- Stored data can be exported/deleted under the implemented retention controls.

## Reproducibility gate

From a fresh checkout: start a disposable local instance, provision synthetic users/fixtures, run the approved matrix, show correct-policy success, show permissive-policy failure in a separate throwaway local instance, then tear it down. Preserve only redacted artifacts. CI must reproduce those outcomes.
