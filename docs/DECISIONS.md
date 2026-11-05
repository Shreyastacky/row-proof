# Implementation decisions

Short records of choices that shape trust boundaries or maintenance. Each says what was decided, why, and what would change it. Checked against current documentation on 5 November 2026.

## D1. One JSON Schema bundle is the authoritative contract

`packages/contracts/schemas/ship-safe.v1.schema.json` (draft 2020-12, `$id` `urn:ship-safe:schemas:v1`) defines every document type under `$defs`. Ajv validates documents at runtime against `$defs/<Kind>`. `src/types.generated.ts` is generated from the same file by `json-schema-to-typescript`; `pnpm check:generated` fails when the committed types drift from the schema.

Why: portable for non-TypeScript consumers (a future hosted service, other runners), and one source for validation and types. Semantic rules JSON Schema cannot express (complete matrix, reference integrity, supported scope, credential-shaped values) live in `src/semantic.ts`.

## D2. Content hash = SHA-256 over RFC 8785 canonical JSON

`contentHash = "sha256:" + hex(sha256(utf8(JCS(RuleContent))))`. RuleContent carries `kind` and `schemaVersion`, which separates its hash domain from other document types. Unit tests pin the RFC 8785 sample vector and a golden hash of the example rule.

Documents carrying intent or approvals are parsed with a strict parser that rejects duplicate keys. `JSON.parse` silently keeps the last duplicate, so without this a reviewer could read one value while the hash covers another.

## D3. Proposals, approvals, revisions and promotions are separate records

- A **proposal** holds content, its hash, `basedOn`, and the proposer. It carries no authority.
- An **approval** names exactly one content hash. The approver must type that hash (`--acknowledge`), and approval is refused if it differs from the proposal's recomputed hash.
- An **approved revision** (content + approval) is written once, with exclusive create, and never overwritten.
- A **promotion** record, also immutable, moves the active pointer. The reader requires the pointer to match the latest promotion.

Changing any byte of intent changes the hash. Verification then fails, so an existing approval cannot be reused. A test perturbs every leaf of the rule to prove this.

**Limitation, stated plainly:** the local store is *self-attested*. Anyone who can write the directory can forge a consistent revision and approval. Provenance is recorded as `local-self-attested`. Independent approval needs a separately protected ref or an authenticated control plane (Phase 5/6/7).

## D4. The runner reads approvals through a read-only interface

`ApprovedBaselineReader` (contracts) has no write methods. The writer (`packages/runner/src/approval/writer.ts`) is used only by propose/approve/promote. A test walks the import graph of `commands/run.ts` and fails if it reaches the writer.

## D5. Bounded raw HTTP for assertions; supabase-js only for privileged local setup

Assertions and identity checks use Node's `fetch` through `BoundedFetchTransport`: GET only, a single exact origin, `redirect: 'manual'` with every 3xx a failure, per-request timeout, run deadline, request budget, streamed byte cap, concurrency 1, zero retries. supabase-js does not offer response byte caps or a way to refuse redirects.

User identity is verified by calling the target's Auth service at `GET /auth/v1/user`, the endpoint behind supabase-js `auth.getUser(jwt)`. An integration test cross-checks the runner's result against `getUser(jwt)` for the same token. Decoding the JWT happens only (a) to refuse elevated or malformed credentials before sending them and (b) to read `iss`/`exp` after Auth has accepted the token.

## D6. Supported response semantics (v1)

Grants allow SELECT for `anon` and `authenticated`, and RLS filters rows. A denial passes only as a well-formed empty JSON array, and only after the target, API key, fixture (setup channel), actor identity and that fixture's owner read have all succeeded. Every other response (401, 403, 404, 429, 5xx, redirect, timeout, oversize, malformed) is `blocked`. A concrete disclosure (exact id + owner + marker of a forbidden fixture) is `failed` even when other controls are blocked.

A row with the fixture's id but a different owner or marker is `blocked` (inconsistent fixture), not a disclosure.

## D7. Toolchain and pins

| Item | Pinned | Reason |
| --- | --- | --- |
| Node | engines `>=22.12`; CI uses 24 (`.node-version`) | 22 is Maintenance LTS to 2027-04-30; 24 is Maintenance LTS to 2028-04-30; 26 became Active LTS on 2026-10-28 (nodejs/Release schedule.json). 24 is the conservative CI default. |
| pnpm | 10.28.0 (`packageManager`) | Installed and verified here. `minimumReleaseAge` (7 days) guards against just-published packages. |
| TypeScript | 6.0.3 | Mature JS-based compiler. 7.x (native) is available; migrate deliberately. |
| Vitest | 5.0.5 | Released three weeks earlier; 5.1.0 was three days old. |
| Ajv | 8.20.0 | Draft 2020-12 support. |
| @supabase/supabase-js | 2.118.0 | Setup tooling and identity cross-check only. 2.119.0 was one day old. |
| Supabase CLI | 2.122.1 (`v2.stable`) | v3.0.0 shipped on 2026-11-02 with breaking target-default and config changes. Supabase still ships security fixes for v2. Only local commands are used (`start`, `stop`, `status`, `db reset`), and they behave the same on both. `config.toml` already uses `[local_smtp]`, the v3-compatible name. Excluded from the release-age gate deliberately. |

Revisit: move CI to Node 26 once 24 nears end of life; evaluate CLI v3 after it has had patch releases.
