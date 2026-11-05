# Implementation decisions

Short records of choices that shape trust boundaries or maintenance. Each says what was decided, why, and what would change it. Checked against current documentation on 5 November 2026.

## D1. One JSON Schema bundle is the authoritative contract

`packages/contracts/schemas/pyx.v1.schema.json` (draft 2020-12, `$id` `urn:pyx:schemas:v1`) defines every document type under `$defs`. Ajv validates documents at runtime against `$defs/<Kind>`. `src/types.generated.ts` is generated from the same file by `json-schema-to-typescript`; `pnpm check:generated` fails when the committed types drift from the schema.

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

Grants allow SELECT for `anon` and `authenticated`, and RLS filters rows. On the Data API a denial passes only as a well-formed empty JSON array, and only after the target, API key, fixture (setup channel), actor identity, anonymous context, and that fixture's owner read on the same path have all succeeded. Every other response (401, 403, 404, 429, 5xx, redirect, timeout, oversize, malformed) is `blocked`.

**Disclosure (revised after the external audit).** Once the fixture is verified as another user's record, any trace of it in a forbidden response is `failed`: a returned row with its id (even with the owner and marker stripped or changed), its marker anywhere in the body (including an error message), or its id in a success response. An error that only echoes the requested id is not a disclosure. Matching uses whole-token boundaries, so `synthetic-invoice-bb` never matches `synthetic-invoice-b`. If the fixture could not be verified, only an exact match (id, declared owner and marker) counts as a disclosure; a partial match is `blocked`.

**Fixture stability.** After the reads, the fixtures are read again through the setup channel (control `fixtures-stable`). If a fixture verified at the start vanished or changed owner or marker, every pass in the run becomes `blocked` (`fixture_unstable`): an empty read of a deleted row proves nothing. Failures are kept. If the re-check itself cannot run (budget, timeout), passes are blocked with that reason.

**Anonymous context.** Auth must refuse the anonymous request headers (`GET /auth/v1/user` returns 401/403). If Auth accepts them as a user, every anonymous assertion is `blocked` (`anonymous_context_invalid`).

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

## D8. Product name: Pyx (renamed from Ship Safe, then RowProof)

**Ship Safe → RowProof (5 November 2026).** At least three unrelated security tools for AI-written code already publish as "Ship Safe" (npm `ship-safe`, `@ship-safe/cli`, `@shipsafe/cli`; shipsafe.sh, ship-safe.co, shipsafe.org), so the product took a distinct name, RowProof.

