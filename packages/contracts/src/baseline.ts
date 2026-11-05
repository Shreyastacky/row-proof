/**
 * Read-only approved-baseline interface.
 *
 * The runner reads approved revisions through this interface only. It exposes
 * no write operations. Every read re-verifies integrity: the active pointer must
 * agree with the latest immutable promotion record, and the revision's content
 * must hash to the value its approval names.
 *
 * Store layout (shared with the separate local writer used by propose/approve):
 *
 *   <store>/<ruleId>/proposals/<proposalId>.json   RuleProposal (no authority)
 *   <store>/<ruleId>/revisions/r000001.json        ApprovedRevision (immutable)
 *   <store>/<ruleId>/promotions/p000001.json       Promotion (immutable)
 *   <store>/<ruleId>/active.json                   ActiveBaseline pointer
 *
 * Where the store lives determines what an approval is worth: a local directory
 * the developer controls is self-attested; a separately protected Git ref or an
 * authenticated control plane is needed for independent approval.
 */
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashesEqual } from './canonical.js';
import { verifyApprovedRevision } from './documents.js';
import { parseStrictJson, StrictJsonError } from './strict-json.js';
import type { ActiveBaseline, ApprovedRevision, Promotion } from './types.generated.js';
import { validateSchema, type Issue } from './validate.js';

export const MAX_BASELINE_FILE_BYTES = 256 * 1024;

export const storePaths = {
  ruleDir: (ruleId: string) => ruleId,
  proposalsDir: (ruleId: string) => join(ruleId, 'proposals'),
  proposal: (ruleId: string, proposalId: string) => join(ruleId, 'proposals', `${proposalId}.json`),
  revisionsDir: (ruleId: string) => join(ruleId, 'revisions'),
  revision: (ruleId: string, revision: number) => join(ruleId, 'revisions', `r${String(revision).padStart(6, '0')}.json`),
  promotionsDir: (ruleId: string) => join(ruleId, 'promotions'),
  promotion: (ruleId: string, seq: number) => join(ruleId, 'promotions', `p${String(seq).padStart(6, '0')}.json`),
  active: (ruleId: string) => join(ruleId, 'active.json'),
};

const REVISION_FILE = /^r(\d{6})\.json$/;
const PROMOTION_FILE = /^p(\d{6})\.json$/;
const RULE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export type BaselineErrorCode =
  | 'invalid_rule_id'
  | 'not_found'
  | 'unreadable'
  | 'too_large'
  | 'symlink_rejected'
  | 'malformed_json'
  | 'schema_invalid'
  | 'integrity_failed'
  | 'active_mismatch'
  | 'pin_mismatch';

export class BaselineError extends Error {
  readonly code: BaselineErrorCode;
  readonly issues: Issue[];
  constructor(code: BaselineErrorCode, message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'BaselineError';
    this.code = code;
    this.issues = issues;
  }
}

/** Minimal read-only file access. Implementations must not follow symlinks out of the store. */
export interface BaselineSource {
  readonly description: string;
  readText(relativePath: string, maxBytes: number): Promise<string | null>;
  list(relativeDir: string): Promise<string[]>;
}

export interface VerifiedBaseline {
  revision: ApprovedRevision;
  active: ActiveBaseline | null;
  sourceDescription: string;
}

export interface BaselinePin {
  revision?: number;
  contentHash?: string;
}

/** The only interface the runner receives. No write operations exist on it. */
export interface ApprovedBaselineReader {
  readActive(ruleId: string, pin?: BaselinePin): Promise<VerifiedBaseline>;
  readRevision(ruleId: string, revision: number): Promise<VerifiedBaseline>;
  listRevisionNumbers(ruleId: string): Promise<number[]>;
}

/** Read-only filesystem source. Opens files read-only and refuses symlinks. */
export class FileBaselineSource implements BaselineSource {
  readonly description: string;
  constructor(private readonly root: string) {
    this.description = `local approval store (self-attested): ${root}`;
  }

  async readText(relativePath: string, maxBytes: number): Promise<string | null> {
    const full = join(this.root, relativePath);
    let st;
    try {
      st = await lstat(full);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) throw new BaselineError('symlink_rejected', `refusing symlink in approval store: ${relativePath}`);
    if (!st.isFile()) throw new BaselineError('unreadable', `not a regular file: ${relativePath}`);
    if (st.size > maxBytes) throw new BaselineError('too_large', `file exceeds ${maxBytes} bytes: ${relativePath}`);
    const fh = await open(full, 'r');
    try {
      const buf = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await fh.read(buf, 0, maxBytes + 1, 0);
      if (bytesRead > maxBytes) throw new BaselineError('too_large', `file exceeds ${maxBytes} bytes: ${relativePath}`);
      return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, bytesRead));
    } catch (e) {
      if (e instanceof BaselineError) throw e;
      throw new BaselineError('unreadable', `cannot read ${relativePath} as UTF-8`);
    } finally {
      await fh.close();
    }
  }

  async list(relativeDir: string): Promise<string[]> {
    try {
      return await readdir(join(this.root, relativeDir));
    } catch {
      return [];
    }
  }
}

