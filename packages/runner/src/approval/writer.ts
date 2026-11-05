/**
 * Local approval store WRITER. Used only by the propose / approve / promote
 * commands. The `run` command never imports this module (enforced by a test).
 *
 * Immutability: revisions, promotions and proposals are created with exclusive
 * create (`wx`), so an existing file is never overwritten. Only the active
 * pointer is replaced, atomically, and only after an immutable promotion record
 * exists for it.
 *
 * Trust: this store is LOCAL and SELF-ATTESTED. Anyone who can write the
 * directory can bypass it. It provides workflow separation, not independent
 * approval.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ApprovalError,
  BaselineError,
  createApprovedRevision,
  hashesEqual,
  openFileBaselineReader,
  storePaths,
  verifyProposal,
  type ActiveBaseline,
  type ApprovedRevision,
  type Promotion,
  type RevisionPointer,
  type RuleProposal,
} from '@ship-safe/contracts';

async function writeExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const fh = await open(path, 'wx', 0o644);
  try {
    await fh.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function replaceAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  await rename(tmp, path);
}

function isExists(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'EEXIST';
}

export interface ApproveOptions {
  proposal: RuleProposal;
  acknowledgedHash: string;
  approverId: string;
  promote: boolean;
  now?: Date;
}

export interface ApproveOutcome {
  revision: ApprovedRevision;
  promoted: Promotion | null;
}

export class LocalApprovalStoreWriter {
  private readonly reader;
  constructor(private readonly root: string) {
    this.reader = openFileBaselineReader(root);
  }

  /** Active pointer, or null if the rule has never been promoted. Integrity errors propagate. */
  async currentActive(ruleId: string): Promise<RevisionPointer | null> {
    try {
      const v = await this.reader.readActive(ruleId);
      return { revision: v.revision.revision, contentHash: v.revision.contentHash };
    } catch (e) {
      if (e instanceof BaselineError && e.code === 'not_found') return null;
      throw e;
    }
  }

  async recordProposal(proposal: RuleProposal): Promise<string> {
    const verified = verifyProposal(proposal);
    if (!verified.ok) throw new ApprovalError('proposal_invalid', verified.issues.map((i) => i.code).join(', '));
    const rel = storePaths.proposal(proposal.ruleId, proposal.proposalId);
    try {
      await writeExclusive(join(this.root, rel), proposal);
    } catch (e) {
      if (!isExists(e)) throw e;
      // Same proposal id already recorded: acceptable only if it is the same content.
    }
    return rel;
  }

  async approve(opts: ApproveOptions): Promise<ApproveOutcome> {
    const now = opts.now ?? new Date();
    const { proposal } = opts;
    const active = await this.currentActive(proposal.ruleId);

    // Concurrency: the proposal must be based on the currently active revision.
    const basedOn = proposal.basedOn;
    const sameBase =
      (active === null && basedOn === null) ||
      (active !== null && basedOn !== null && active.revision === basedOn.revision && hashesEqual(active.contentHash, basedOn.contentHash));
    if (!sameBase) {
      throw new ApprovalError(
        'stale_proposal',
        `proposal is based on ${basedOn ? `revision ${basedOn.revision}` : 'no revision'} but the active baseline is ${
          active ? `revision ${active.revision}` : 'empty'
        }; re-propose against the current baseline and review the new diff`,
      );
    }
    if (active && hashesEqual(active.contentHash, proposal.contentHash)) {
      throw new ApprovalError('no_change', 'the proposal content is identical to the active approved revision');
    }

    const existing = await this.reader.listRevisionNumbers(proposal.ruleId);
    const next = (existing.at(-1) ?? 0) + 1;
    const revision = createApprovedRevision({
      proposal,
      revision: next,
      acknowledgedHash: opts.acknowledgedHash,
      approvedBy: { id: opts.approverId, kind: 'local-user' },
      provenanceLevel: 'local-self-attested',
      supersedes: active,
      approvalId: randomUUID(),
      now,
    });

    await this.recordProposal(proposal);
    try {
      await writeExclusive(join(this.root, storePaths.revision(proposal.ruleId, next)), revision);
    } catch (e) {
      if (isExists(e)) throw new ApprovalError('revision_conflict', `revision ${next} was created concurrently; retry`);
      throw e;
    }
    const promoted = opts.promote ? await this.promote(proposal.ruleId, next, revision.contentHash, opts.approverId, now) : null;
    return { revision, promoted };
  }

  /**
   * Make an approved revision the active baseline. Requires the exact content hash
   * as acknowledgment, writes an immutable promotion record, then moves the pointer.
   */
  async promote(ruleId: string, revisionNumber: number, acknowledgedHash: string, promotedBy: string, now = new Date()): Promise<Promotion> {
    const target = await this.reader.readRevision(ruleId, revisionNumber);
    if (!hashesEqual(target.revision.contentHash, acknowledgedHash)) {
      throw new ApprovalError('acknowledgment_mismatch', 'acknowledged hash does not match the revision being promoted');
    }
    const previous = await this.currentActive(ruleId);
    const seqs = (await this.listPromotionSeqs(ruleId)).sort((a, b) => a - b);
    const sequence = (seqs.at(-1) ?? 0) + 1;
    const promotion: Promotion = {
      kind: 'Promotion',
      schemaVersion: 1,
      ruleId,
      sequence,
      revision: revisionNumber,
      contentHash: target.revision.contentHash,
      promotedBy,
      promotedAt: now.toISOString(),
      previous,
    };
    try {
      await writeExclusive(join(this.root, storePaths.promotion(ruleId, sequence)), promotion);
    } catch (e) {
      if (isExists(e)) throw new ApprovalError('revision_conflict', 'a concurrent promotion happened; retry');
      throw e;
    }
    const active: ActiveBaseline = {
      kind: 'ActiveBaseline',
      schemaVersion: 1,
      ruleId,
      revision: revisionNumber,
      contentHash: target.revision.contentHash,
      promotionSequence: sequence,
    };
    await replaceAtomically(join(this.root, storePaths.active(ruleId)), active);
    return promotion;
  }

  private async listPromotionSeqs(ruleId: string): Promise<number[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      return (await readdir(join(this.root, storePaths.promotionsDir(ruleId))))
        .map((n) => /^p(\d{6})\.json$/.exec(n))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]));
    } catch {
      return [];
    }
  }
}
