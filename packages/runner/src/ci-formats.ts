/**
 * CI-friendly renderings of a RunResult: JUnit XML (consumed by most CI test
 * reporters) and a Markdown summary (for $GITHUB_STEP_SUMMARY or PR comments).
 * Built only from validated, enum-valued fields.
 */
import type { AssertionResult, RunResult } from '@pyx/contracts';
import { explain } from './explain.js';

function xml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const EXPECTED: Record<AssertionResult['expected'], string> = {
  exact_fixture_returned: 'owner reads own record',
  fixture_not_disclosed: 'record not disclosed',
};

export function renderJunit(r: RunResult): string {
  const cls = `pyx.${r.rule.ruleId}`;
  const failedControls = r.controls.filter((c) => c.status !== 'ok');
  const cases: string[] = [];
  for (const c of failedControls) {
    const e = explain(c.diagnostic);
    cases.push(
      `    <testcase classname="${xml(cls)}.controls" name="control ${xml(c.id)}"><error type="${xml(c.diagnostic)}" message="${xml(e.meaning)}">${xml(`Next: ${e.next}`)}</error></testcase>`,
    );
  }
  const multi = r.paths.length > 1;
  for (const a of r.assertions) {
    const name = `${multi ? `[${a.path}] ` : ''}${a.id} (${a.actorRef} -> ${a.fixtureRef}: ${EXPECTED[a.expected]})`;
    const e = explain(a.diagnostic);
    let body = '';
    if (a.status === 'failed') body = `<failure type="${xml(a.diagnostic)}" message="${xml(e.meaning)}">${xml(`Next: ${e.next}`)}</failure>`;
    else if (a.status === 'blocked') body = `<error type="${xml(a.diagnostic)}" message="${xml(e.meaning)}">${xml(`Next: ${e.next}`)}</error>`;
    else if (a.status === 'not_assessed') body = `<skipped message="${xml(e.meaning)}"/>`;
    cases.push(`    <testcase classname="${xml(multi ? `${cls}.${a.path}` : cls)}" name="${xml(name)}">${body}</testcase>`);
  }
  const failures = r.summary.counts.failed;
  const errors = r.summary.counts.blocked + failedControls.length;
  const skipped = r.summary.counts.not_assessed;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="pyx" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">
  <testsuite name="${xml(cls)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" timestamp="${xml(r.observedAt.startedAt.replace(/\.\d+Z$/, ''))}">
    <properties>
      <property name="rule.revision" value="${xml(r.rule.revision ?? '')}"/>
      <property name="rule.contentHash" value="${xml(r.rule.contentHash ?? '')}"/>
      <property name="target.origin" value="${xml(r.target.origin ?? '')}"/>
      <property name="outcome" value="${xml(r.summary.outcome)}"/>
      <property name="completeness" value="${xml(r.summary.completeness)}"/>
    </properties>
${cases.join('\n')}
  </testsuite>
</testsuites>
`;
}

const MD_STATUS: Record<AssertionResult['status'], string> = { passed: '✅ pass', failed: '❌ FAIL', blocked: '⚠️ blocked', not_assessed: '➖ not assessed' };

function md(value: unknown): string {
  return String(value).replace(/[|`*_<>[\]\\]/g, (c) => `\\${c}`);
}

export function renderMarkdownSummary(r: RunResult): string {
  const head = { pass: '✅ Pyx: PASS', fail: '❌ Pyx: FAIL (demonstrated violation)', blocked: '⚠️ Pyx: BLOCKED (no trustworthy assessment)' }[
    r.summary.outcome
  ];
  const lines = [
    `### ${head}`,
    '',
    `Rule \`${md(r.rule.ruleId)}\` revision ${md(r.rule.revision ?? '-')} · \`${md((r.rule.contentHash ?? 'none').slice(0, 19))}…\` · target \`${md(r.target.origin ?? 'unknown')}\` · ${md(r.summary.completeness)}`,
    '',
    '| Status | Path | Assertion | Actor → record | Finding |',
    '| --- | --- | --- | --- | --- |',
    ...r.assertions.map(
      (a) => `| ${MD_STATUS[a.status]} | \`${md(a.path)}\` | \`${md(a.id)}\` | ${md(a.actorRef)} → ${md(a.fixtureRef)} | ${md(explain(a.diagnostic).meaning)} |`,
    ),
  ];
  const bad = r.controls.filter((c) => c.status !== 'ok');
  if (bad.length > 0) {
    lines.push('', '**Controls not established:**', ...bad.map((c) => `- \`${md(c.id)}\`: ${md(explain(c.diagnostic).meaning)} Next: ${md(explain(c.diagnostic).next)}`));
  }
  lines.push('', `<sub>Synthetic fixtures only; not a certification or production evidence. Approval: ${md(r.provenance.approvalLevel ?? 'none')}. Freshness: ${md(r.freshness.state)}.</sub>`, '');
  return lines.join('\n') + '\n';
}