**RowProof → Pyx (5 November 2026, maintainer's decision).** The name comes from the *Trial of the Pyx*: since the 1200s, coins from the Royal Mint are sealed in a box (the pyx) and independently tested to prove they are genuine. Pyx does the same for access rules.

- **npm:** `pyx` is taken by an unrelated 2015 library, so the package is **`pyx-cli`** and the command is **`pyx`**.
- **Identifiers:** env prefix `PYX_`, schema `urn:pyx:schemas:v1`, local state `.pyx/`, demo project `pyx-demo`, workflow `pyx.yml`.
- **Not done:** renaming the GitHub repository (currently `Shreyastacky/row-proof`) and a trademark search on "Pyx". Both are owner actions. Links keep working through GitHub's redirect after a rename.
- **Naming risk (found in the publishability audit):** Astral, the company behind `uv` and `ruff`, launched a Python package registry called **pyx** in 2025. It is a well-known developer-tool brand in an adjacent space, so a developer tool also called Pyx will compete with it in search and may face a trademark objection. Get a clearance search before spending on the brand, or pick a distinct name. Renaming is mechanical (`PYX_` env prefix, schema URN, package name).

## D9. License: FSL-1.1-ALv2

The business model is a free CLI plus paid services. The Functional Source License allows any use except a competing commercial product or service, explicitly including professional services others provide to their clients. Each release converts to Apache-2.0 after two years. The copyright line names "Shreyastacky (Pyx)": **replace it with your legal name or company.**

## D10. `--credentials`, not `--env-file`

Node 22 intercepts `--env-file` even after the script path. With an existing file it silently loads every credential into `process.env`, so child processes inherit them. With a missing file Node exits 9 before Pyx runs. Our flag is therefore `--credentials <file>`, parsed by Pyx without touching `process.env`.

## D11. Distribution: one bundled npm package

`packages/cli` (`pyx-cli`) bundles the runner, contracts and fixture tooling with esbuild 0.28.2 into `dist/pyx.mjs`, about 1.3 MB including supabase-js. supabase-js is loaded only by `fixture`, so it never touches `run`. `pnpm package` builds the tarball and runs it from a clean install. Standalone entry points live in separate `bin` files so bundling never auto-executes another module.

## D12. Visual identity: "vault" (5 November 2026), superseded

**Superseded** by the liquid-glass redesign: ink ground (#07080c), mint for pass (#5fe0b0), coral for a leak (#ff6a5c), amber for blocked (#ffc457), Schibsted Grotesk and IBM Plex Mono, real refraction on glass surfaces, and an interactive release review in the hero. The record below is kept for history.

The first design used near-black with a cyan-to-violet gradient, glass on every surface, and pill chips. Those are the defaults of AI-generated developer-tool sites, and the result read as generic. The replacement aims at the restraint of an expensive brand:

- **Palette:** obsidian ground (#0A0B0C), bone type (#ECE6DB), one brushed-brass accent (#C9B38A), and calm signal colours: jade for pass (#86B8A0), vermilion for a leak (#F0524F), amber for blocked (#D9A74A). No gradient text.
- **Type:** Newsreader (optical-size serif) for display, Schibsted Grotesk for text, IBM Plex Mono for data. All are OFL-licensed and self-hosted in `apps/web/assets/fonts`, so the site still makes no third-party requests. Reports keep system stacks so they stay self-contained.
- **Mark:** a hallmark, the chamfered stamp that certifies precious metal, containing ledger rows.
- **Structure:** hairline rules instead of cards. Glass is reserved for the few objects that matter.
- **Motion:** one instrument with meaning. A liquid-glass lens scans a ledger as user A sees it across three releases and catches release 42 leaking Bob's invoice. Plus a pointer-following sheen, a nav that turns to glass on scroll, and quiet reveals. All of it is disabled under `prefers-reduced-motion`. The instrument rests on the leak frame when motion is off, and pauses when off-screen.

## D13. Request paths: the same matrix through the Data API, RPC functions and app routes

A table policy says nothing about a SECURITY DEFINER function or a server route that uses the secret key, and those are where AI-written changes most often leak. A rule may list up to three extra paths. The Data API route is always path `data-api`, and every expectation is checked on every path, so assertions are expectations × paths, each with a `path` field.

- **`rpc`:** `GET /rest/v1/rpc/<function>?<idArg>=<uuid>` with the same headers as the Data API (so the function must be STABLE or IMMUTABLE). It may return an array, one row object or null. A `42501` (insufficient_privilege) for a non-owner is a denial.
- **`http`:** `GET <origin><pathTemplate>` with only the user's access token as a bearer (none for anonymous). Supabase keys never leave the Supabase origin. The owner approves `deniedStatuses` (from 200, 401, 403, 404, 410), which says how the route expresses denial. An owner read passes only on 200 with the fixture's id and marker in the body. For local rules the origin must be loopback; the transport accepts only the approved origins.
- Denials on a path depend on the owner control on the same path.

## D14. Approval digest binds promotions to the approval record

Promotions and the active pointer carry `approvalDigest`, the SHA-256 of the canonical Approval record. The reader rejects a store where the approval was edited after promotion (for example the approver's name changed), or where the pointer and the latest promotion disagree on it.

## D15. Release review: `pyx compare`, `pyx run --compare-to`, `pyx repro`

The product's central question is "who gained or lost access in this release?". `compare` diffs two results cell by cell (path, actor, record) into gained access, lost access, still exposed, fixed, restored, unverified, and unchanged. A cell that could not be checked is never reported as unchanged or fixed. Exit 1 means a violation is present (new or still there), 2 means not fully verified, and 0 means clean. The CI template runs the approved rules against the base branch first, then the PR with `--compare-to`. `repro` writes a README and a curl script for every failing check that reference credentials by env variable name only.

## D16. Public mutation benchmark; lab mutations bound to a nonce

`docs/BENCHMARK.md` is generated from the integration harness. Each row is a deliberate change to a throwaway stack and the real result: detected, blocked, missed or unsupported. Known gaps are published, for example an RPC bug the rule does not list. The harness writes a random nonce into the lab database and every mutation first proves, inside the same psql session, that it reached that database. A container name or URL alone is not proof.
