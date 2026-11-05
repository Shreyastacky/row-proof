// Browser bundle for apps/web/verify.html, built by scripts/build-site.mjs with esbuild.
// It reuses the CLI's own comparison and outcome code, so the page and `pyx compare`
// cannot disagree. No network access: everything runs on files the visitor opens.
import { compareResults, describeCell, renderComparison } from '../../packages/runner/src/compare.ts';
import { summarize } from '../../packages/contracts/src/outcome.ts';

const STATUSES = new Set(['passed', 'failed', 'blocked', 'not_assessed']);

/** Structural checks a browser can do without the full schema validator. */
function check(doc: unknown): string[] {
  const problems: string[] = [];
  const d = doc as Record<string, any>;
  if (!d || typeof d !== 'object') return ['not a JSON object'];
  if (d.kind !== 'RunResult' || d.schemaVersion !== 1) problems.push('not a Pyx v1 result (kind/schemaVersion)');
  if (!Array.isArray(d.assertions)) problems.push('assertions missing');
  if (!Array.isArray(d.controls)) problems.push('controls missing');
  if (!d.summary || typeof d.summary !== 'object') problems.push('summary missing');
  if (!d.rule || typeof d.rule.ruleId !== 'string') problems.push('rule missing');
  for (const a of Array.isArray(d.assertions) ? d.assertions : []) {
    if (!STATUSES.has(a?.status) || typeof a?.actorRef !== 'string' || typeof a?.fixtureRef !== 'string') {
      problems.push('an assertion is malformed');
      break;
    }
  }
  return problems;
}

/** Recompute the outcome from the assertions and controls, and compare it with what the file states. */
function audit(doc: any) {
  const pathCount = Array.isArray(doc.paths) && doc.paths.length > 0 ? doc.paths.length : 1;
  const expectations = new Set(doc.assertions.map((a: any) => a.id)).size;
  const recomputed = summarize(doc.assertions, doc.controls, expectations * pathCount);
  const stated = doc.summary;
  const mismatches: string[] = [];
  for (const k of ['outcome', 'completeness', 'exitCode'] as const) {
    if (stated[k] !== recomputed[k]) mismatches.push(`${k}: file says ${stated[k]}, the checks inside it say ${recomputed[k]}`);
  }
  for (const k of ['passed', 'failed', 'blocked', 'not_assessed'] as const) {
    if (stated.counts?.[k] !== recomputed.counts[k]) mismatches.push(`${k}: file says ${stated.counts?.[k]}, counted ${recomputed.counts[k]}`);
  }
  return { recomputed, mismatches };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

(window as any).PyxVerify = { check, audit, sha256, compareResults, describeCell, renderComparison };
