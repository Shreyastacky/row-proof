/**
 * Approval workflow commands: validate, hash, propose, diff, approve, promote,
 * history. These are separate from `run`, which can only read the store.
 */
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ApprovalError,
  BaselineError,
  createProposal,
  openFileBaselineReader,
  parseStrictJson,
  ruleContentHash,
  StrictJsonError,
  validateRuleContent,
  verifyProposal,
  type Issue,
  type RuleContent,
  type RuleProposal,
} from '@pyx/contracts';
import { diffIntent, renderDiff } from '../approval/diff.js';
import { LocalApprovalStoreWriter } from '../approval/writer.js';
import { readTextFile, requireString, UsageError, type CliIO } from '../io.js';

const SELF_ATTESTED_NOTE =
  'NOTE: this local approval is self-attested. It separates approving intent from editing code, but anyone who can write the store can bypass it. Use a separately protected ref or control plane for independent approval.\n';

function renderIssues(issues: Issue[]): string {
  return issues.map((i) => `  ${i.severity === 'error' ? 'ERROR' : 'UNSUPPORTED'} ${i.code} at ${i.path}: ${i.message}`).join('\n') + '\n';
}

async function readJson(path: string): Promise<unknown> {
  const text = await readTextFile(path);
  try {
    return parseStrictJson(text);
  } catch (e) {
    if (e instanceof StrictJsonError) throw new UsageError(`${path}: ${e.message}`);
    throw e;
  }
}

function storeFrom(v: string | undefined, io: CliIO): string {
  const s = v ?? io.env.PYX_APPROVAL_STORE;
  if (!s) throw new UsageError('missing --store (or PYX_APPROVAL_STORE)');
  return resolve(io.cwd, s);
}

async function loadContent(path: string, io: CliIO): Promise<RuleContent | null> {
  const v = validateRuleContent(await readJson(path));
  if (!v.ok) {
    io.stderr(`rule content is invalid:\n${renderIssues(v.issues)}`);
    return null;
  }
  if (v.issues.length > 0) io.stderr(`rule content is outside supported v1 scope:\n${renderIssues(v.issues)}`);
  return v.value;
}

async function loadProposal(path: string, io: CliIO): Promise<RuleProposal | null> {
  const v = verifyProposal(await readJson(path));
  if (!v.ok) {
    io.stderr(`proposal is invalid:\n${renderIssues(v.issues)}`);
    return null;
  }
  return v.value;
}

export async function validateCommand(argv: string[], io: CliIO): Promise<number> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} });
  const file = positionals[0];
  if (!file) throw new UsageError('usage: pyx validate <rule-or-proposal.json>');
  const raw = await readJson(resolve(io.cwd, file));
  const kind = raw !== null && typeof raw === 'object' ? (raw as { kind?: unknown }).kind : undefined;
  const result = kind === 'RuleProposal' ? verifyProposal(raw) : validateRuleContent(raw);
  if (!result.ok) {
    io.stderr(`invalid:\n${renderIssues(result.issues)}`);
    return 2;
  }
  if (result.issues.length > 0) {
    io.stdout(`well-formed but outside supported v1 scope:\n${renderIssues(result.issues)}`);
    return 2;
  }
  const hash = kind === 'RuleProposal' ? (result.value as RuleProposal).contentHash : ruleContentHash(result.value as RuleContent);
  io.stdout(`valid ${kind === 'RuleProposal' ? 'proposal' : 'rule content'}; content hash ${hash}\n`);
  return 0;
}

export async function hashCommand(argv: string[], io: CliIO): Promise<number> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {} });
  if (!positionals[0]) throw new UsageError('usage: pyx hash <rule.json>');
  const content = await loadContent(resolve(io.cwd, positionals[0]), io);
  if (!content) return 2;
  io.stdout(`${ruleContentHash(content)}\n`);
  return 0;
}

export async function proposeCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      rule: { type: 'string' },
      store: { type: 'string' },
      out: { type: 'string' },
      'proposed-by': { type: 'string' },
      'proposer-kind': { type: 'string' },
      note: { type: 'string' },
    },
  });
  const content = await loadContent(resolve(io.cwd, requireString(values.rule, 'rule')), io);
  if (!content) return 2;
  const kind = values['proposer-kind'] ?? 'local-user';
  if (!['local-user', 'ai-assistant', 'ci'].includes(kind)) throw new UsageError('--proposer-kind must be local-user, ai-assistant or ci');
  const writer = new LocalApprovalStoreWriter(storeFrom(values.store, io));
  const basedOn = await writer.currentActive(content.ruleId);
  const proposal = createProposal({
    content,
    basedOn,
    proposedBy: { id: requireString(values['proposed-by'], 'proposed-by'), kind: kind as RuleProposal['proposedBy']['kind'] },
    note: values.note ?? null,
    proposalId: randomUUID(),
    now: new Date(),
  });
  const v = verifyProposal(proposal);
  if (!v.ok) {
    io.stderr(`proposal is invalid:\n${renderIssues(v.issues)}`);
    return 2;
  }
  const out = resolve(io.cwd, requireString(values.out, 'out'));
  const fh = await open(out, 'wx', 0o644);
  try {
    await fh.writeFile(JSON.stringify(proposal, null, 2) + '\n');
  } finally {
    await fh.close();
  }
  io.stdout(
    `proposal written to ${out}\n  rule ${proposal.ruleId}, based on ${basedOn ? `revision ${basedOn.revision}` : 'no approved revision'}\n  content hash ${proposal.contentHash}\nA proposal has no authority. Review it with \`pyx diff\` and approve it explicitly.\n`,
  );
  return 0;
}

