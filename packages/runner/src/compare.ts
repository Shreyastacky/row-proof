/**
 * Release review: who gained or lost access between two runs of the same
 * approved rule. Built only from validated RunResult fields.
 *
 * Each cell is (request path, actor, record). Its access state is read from the
 * assertion: a disclosure or a passing owner read means "can read"; a passing
 * denial or a failing owner read means "cannot read"; anything blocked or not
 * assessed is "unknown". A change from one release to the next is then:
 *
 *   gained_access    a forbidden read that now succeeds (regression)
 *   lost_access      an owner read that now fails (regression)
 *   access_removed   a forbidden read that used to succeed and no longer does (fixed)
 *   access_restored  an owner read that works again (fixed)
 *   still_violating  a violation present in both runs
 *   now_unverified   known before, blocked or not assessed now
 *   now_verified     unknown before, known and correct now
 *   unchanged        same, correct state in both
 *   added / removed  the cell exists in only one run (a request path was added or dropped)
 */
import type { AssertionResult, RunResult } from '@pyx/contracts';

export type CellChangeKind =
  | 'gained_access'
  | 'lost_access'
  | 'access_removed'
  | 'access_restored'
  | 'still_violating'
  | 'now_unverified'
  | 'now_verified'
  | 'unchanged'
  | 'added'
  | 'removed';

export interface CellChange {
  path: string;
  actorRef: string;
  fixtureRef: string;
  expected: AssertionResult['expected'];
  before: AssertionResult['status'] | null;
  after: AssertionResult['status'] | null;
  change: CellChangeKind;
}

export interface Comparison {
  kind: 'PyxAccessComparison';
  ruleId: string;
  sameRevision: boolean;
  before: RunSide;
  after: RunSide;
  changes: CellChange[];
  counts: Record<CellChangeKind, number>;
  regressions: number;
  exitCode: 0 | 1 | 2;
}

interface RunSide {
  label: string;
  runId: string;
  revision: number | null;
  contentHash: string | null;
  commit: string | null;
  observedAt: string;
  outcome: RunResult['summary']['outcome'];
}

export class CompareError extends Error {}

/** true = can read, false = cannot read, null = not established. */
export function accessOf(a: AssertionResult): boolean | null {
  if (a.expected === 'fixture_not_disclosed') {
    if (a.status === 'failed' && a.diagnostic === 'fixture_disclosed') return true;
    if (a.status === 'passed') return false;
    return null;
  }
  if (a.status === 'passed') return true;
  if (a.status === 'failed') return false;
  return null;
}

/** Whether this access state is the one the approved rule forbids. */
function violates(expected: AssertionResult['expected'], access: boolean): boolean {
  return expected === 'fixture_not_disclosed' ? access : !access;
}

function classify(expected: AssertionResult['expected'], before: boolean | null, after: boolean | null): CellChangeKind {
  if (after === null) return 'now_unverified';
  if (violates(expected, after)) {
    if (before !== null && violates(expected, before)) return 'still_violating';
    return expected === 'fixture_not_disclosed' ? 'gained_access' : 'lost_access';
  }
  if (before === null) return 'now_verified';
  if (violates(expected, before)) return expected === 'fixture_not_disclosed' ? 'access_removed' : 'access_restored';
  return 'unchanged';
}

const KINDS: CellChangeKind[] = [
  'gained_access',
  'lost_access',
  'still_violating',
  'access_removed',
  'access_restored',
  'now_unverified',
  'now_verified',
  'added',
  'removed',
  'unchanged',
];

function side(r: RunResult, label: string): RunSide {
  return {
    label,
    runId: r.runId,
    revision: r.rule.revision,
    contentHash: r.rule.contentHash,
    commit: r.source.commit,
    observedAt: r.observedAt.startedAt,
    outcome: r.summary.outcome,
  };
}

export function compareResults(before: RunResult, after: RunResult, labels: { before: string; after: string }): Comparison {
  if (before.rule.ruleId !== after.rule.ruleId) {
    throw new CompareError(`the results are for different rules (${before.rule.ruleId} vs ${after.rule.ruleId})`);
  }
  const key = (a: AssertionResult) => `${a.path}\u0000${a.actorRef}\u0000${a.fixtureRef}`;
  const b = new Map(before.assertions.map((a) => [key(a), a] as const));
  const a = new Map(after.assertions.map((x) => [key(x), x] as const));
  const changes: CellChange[] = [];
  for (const [k, x] of a) {
    const y = b.get(k);
    const base = { path: x.path, actorRef: x.actorRef, fixtureRef: x.fixtureRef, expected: x.expected, before: y?.status ?? null, after: x.status };
    if (!y) {
      const acc = accessOf(x);
      changes.push({ ...base, change: acc === null ? 'now_unverified' : violates(x.expected, acc) ? (x.expected === 'fixture_not_disclosed' ? 'gained_access' : 'lost_access') : 'added' });
    } else if (y.expected !== x.expected) {
      // The approved intent for this cell changed between the runs: report it, never hide it.
      changes.push({ ...base, change: 'now_unverified' });
    } else {
      changes.push({ ...base, change: classify(x.expected, accessOf(y), accessOf(x)) });
    }
  }
  for (const [k, y] of b) {
    if (!a.has(k)) changes.push({ path: y.path, actorRef: y.actorRef, fixtureRef: y.fixtureRef, expected: y.expected, before: y.status, after: null, change: 'removed' });
  }
  changes.sort((p, q) => KINDS.indexOf(p.change) - KINDS.indexOf(q.change));
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<CellChangeKind, number>;
  for (const c of changes) counts[c.change]++;
  const regressions = counts.gained_access + counts.lost_access;
  const violations = regressions + counts.still_violating;
  const unknown = counts.now_unverified + counts.removed;
  return {
    kind: 'PyxAccessComparison',
    ruleId: after.rule.ruleId,
    sameRevision: before.rule.contentHash !== null && before.rule.contentHash === after.rule.contentHash,
    before: side(before, labels.before),
    after: side(after, labels.after),
    changes,
    counts,
    regressions,
    exitCode: violations > 0 ? 1 : unknown > 0 || after.summary.outcome !== 'pass' ? 2 : 0,
  };
}

