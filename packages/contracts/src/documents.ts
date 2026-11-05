/**
 * Proposal and approval semantics.
 *
 * - RuleContent is the intent. Its content hash identifies it.
 * - A RuleProposal carries content plus who proposed it. It has no authority.
 * - An Approval binds one approver to one exact content hash (the approver must
 *   acknowledge that hash explicitly).
 * - An ApprovedRevision is immutable: content + the approval naming its hash.
 *   Changing any byte of intent changes the hash, so an existing approval can
 *   never be reused for changed content.
 */
import { contentHashOf, hashesEqual } from './canonical.js';
import { checkRuleContentSemantics, findCredentialValues } from './semantic.js';
import { parseStrictJson, StrictJsonError } from './strict-json.js';
import type {
  Approval,
  ApprovalProvenanceLevel,
  ApprovedRevision,
  RevisionPointer,
  RuleContent,
  RuleProposal,
} from './types.generated.js';
import { validateSchema, type DocumentKind, type DocumentTypes, type Issue, type ValidationResult } from './validate.js';

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export function unsupportedIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === 'unsupported');
}

/** Parse text strictly and validate it as a document of `kind` (structure only). */
export function parseDocument<K extends DocumentKind>(kind: K, text: string): ValidationResult<DocumentTypes[K]> {
  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch (e) {
    if (e instanceof StrictJsonError) {
      return { ok: false, issues: [{ code: `json_${e.code}`, path: '/', message: e.message, severity: 'error' }] };
    }
    throw e;
  }
  return validateSchema(kind, value);
}

/**
 * Schema + semantic validation of rule content. `ok` is false only for errors;
 * well-formed but unsupported content is `ok` with `unsupported` issues, so it
 * can be recorded and reported as not assessed rather than silently dropped.
 */
export function validateRuleContent(value: unknown): ValidationResult<RuleContent> {
  const schema = validateSchema('RuleContent', value);
  if (!schema.ok) return schema;
  const issues = checkRuleContentSemantics(schema.value);
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, value: schema.value, issues };
}

export function ruleContentHash(content: RuleContent): `sha256:${string}` {
  return contentHashOf(content);
}

export function isoNow(date: Date = new Date()): string {
  return date.toISOString();
}

export interface CreateProposalInput {
  content: RuleContent;
  basedOn: RevisionPointer | null;
  proposedBy: RuleProposal['proposedBy'];
  note: string | null;
  proposalId: string;
  now: Date;
}

export function createProposal(input: CreateProposalInput): RuleProposal {
  return {
    kind: 'RuleProposal',
    schemaVersion: 1,
    proposalId: input.proposalId,
    ruleId: input.content.ruleId,
    contentHash: ruleContentHash(input.content),
    content: input.content,
    basedOn: input.basedOn,
    proposedBy: input.proposedBy,
    proposedAt: isoNow(input.now),
    note: input.note,
  };
}

