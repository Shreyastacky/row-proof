# @pyx/contracts

Authoritative v1 contracts and the semantics around them. No dependency on Supabase, Next.js or a hosted account model.

- `schemas/pyx.v1.schema.json`: JSON Schema (draft 2020-12) bundle; validate a document against `#/$defs/<Kind>`.
- `src/types.generated.ts`: generated from the schema (`pnpm generate`; `pnpm check:generated` fails on drift).
- `src/strict-json.ts`: parser that rejects duplicate keys, `__proto__`, lone surrogates and oversized input.
- `src/canonical.ts`: RFC 8785 canonical JSON and `sha256:` content hashes.
- `src/semantic.ts`: complete-matrix, reference-integrity, supported-scope and credential-value checks.
- `src/documents.ts`: proposal and approved-revision builders and verifiers (approval binds one acknowledged hash).
- `src/outcome.ts`: pass/fail/blocked and exit-code rules.
- `src/baseline.ts`: read-only `ApprovedBaselineReader` and the store layout.

Examples and the valid/invalid corpus live in `examples/`.