function parseJsonFile(text: string, path: string): unknown {
  try {
    return parseStrictJson(text, { maxBytes: MAX_BASELINE_FILE_BYTES });
  } catch (e) {
    if (e instanceof StrictJsonError) throw new BaselineError('malformed_json', `${path}: ${e.message}`);
    throw e;
  }
}

export class ApprovedBaselineStoreReader implements ApprovedBaselineReader {
  constructor(private readonly source: BaselineSource) {}

  private checkRuleId(ruleId: string): void {
    if (!RULE_ID.test(ruleId)) throw new BaselineError('invalid_rule_id', 'rule id must be a lowercase slug');
  }

  private async readRequired(path: string): Promise<unknown> {
    const text = await this.source.readText(path, MAX_BASELINE_FILE_BYTES);
    if (text === null) throw new BaselineError('not_found', `missing ${path} in ${this.source.description}`);
    return parseJsonFile(text, path);
  }

  async listRevisionNumbers(ruleId: string): Promise<number[]> {
    this.checkRuleId(ruleId);
    const names = await this.source.list(storePaths.revisionsDir(ruleId));
    return names
      .map((n) => REVISION_FILE.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  async readRevision(ruleId: string, revision: number): Promise<VerifiedBaseline> {
    this.checkRuleId(ruleId);
    if (!Number.isInteger(revision) || revision < 1) throw new BaselineError('not_found', 'revision must be a positive integer');
    const path = storePaths.revision(ruleId, revision);
    const raw = await this.readRequired(path);
    const verified = verifyApprovedRevision(raw);
    if (!verified.ok) {
      const schemaOnly = verified.issues.every((i) => i.code === 'schema');
      throw new BaselineError(
        schemaOnly ? 'schema_invalid' : 'integrity_failed',
        `${path} failed verification: ${verified.issues.map((i) => i.code).join(', ')}`,
        verified.issues,
      );
    }
    if (verified.value.ruleId !== ruleId || verified.value.revision !== revision) {
      throw new BaselineError('integrity_failed', `${path} does not describe ${ruleId} revision ${revision}`);
    }
    return { revision: verified.value, active: null, sourceDescription: this.source.description };
  }

  async readActive(ruleId: string, pin: BaselinePin = {}): Promise<VerifiedBaseline> {
    this.checkRuleId(ruleId);
    const activeRaw = await this.readRequired(storePaths.active(ruleId));
    const active = validateSchema('ActiveBaseline', activeRaw);
    if (!active.ok) throw new BaselineError('schema_invalid', 'active.json is invalid', active.issues);
    if (active.value.ruleId !== ruleId) throw new BaselineError('active_mismatch', 'active.json names a different rule');

    // The active pointer must equal the latest immutable promotion record.
    const promotionSeqs = (await this.source.list(storePaths.promotionsDir(ruleId)))
      .map((n) => PROMOTION_FILE.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    const latestSeq = promotionSeqs.at(-1);
    if (latestSeq === undefined) throw new BaselineError('active_mismatch', 'no promotion record backs active.json');
    const promoRaw = await this.readRequired(storePaths.promotion(ruleId, latestSeq));
    const promo = validateSchema('Promotion', promoRaw);
    if (!promo.ok) throw new BaselineError('schema_invalid', 'latest promotion record is invalid', promo.issues);
    const p: Promotion = promo.value;
    if (
      p.sequence !== latestSeq ||
      p.ruleId !== ruleId ||
      active.value.promotionSequence !== latestSeq ||
      active.value.revision !== p.revision ||
      !hashesEqual(active.value.contentHash, p.contentHash)
    ) {
      throw new BaselineError('active_mismatch', 'active.json disagrees with the latest promotion record');
    }

    const verified = await this.readRevision(ruleId, active.value.revision);
    if (!hashesEqual(verified.revision.contentHash, active.value.contentHash)) {
      throw new BaselineError('active_mismatch', 'active.json hash differs from the approved revision');
    }
    if (pin.revision !== undefined && pin.revision !== verified.revision.revision) {
      throw new BaselineError('pin_mismatch', `active revision ${verified.revision.revision} differs from pinned revision ${pin.revision}`);
    }
    if (pin.contentHash !== undefined && !hashesEqual(pin.contentHash, verified.revision.contentHash)) {
      throw new BaselineError('pin_mismatch', 'active content hash differs from the pinned hash');
    }
    return { revision: verified.revision, active: active.value, sourceDescription: this.source.description };
  }
}

export function openFileBaselineReader(storeRoot: string): ApprovedBaselineReader {
  return new ApprovedBaselineStoreReader(new FileBaselineSource(storeRoot));
}
