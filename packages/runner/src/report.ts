/**
 * Output. The result object is built only from allowlisted fields and enums in
 * engine.ts. Before anything is written or printed we (1) validate it against
 * the RunResult schema and (2) prove that no loaded credential value, and no
 * credential-shaped string, appears in the serialized output. If either check
 * fails, nothing is written and the run is reported as blocked.
 */
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { findCredentialValues, validateSchema, type AssertionResult, type RunResult } from '@rowproof/contracts';

export class OutputSafetyError extends Error {
  constructor(readonly code: 'result_schema_invalid' | 'output_leak_prevented') {
    super(code === 'result_schema_invalid' ? 'result failed schema validation; nothing written' : 'credential material detected in output; nothing written');
    this.name = 'OutputSafetyError';
  }
}

export function assertOutputSafe(text: string, sensitiveValues: ReadonlyArray<string>): void {
  for (const v of sensitiveValues) {
    if (v.length >= 8 && text.includes(v)) throw new OutputSafetyError('output_leak_prevented');
  }
  if (findCredentialValues(text).length > 0) throw new OutputSafetyError('output_leak_prevented');
}

export function serializeResult(result: RunResult, sensitiveValues: ReadonlyArray<string>): string {
  const v = validateSchema('RunResult', result);
  if (!v.ok) throw new OutputSafetyError('result_schema_invalid');
  const text = JSON.stringify(result, null, 2) + '\n';
  assertOutputSafe(text, sensitiveValues);
  return text;
}

export async function writeResultFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const fh = await open(path, 'wx', 0o600);
  try {
    await fh.writeFile(text, 'utf8');
  } finally {
    await fh.close();
  }
}

const STATUS_LABEL: Record<AssertionResult['status'], string> = {
  passed: 'PASS   ',
  failed: 'FAIL   ',
  blocked: 'BLOCKED',
  not_assessed: 'N/A    ',
};

const EXPECTED_LABEL: Record<AssertionResult['expected'], string> = {
  exact_fixture_returned: 'owner receives exact fixture',
  fixture_not_disclosed: 'fixture not disclosed',
};

export function renderSummary(result: RunResult, resultPath: string | null): string {
  const lines: string[] = [];
  const hash = result.rule.contentHash ? `${result.rule.contentHash.slice(0, 19)}…` : 'none';
  lines.push('RowProof read-isolation check');
  lines.push(
    `  rule ${result.rule.ruleId} revision ${result.rule.revision ?? '-'} (${hash}); approval: ${result.provenance.approvalLevel ?? 'none'}`,
  );
  lines.push(`  target ${result.target.origin ?? 'unknown'} (${result.target.environmentClass ?? 'unknown'}) via ${result.target.transport}`);
  lines.push(`  observed ${result.observedAt.startedAt} -> ${result.observedAt.finishedAt}`);
  lines.push('');
  const failedControls = result.controls.filter((c) => c.status !== 'ok');
  if (failedControls.length > 0) {
    lines.push('  Controls not established:');
    for (const c of failedControls) lines.push(`    ${c.status.toUpperCase().padEnd(7)} ${c.id}: ${c.diagnostic}`);
    lines.push('');
  }
  if (result.assertions.length > 0) {
    lines.push('  Assertions:');
    for (const a of result.assertions) {
      const http = a.httpStatus === null ? '' : ` (HTTP ${a.httpStatus})`;
      const detail = a.status === 'passed' ? '' : `  -> ${a.diagnostic}${http}`;
      lines.push(`    ${STATUS_LABEL[a.status]} ${a.id.padEnd(14)} ${a.actorRef} -> ${a.fixtureRef}: ${EXPECTED_LABEL[a.expected]}${detail}`);
    }
    lines.push('');
  }
  const { counts, outcome, completeness, exitCode } = result.summary;
  const verdict = outcome === 'pass' ? 'PASS' : outcome === 'fail' ? 'FAIL (demonstrated violation)' : 'BLOCKED (no trustworthy assessment)';
  lines.push(
    `  Outcome: ${verdict}; ${completeness}; passed ${counts.passed}, failed ${counts.failed}, blocked ${counts.blocked}, not assessed ${counts.not_assessed}; exit ${exitCode}`,
  );
  lines.push(`  Freshness: ${result.freshness.state} (${result.freshness.reason})`);
  lines.push(
    '  Scope: only the listed synthetic assertions, on this target, at this time. Not a security certification, not production evidence, not coverage of other access paths.',
  );
  if (result.provenance.approvalLevel === 'local-self-attested') {
    lines.push('  Approval is local and self-attested: anyone who can write the approval store can change it.');
  }
  if (resultPath) lines.push(`  Result: ${resultPath}`);
  return lines.join('\n') + '\n';
}
