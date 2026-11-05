/**
 * Run-level outcome rules. Kept pure and separate from execution so they can be
 * tested exhaustively.
 *
 * - pass (exit 0): the complete required matrix ran, every control is ok, and
 *   every assertion passed.
 * - fail (exit 1): at least one demonstrated violation. A mixed failed/blocked
 *   run still exits 1 and reports `incomplete`.
 * - blocked (exit 2): incomplete without a demonstrated violation.
 */
import type { AssertionResult, ControlResult, RunResult } from './types.generated.js';

export type RunSummary = RunResult['summary'];

export const EXIT_CODES = { pass: 0, fail: 1, blocked: 2 } as const;

export function summarize(
  assertions: ReadonlyArray<AssertionResult>,
  controls: ReadonlyArray<ControlResult>,
  requiredAssertionCount: number,
): RunSummary {
  const counts = { passed: 0, failed: 0, blocked: 0, not_assessed: 0 };
  for (const a of assertions) counts[a.status]++;
  const controlsOk = controls.length > 0 && controls.every((c) => c.status === 'ok');
  const allRequiredPresent = requiredAssertionCount > 0 && assertions.length === requiredAssertionCount;
  const everyAssertionExecuted = assertions.every((a) => a.status === 'passed' || a.status === 'failed');
  const completeness = allRequiredPresent && controlsOk && everyAssertionExecuted ? 'complete' : 'incomplete';

  let outcome: RunSummary['outcome'];
  if (counts.failed > 0) outcome = 'fail';
  else if (completeness === 'complete' && counts.passed === requiredAssertionCount) outcome = 'pass';
  else outcome = 'blocked';

  return { outcome, completeness, exitCode: EXIT_CODES[outcome], counts };
}
