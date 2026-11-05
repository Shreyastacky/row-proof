import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BaselineError,
  createApprovedRevision,
  createProposal,
  openFileBaselineReader,
  storePaths,
  type ActiveBaseline,
  type ApprovedBaselineReader,
  type ApprovedRevision,
  type Promotion,
} from '../src/index.js';
import { exampleRule } from './helpers.js';

const NOW = new Date('2026-11-05T12:00:00.000Z');
let store: string;

function revisionFor(revision: number, title: string): ApprovedRevision {
  const content = exampleRule();
  content.title = title;
  const proposal = createProposal({
    content,
    basedOn: null,
    proposedBy: { id: 'dev', kind: 'local-user' },
    note: null,
    proposalId: `7b2f0000-0000-4000-8000-00000000000${revision}`,
    now: NOW,
  });
  return createApprovedRevision({
    proposal,
    revision,
    acknowledgedHash: proposal.contentHash,
    approvedBy: { id: 'owner', kind: 'local-user' },
    provenanceLevel: 'local-self-attested',
    supersedes: null,
    approvalId: `7b2f0000-0000-4000-8000-0000000000a${revision}`,
    now: NOW,
  });
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  const full = join(store, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, JSON.stringify(value, null, 2));
}

async function seed(): Promise<ApprovedRevision> {
  const rev = revisionFor(1, 'Each user reads only their own invoice through the Data API');
  await writeJson(storePaths.revision(rev.ruleId, 1), rev);
  const promo: Promotion = {
    kind: 'Promotion',
    schemaVersion: 1,
    ruleId: rev.ruleId,
    sequence: 1,
    revision: 1,
    contentHash: rev.contentHash,
    promotedBy: 'owner',
    promotedAt: '2026-11-05T12:06:00.000Z',
    previous: null,
  };
  await writeJson(storePaths.promotion(rev.ruleId, 1), promo);
  const active: ActiveBaseline = {
    kind: 'ActiveBaseline',
    schemaVersion: 1,
    ruleId: rev.ruleId,
    revision: 1,
    contentHash: rev.contentHash,
    promotionSequence: 1,
  };
  await writeJson(storePaths.active(rev.ruleId), active);
  return rev;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(BaselineError);
  await p.catch((e: BaselineError) => expect(e.code).toBe(code));
}

let reader: ApprovedBaselineReader;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), 'pyx-store-'));
  reader = openFileBaselineReader(store);
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe('read-only approved baseline reader', () => {
  it('exposes no write operations', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(reader)).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['checkRuleId', 'listRevisionNumbers', 'readActive', 'readRequired', 'readRevision']);
  });

  it('reads and verifies the active approved revision', async () => {
    const rev = await seed();
    const got = await reader.readActive(rev.ruleId);
    expect(got.revision.contentHash).toBe(rev.contentHash);
    expect(got.sourceDescription).toMatch(/self-attested/);
  });

  it('rejects revision content edited after approval', async () => {
    const rev = await seed();
    const path = join(store, storePaths.revision(rev.ruleId, 1));
    const doc = JSON.parse(await readFile(path, 'utf8')) as ApprovedRevision;
    doc.content.expectations[2]!.expected = 'exact_fixture_returned';
    await writeFile(path, JSON.stringify(doc));
    await expectCode(reader.readActive(rev.ruleId), 'integrity_failed');
  });

  it('rejects an active pointer that disagrees with the latest promotion record', async () => {
    const rev = await seed();
    const other = revisionFor(2, 'A second approved revision');
    await writeJson(storePaths.revision(rev.ruleId, 2), other);
    // Point active at revision 2 without a promotion record.
    await writeJson(storePaths.active(rev.ruleId), {
      kind: 'ActiveBaseline',
      schemaVersion: 1,
      ruleId: rev.ruleId,
      revision: 2,
      contentHash: other.contentHash,
      promotionSequence: 1,
    });
    await expectCode(reader.readActive(rev.ruleId), 'active_mismatch');
  });

  it('rejects a revision file stored under the wrong revision number', async () => {
    const rev = await seed();
    await writeJson(storePaths.revision(rev.ruleId, 3), rev);
    await expectCode(reader.readRevision(rev.ruleId, 3), 'integrity_failed');
  });

  it('enforces pins on revision and hash', async () => {
    const rev = await seed();
    await expectCode(reader.readActive(rev.ruleId, { revision: 2 }), 'pin_mismatch');
    await expectCode(reader.readActive(rev.ruleId, { contentHash: `sha256:${'0'.repeat(64)}` }), 'pin_mismatch');
    await expect(reader.readActive(rev.ruleId, { revision: 1, contentHash: rev.contentHash })).resolves.toBeTruthy();
  });

  it('refuses symlinks, oversized files, malformed JSON, missing files and bad rule ids', async () => {
    const rev = await seed();
    const outside = join(store, 'outside.json');
    await writeFile(outside, JSON.stringify(rev));
    const revPath = join(store, storePaths.revision(rev.ruleId, 1));
    await rm(revPath);
    await symlink(outside, revPath);
    await expectCode(reader.readRevision(rev.ruleId, 1), 'symlink_rejected');
    await rm(revPath);
    await writeFile(revPath, ' '.repeat(300 * 1024));
    await expectCode(reader.readRevision(rev.ruleId, 1), 'too_large');
    await writeFile(revPath, '{"kind":"ApprovedRevision","kind":"ApprovedRevision"}');
    await expectCode(reader.readRevision(rev.ruleId, 1), 'malformed_json');
    await expectCode(reader.readRevision(rev.ruleId, 9), 'not_found');
    await expectCode(reader.readActive('../etc'), 'invalid_rule_id');
  });
});
