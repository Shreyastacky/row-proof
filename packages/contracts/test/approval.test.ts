import { describe, expect, it } from 'vitest';
import {
  ApprovalError,
  contentHashOf,
  createApprovedRevision,
  createProposal,
  ruleContentHash,
  verifyApprovedRevision,
  verifyProposal,
  type RuleProposal,
} from '../src/index.js';
import { exampleRule, getAt, leafPaths, perturb, setAt } from './helpers.js';

const NOW = new Date('2026-11-05T12:00:00.000Z');

function proposal(content = exampleRule()): RuleProposal {
  return createProposal({
    content,
    basedOn: null,
    proposedBy: { id: 'dev', kind: 'local-user' },
    note: null,
    proposalId: '7b2f0000-0000-4000-8000-000000000001',
    now: NOW,
  });
}

function approve(p: RuleProposal, acknowledgedHash = p.contentHash) {
  return createApprovedRevision({
    proposal: p,
    revision: 1,
    acknowledgedHash,
    approvedBy: { id: 'owner', kind: 'local-user' },
    provenanceLevel: 'local-self-attested',
    supersedes: null,
    approvalId: '7b2f0000-0000-4000-8000-0000000000a1',
    now: NOW,
  });
}

describe('proposal and approval are distinct', () => {
  it('a proposal records content and its hash but no approval', () => {
    const p = proposal();
    expect(verifyProposal(p).ok).toBe(true);
    expect(p).not.toHaveProperty('approval');
    expect(p.contentHash).toBe(ruleContentHash(p.content));
  });

  it('approval binds the approver to the exact content hash with self-attested provenance', () => {
    const rev = approve(proposal());
    expect(verifyApprovedRevision(rev).ok).toBe(true);
    expect(rev.approval.contentHash).toBe(rev.contentHash);
    expect(rev.approval.acknowledgedHash).toBe(rev.contentHash);
    expect(rev.approval.provenance.level).toBe('local-self-attested');
    expect(rev.approval.provenance.statement).toMatch(/can bypass it/);
  });

  it('refuses an approval whose acknowledged hash is not the current content hash', () => {
    const p = proposal();
    const other = contentHashOf({ different: true });
    expect(() => approve(p, other)).toThrow(ApprovalError);
    try {
      approve(p, other);
    } catch (e) {
      expect((e as ApprovalError).code).toBe('acknowledgment_mismatch');
    }
  });

  it('refuses to approve a proposal whose recorded hash no longer matches its content', () => {
    const p = proposal();
    p.content.title = 'edited after the hash was computed';
    try {
      approve(p);
      expect.unreachable();
    } catch (e) {
      expect((e as ApprovalError).code).toBe('proposal_invalid');
    }
  });

  it('refuses to approve well-formed content outside supported v1 scope', () => {
    const c = exampleRule();
    c.resource.operation = 'delete';
    const p = proposal(c);
    try {
      approve(p);
      expect.unreachable();
    } catch (e) {
      expect((e as ApprovalError).code).toBe('proposal_unsupported');
    }
  });
});

describe('changed content cannot reuse an existing approval', () => {
  const approved = approve(proposal());
  const paths = leafPaths(approved.content);

  it('covers every leaf of the rule content', () => {
    expect(paths.length).toBeGreaterThan(50);
  });

  it.each(paths.map((p) => [p.join('/'), p] as const))('changing content/%s invalidates the approval', (_label, path) => {
    const tampered = structuredClone(approved);
    setAt(tampered.content, path, perturb(getAt(tampered.content, path)));
    const result = verifyApprovedRevision(tampered);
    expect(result.ok).toBe(false);
  });

  it('re-hashing tampered content is still rejected because the approval names the old hash', () => {
    const tampered = structuredClone(approved);
    tampered.content.expectations[2]!.expected = 'exact_fixture_returned';
    tampered.contentHash = contentHashOf(tampered.content);
    const result = verifyApprovedRevision(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain('approval_hash_mismatch');
  });

  it('rewriting approval hashes too still fails semantic checks for unsupported intent', () => {
    // An attacker with write access can always forge a self-attested approval; this is why
    // local approval is labelled self-attested. Here the forged intent is also out of scope.
    const tampered = structuredClone(approved);
    tampered.content.expectations[2]!.expected = 'exact_fixture_returned';
    const h = contentHashOf(tampered.content);
    tampered.contentHash = h;
    tampered.approval.contentHash = h;
    tampered.approval.acknowledgedHash = h;
    const result = verifyApprovedRevision(tampered);
    expect(result.ok).toBe(true); // structurally consistent forgery...
    if (result.ok) expect(result.issues.map((i) => i.code)).toContain('unsupported_expectation'); // ...but flagged
    expect(tampered.approval.provenance.level).toBe('local-self-attested');
  });

  it('approval and content must name the same rule and revision', () => {
    const t1 = structuredClone(approved);
    t1.approval.revision = 2;
    expect(verifyApprovedRevision(t1).ok).toBe(false);
    const t2 = structuredClone(approved);
    t2.approval.ruleId = 'other-rule';
    expect(verifyApprovedRevision(t2).ok).toBe(false);
  });
});