export async function diffCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { proposal: { type: 'string' }, store: { type: 'string' } } });
  const proposal = await loadProposal(resolve(io.cwd, requireString(values.proposal, 'proposal')), io);
  if (!proposal) return 2;
  const reader = openFileBaselineReader(storeFrom(values.store, io));
  let before: RuleContent | null = null;
  let label = 'no approved revision';
  try {
    const active = await reader.readActive(proposal.ruleId);
    before = active.revision.content;
    label = `approved revision ${active.revision.revision}`;
  } catch (e) {
    if (!(e instanceof BaselineError && e.code === 'not_found')) throw e;
  }
  io.stdout(renderDiff(diffIntent(before, proposal.content), label, 'this proposal'));
  io.stdout(
    `\nTo approve EXACTLY this content, the designated owner runs:\n  pyx approve --proposal <file> --store <dir> --approver <id> --acknowledge ${proposal.contentHash} --promote\n`,
  );
  return 0;
}

export async function approveCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      proposal: { type: 'string' },
      store: { type: 'string' },
      approver: { type: 'string' },
      acknowledge: { type: 'string' },
      promote: { type: 'boolean' },
    },
  });
  const proposal = await loadProposal(resolve(io.cwd, requireString(values.proposal, 'proposal')), io);
  if (!proposal) return 2;
  const ack = requireString(values.acknowledge, 'acknowledge');
  if (!/^sha256:[0-9a-f]{64}$/.test(ack)) throw new UsageError('--acknowledge must be the full sha256:<64 hex> content hash shown by diff');
  const writer = new LocalApprovalStoreWriter(storeFrom(values.store, io));
  try {
    const { revision, promoted } = await writer.approve({
      proposal,
      acknowledgedHash: ack,
      approverId: requireString(values.approver, 'approver'),
      promote: values.promote === true,
    });
    io.stdout(
      `approved ${revision.ruleId} revision ${revision.revision} (${revision.contentHash})${promoted ? ' and promoted it to the active baseline' : '; not yet active (run `pyx promote`)'}\n${SELF_ATTESTED_NOTE}`,
    );
    return 0;
  } catch (e) {
    if (e instanceof ApprovalError) {
      io.stderr(`approval refused (${e.code}): ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export async function promoteCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: { store: { type: 'string' }, rule: { type: 'string' }, revision: { type: 'string' }, acknowledge: { type: 'string' }, by: { type: 'string' } },
  });
  const rev = Number(requireString(values.revision, 'revision'));
  if (!Number.isInteger(rev) || rev < 1) throw new UsageError('--revision must be a positive integer');
  const writer = new LocalApprovalStoreWriter(storeFrom(values.store, io));
  try {
    const p = await writer.promote(requireString(values.rule, 'rule'), rev, requireString(values.acknowledge, 'acknowledge'), requireString(values.by, 'by'));
    io.stdout(`promoted ${p.ruleId} revision ${p.revision} as active baseline (promotion ${p.sequence})\n${SELF_ATTESTED_NOTE}`);
    return 0;
  } catch (e) {
    if (e instanceof ApprovalError || e instanceof BaselineError) {
      io.stderr(`promotion refused (${e.code}): ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export async function historyCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { store: { type: 'string' }, rule: { type: 'string' } } });
  const ruleId = requireString(values.rule, 'rule');
  const reader = openFileBaselineReader(storeFrom(values.store, io));
  let activeRev: number | null = null;
  try {
    activeRev = (await reader.readActive(ruleId)).revision.revision;
  } catch (e) {
    if (!(e instanceof BaselineError)) throw e;
    io.stderr(`active baseline: ${e.code}\n`);
  }
  for (const n of await reader.listRevisionNumbers(ruleId)) {
    try {
      const r = (await reader.readRevision(ruleId, n)).revision;
      io.stdout(
        `${n === activeRev ? '*' : ' '} r${n} ${r.contentHash} approved by ${r.approval.approvedBy.id} at ${r.approval.approvedAt} (${r.approval.provenance.level})\n`,
      );
    } catch (e) {
      if (!(e instanceof BaselineError)) throw e;
      io.stdout(`! r${n} FAILED VERIFICATION: ${e.code}\n`);
    }
  }
  return 0;
}
