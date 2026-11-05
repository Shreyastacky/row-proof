#!/usr/bin/env node
// Regenerates examples/contracts (the valid/invalid contract corpus and cases.json) from the
// canonical rules. Deterministic: fixed ids and timestamps. Run after `pnpm build`.
// Usage: node scripts/build-examples.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const C = await import(`${root}/packages/contracts/dist/index.js`);
const base = JSON.parse(readFileSync(`${root}/examples/invoice-owner-read.rule.json`, 'utf8'));
const clone = (x) => structuredClone(x);
const dir = `${root}/examples/contracts`;
mkdirSync(`${dir}/valid`, { recursive: true }); mkdirSync(`${dir}/invalid`, { recursive: true });
const cases = [];
const put = (sub, name, kind, doc, expect, raw) => {
  const file = `${sub}/${name}.json`;
  writeFileSync(`${dir}/${file}`, raw ?? JSON.stringify(doc, null, 2) + '\n');
  cases.push({ file, kind, expect });
};
const mut = (fn) => { const c = clone(base); fn(c); return c; };

// ---- valid
put('valid', 'rule-content.legacy-anon', 'RuleContent', mut(c => { c.target.apiKey = { kind: 'legacy-anon', credential: { source: 'env', name: 'PYX_LEGACY_ANON_KEY' } }; }), { valid: true });
const now = new Date('2026-11-05T12:00:00.000Z');
const proposal = C.createProposal({ content: base, basedOn: null, proposedBy: { id: 'agency-dev', kind: 'local-user' }, note: 'Initial owner-only read rule for the invoice portal demo.', proposalId: '7b2f0000-0000-4000-8000-000000000001', now });
put('valid', 'proposal.invoice', 'RuleProposal', proposal, { valid: true });
const rev = C.createApprovedRevision({ proposal, revision: 1, acknowledgedHash: proposal.contentHash, approvedBy: { id: 'client-owner', kind: 'local-user' }, provenanceLevel: 'local-self-attested', supersedes: null, approvalId: '7b2f0000-0000-4000-8000-0000000000a1', now: new Date('2026-11-05T12:05:00.000Z') });
put('valid', 'approved-revision.invoice', 'ApprovedRevision', rev, { valid: true });