/** Verify a proposal: structure, semantics, and that its recorded hash matches its content. */
export function verifyProposal(value: unknown): ValidationResult<RuleProposal> {
  const schema = validateSchema('RuleProposal', value);
  if (!schema.ok) return schema;
  const p = schema.value;
  const issues: Issue[] = [...findCredentialValues(p)];
  const content = validateRuleContent(p.content);
  issues.push(...content.issues.map((i) => ({ ...i, path: `/content${i.path === '/' ? '' : i.path}` })));
  const recomputed = ruleContentHash(p.content);
  if (!hashesEqual(recomputed, p.contentHash)) {
    issues.push({
      code: 'content_hash_mismatch',
      path: '/contentHash',
      message: 'recorded contentHash does not match the canonical hash of content',
      severity: 'error',
    });
  }
  if (p.ruleId !== p.content.ruleId) {
    issues.push({ code: 'rule_id_mismatch', path: '/ruleId', message: 'ruleId differs from content.ruleId', severity: 'error' });
  }
  // dedupe credential issues reported twice (document + content)
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const k = `${i.code}|${i.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (hasErrors(unique)) return { ok: false, issues: unique };
  return { ok: true, value: p, issues: unique };
}

export const PROVENANCE_STATEMENTS: Record<ApprovalProvenanceLevel, string> = {
  'local-self-attested':
    'Local self-attested acknowledgment. It separates the approval step from routine edits, but anyone who can write the approval store can bypass it. It is not independent approval.',
  'protected-ref':
    'Retrieved from a separately protected Git ref. Enforcement depends on repository protections that must be configured and verified separately.',
  'control-plane-authenticated':
    'Recorded by an authenticated reviewer through the hosted control plane.',
};

export interface CreateApprovalInput {
  proposal: RuleProposal;
  revision: number;
  acknowledgedHash: string;
  approvedBy: Approval['approvedBy'];
  provenanceLevel: ApprovalProvenanceLevel;
  supersedes: RevisionPointer | null;
  approvalId: string;
  now: Date;
}

export class ApprovalError extends Error {
  readonly code:
    | 'proposal_invalid'
    | 'proposal_unsupported'
    | 'acknowledgment_mismatch'
    | 'stale_proposal'
    | 'no_change'
    | 'revision_conflict';
  constructor(code: ApprovalError['code'], message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

/**
 * Build an approved revision from a verified proposal. Throws ApprovalError when
 * the approver's acknowledged hash differs from the proposal's actual content hash
 * or when the proposal is invalid/unsupported.
 */
export function createApprovedRevision(input: CreateApprovalInput): ApprovedRevision {
  const verified = verifyProposal(input.proposal);
  if (!verified.ok) {
    throw new ApprovalError('proposal_invalid', `proposal is invalid: ${verified.issues.map((i) => i.code).join(', ')}`);
  }
  const unsupported = unsupportedIssues(verified.issues);
  if (unsupported.length > 0) {
    throw new ApprovalError(
      'proposal_unsupported',
      `proposal is outside supported v1 scope: ${unsupported.map((i) => i.code).join(', ')}`,
    );
  }
  const actual = ruleContentHash(input.proposal.content);
  if (!hashesEqual(actual, input.acknowledgedHash)) {
    throw new ApprovalError(
      'acknowledgment_mismatch',
      'the acknowledged hash does not match the proposal content; review the current diff and acknowledge its exact hash',
    );
  }
  const approval: Approval = {
    kind: 'Approval',
    schemaVersion: 1,
    approvalId: input.approvalId,
    ruleId: input.proposal.ruleId,
    revision: input.revision,
    contentHash: actual,
    acknowledgedHash: input.acknowledgedHash,
    proposalId: input.proposal.proposalId,
    decision: 'approved',
    approvedBy: input.approvedBy,
    approvedAt: isoNow(input.now),
    provenance: { level: input.provenanceLevel, statement: PROVENANCE_STATEMENTS[input.provenanceLevel] },
    supersedes: input.supersedes,
  };
  return {
    kind: 'ApprovedRevision',
    schemaVersion: 1,
    ruleId: input.proposal.ruleId,
    revision: input.revision,
    contentHash: actual,
    content: input.proposal.content,
    approval,
  };
}

/**
 * Verify an approved revision. This is the check that prevents changed content
 * from reusing an existing approval: the canonical hash of `content` must equal
 * the revision hash, the approval's hash, and the hash the approver acknowledged.
 */
export function verifyApprovedRevision(value: unknown): ValidationResult<ApprovedRevision> {
  const schema = validateSchema('ApprovedRevision', value);
  if (!schema.ok) return schema;
  const rev = schema.value;
  const issues: Issue[] = [];
  const bad = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: 'error' });
  const actual = ruleContentHash(rev.content);
  if (!hashesEqual(actual, rev.contentHash)) bad('content_hash_mismatch', '/contentHash', 'content does not match recorded hash');
  if (!hashesEqual(actual, rev.approval.contentHash)) {
    bad('approval_hash_mismatch', '/approval/contentHash', 'approval names a different content hash');
  }
  if (!hashesEqual(rev.approval.contentHash, rev.approval.acknowledgedHash)) {
    bad('acknowledgment_mismatch', '/approval/acknowledgedHash', 'approver acknowledged a different hash');
  }
  if (rev.ruleId !== rev.content.ruleId || rev.ruleId !== rev.approval.ruleId) {
    bad('rule_id_mismatch', '/ruleId', 'ruleId differs between revision, content, and approval');
  }
  if (rev.revision !== rev.approval.revision) bad('revision_mismatch', '/revision', 'revision differs from approval.revision');
  if (rev.approval.supersedes && rev.approval.supersedes.revision >= rev.revision) {
    bad('supersedes_not_earlier', '/approval/supersedes', 'an approval can only supersede an earlier revision');
  }
  const content = validateRuleContent(rev.content);
  issues.push(...content.issues.map((i) => ({ ...i, path: `/content${i.path === '/' ? '' : i.path}` })));
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, value: rev, issues };
}