const VERB: Record<CellChangeKind, string> = {
  gained_access: 'GAINED ACCESS',
  lost_access: 'LOST ACCESS',
  still_violating: 'STILL EXPOSED',
  access_removed: 'fixed',
  access_restored: 'restored',
  now_unverified: 'unverified',
  now_verified: 'verified',
  added: 'new check',
  removed: 'dropped',
  unchanged: 'unchanged',
};

export function describeCell(c: CellChange): string {
  const who = c.actorRef;
  const what = c.fixtureRef;
  switch (c.change) {
    case 'gained_access':
      return `${who} can now read ${what}`;
    case 'lost_access':
      return `${who} can no longer read their own ${what}`;
    case 'still_violating':
      return c.expected === 'fixture_not_disclosed' ? `${who} can still read ${what}` : `${who} still cannot read their own ${what}`;
    case 'access_removed':
      return `${who} can no longer read ${what}`;
    case 'access_restored':
      return `${who} can read their own ${what} again`;
    case 'now_unverified':
      return `${who} reading ${what} could not be checked this time (${c.after ?? 'absent'})`;
    case 'now_verified':
      return `${who} reading ${what} is now checked and correct`;
    case 'added':
      return `${who} reading ${what} is checked for the first time`;
    case 'removed':
      return `${who} reading ${what} was not checked this time`;
    case 'unchanged':
      return `${who} reading ${what} is unchanged`;
  }
}

function sideLine(s: RunSide): string {
  const commit = s.commit ? ` ${s.commit.slice(0, 10)}` : '';
  return `${s.label}${commit} · r${s.revision ?? '-'} · ${s.observedAt.slice(0, 16).replace('T', ' ')} UTC · ${s.outcome}`;
}

export function renderComparison(c: Comparison): string {
  const lines = [`Pyx access review: ${c.ruleId}`, `  before  ${sideLine(c.before)}`, `  after   ${sideLine(c.after)}`];
  if (!c.sameRevision) lines.push('  note    the approved rule changed between these runs; review the rule diff too (`pyx diff`)');
  lines.push('');
  const shown = c.changes.filter((x) => x.change !== 'unchanged');
  if (shown.length === 0) lines.push('  No access changes. Every checked cell is the same as before.');
  for (const x of shown) lines.push(`  ${VERB[x.change].padEnd(14)} ${describeCell(x)}  [${x.path}]`);
  lines.push('');
  lines.push(
    `  ${c.regressions} regression${c.regressions === 1 ? '' : 's'}, ${c.counts.still_violating} still exposed, ${c.counts.access_removed + c.counts.access_restored} fixed, ${c.counts.now_unverified + c.counts.removed} unverified, ${c.counts.unchanged} unchanged; exit ${c.exitCode}`,
  );
  return lines.join('\n') + '\n';
}

function md(value: unknown): string {
  return String(value).replace(/[|`*_<>[\]\\]/g, (ch) => `\\${ch}`);
}

export function renderComparisonMarkdown(c: Comparison): string {
  const head = c.regressions > 0 ? '❌ Access changed' : c.counts.still_violating > 0 ? '❌ Still exposed' : c.exitCode === 0 ? '✅ No access changes' : '⚠️ Not fully verified';
  const lines = [`### ${head}: \`${md(c.ruleId)}\``, '', `${md(sideLine(c.before))} → ${md(sideLine(c.after))}`, ''];
  const shown = c.changes.filter((x) => x.change !== 'unchanged');
  if (shown.length > 0) {
    lines.push('| Change | Who | Path |', '| --- | --- | --- |');
    for (const x of shown) lines.push(`| ${md(VERB[x.change])} | ${md(describeCell(x))} | \`${md(x.path)}\` |`);
    lines.push('');
  }
  lines.push(`<sub>${c.counts.unchanged} cells unchanged. Synthetic fixtures only; not a certification.</sub>`, '');
  return lines.join('\n') + '\n';
}