// ---- invalid RuleContent
put('invalid', 'duplicate-expectation', 'RuleContent', mut(c => c.expectations.push(clone(c.expectations[4]))), { code: 'duplicate_expectation_id' });
put('invalid', 'matrix-incomplete', 'RuleContent', mut(c => c.expectations.pop()), { code: 'matrix_incomplete' });
put('invalid', 'unknown-fixture-ref', 'RuleContent', mut(c => { c.expectations[0].fixtureRef = 'invoice-z'; }), { code: 'unknown_fixture_ref' });
put('invalid', 'credential-value-in-title', 'RuleContent', mut(c => { c.title = 'token eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig'; }), { code: 'credential_value_in_document' });
put('invalid', 'credential-ref-outside-namespace', 'RuleContent', mut(c => { c.target.fixtureVerification.credential.name = 'SUPABASE_SERVICE_ROLE_KEY'; }), { code: 'schema' });
put('invalid', 'origin-with-trailing-slash', 'RuleContent', mut(c => { c.target.allowedOrigin = 'http://127.0.0.1:54321/'; }), { code: 'schema' });
put('invalid', 'origin-not-exact-form', 'RuleContent', mut(c => { c.target.allowedOrigin = 'http://LOCALHOST:54321'; }), { code: 'origin_not_exact' });
put('invalid', 'origin-not-loopback', 'RuleContent', mut(c => { c.target.allowedOrigin = 'http://10.0.0.5:54321'; }), { code: 'origin_not_loopback' });
put('invalid', 'same-expected-user', 'RuleContent', mut(c => { c.actors[1].expectedUserId = c.actors[0].expectedUserId; }), { code: 'duplicate_expected_user' });
put('invalid', 'approval-smuggled-into-content', 'RuleContent', mut(c => { c.approved = true; }), { code: 'schema' });
put('invalid', 'uppercase-uuid', 'RuleContent', mut(c => { c.fixtures[0].id = c.fixtures[0].id.toUpperCase(); }), { code: 'schema' });
put('invalid', 'marker-not-synthetic', 'RuleContent', mut(c => { c.fixtures[0].marker = 'invoice-a'; }), { code: 'schema' });
put('invalid', 'anonymous-missing', 'RuleContent', mut(c => { c.actors.pop(); c.expectations = c.expectations.filter(e => e.actorRef !== 'anonymous'); }), { code: 'anonymous_actor_required' });
put('invalid', 'future-schema-version', 'RuleContent', mut(c => { c.schemaVersion = 2; }), { code: 'schema' });
put('invalid', 'credential-ref-reused', 'RuleContent', mut(c => { c.actors[1].credential.name = c.actors[0].credential.name; }), { code: 'duplicate_credential_ref' });
const dupText = JSON.stringify(base, null, 2).replace('"expected": "fixture_not_disclosed"', '"expected": "fixture_not_disclosed", "expected": "exact_fixture_returned"');
put('invalid', 'duplicate-json-key', 'RuleContent', null, { code: 'json_duplicate_key' }, dupText + '\n');
// ---- unsupported (well-formed, outside v1)
put('invalid', 'unsupported-insert-operation', 'RuleContent', mut(c => { c.resource.operation = 'insert'; }), { unsupported: 'unsupported_operation' });
put('invalid', 'unsupported-shared-read', 'RuleContent', mut(c => { c.expectations[2].expected = 'exact_fixture_returned'; }), { unsupported: 'unsupported_expectation' });
put('invalid', 'unsupported-remote-environment', 'RuleContent', mut(c => { c.target.environmentClass = 'remote-non-production'; c.target.allowedOrigin = 'https://staging.example.com'; }), { unsupported: 'unsupported_environment_class' });
put('invalid', 'unsupported-tenant-model', 'RuleContent', mut(c => { c.resource.ownershipModel = 'tenant-membership'; }), { unsupported: 'unsupported_ownership_model' });
// ---- request paths
const three = JSON.parse(readFileSync(`${root}/examples/invoice-three-paths.rule.json`, 'utf8'));
const mut3 = (fn) => { const c = clone(three); fn(c); return c; };
put('valid', 'rule-content.three-paths', 'RuleContent', three, { valid: true });
put('invalid', 'path-id-reserved', 'RuleContent', mut3(c => { c.paths[0].id = 'data-api'; }), { code: 'reserved_path_id' });
put('invalid', 'path-app-origin-not-loopback', 'RuleContent', mut3(c => { c.paths[1].origin = 'https://app.example.com'; }), { code: 'origin_not_loopback' });
put('invalid', 'path-template-without-id', 'RuleContent', mut3(c => { c.paths[1].pathTemplate = '/api/invoices'; }), { code: 'schema' });
put('invalid', 'path-denied-status-500', 'RuleContent', mut3(c => { c.paths[1].deniedStatuses = [500]; }), { code: 'schema' });
// ---- invalid proposal / approval
put('invalid', 'proposal-content-edited-after-hash', 'RuleProposal', (() => { const p = clone(proposal); p.content.expectations[2].expected = 'exact_fixture_returned'; return p; })(), { code: 'content_hash_mismatch' });
put('invalid', 'approved-revision-content-changed', 'ApprovedRevision', (() => { const r = clone(rev); r.content.fixtures[1].ownerRef = 'user-a'; r.content.expectations[1].expected = 'fixture_not_disclosed'; r.content.expectations[2].expected = 'exact_fixture_returned'; return r; })(), { code: 'content_hash_mismatch' });
put('invalid', 'approved-revision-rehashed-without-approval', 'ApprovedRevision', (() => { const r = clone(rev); r.content.title = 'Changed title after approval'; r.contentHash = C.contentHashOf(r.content); return r; })(), { code: 'approval_hash_mismatch' });
put('invalid', 'approval-acknowledged-other-hash', 'ApprovedRevision', (() => { const r = clone(rev); r.approval.acknowledgedHash = 'sha256:' + '0'.repeat(64); return r; })(), { code: 'acknowledgment_mismatch' });
writeFileSync(`${dir}/cases.json`, JSON.stringify({ description: 'Each case names a document kind and the expected validation outcome. Tests in packages/contracts/test/examples.test.ts enforce these.', cases }, null, 2) + '\n');
console.log(cases.length, 'cases');
