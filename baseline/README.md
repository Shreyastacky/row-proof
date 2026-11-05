# Approved baseline (demo)

This directory is a Pyx approval store. CI reads it **from the base branch**, not from a pull request's working tree, using `scripts/fetch-trusted-baseline.mjs`. A PR that edits files here is proposing a change; the change takes effect only once it is merged into the base branch.

## Current contents are a placeholder

Revision 1 of `invoice-owner-read` was created by the implementation session with approver id `demo-placeholder-not-owner`, so the synthetic demo has something to assess. **It is not an owner decision.** The designated owner should replace it with their own approval:

```bash
pnpm pyx propose --rule examples/invoice-owner-read.rule.json --store baseline --proposed-by <you> --out /tmp/p.json
pnpm pyx diff --proposal /tmp/p.json --store baseline
pnpm pyx approve --proposal /tmp/p.json --store baseline --approver <owner-id> --acknowledge <hash shown by diff> --promote
```

Re-approving identical content is refused (`no_change`). To record the owner as approver of the same intent, edit the rule's `title` or `declaredScope` wording and approve the new revision.

## What protects this directory

Today, nothing beyond ordinary repository access. Approval records here have `local-self-attested` provenance: anyone who can push to the base branch can rewrite them. Reading the baseline from the base branch only helps if the base branch is protected, for example with a ruleset that requires review from the designated owner for changes under `baseline/` (CODEOWNERS plus required code-owner review). **That protection is not configured by this repository and must be set up and verified by the maintainer.** Until then, treat CI results as development tests, not independent assessments.
