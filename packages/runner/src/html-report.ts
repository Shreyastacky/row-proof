/**
 * Self-contained HTML evidence report: no JavaScript, no external requests,
 * built only from validated RunResult fields (enums, ids, hashes, timestamps),
 * all HTML-escaped. Suitable to hand to a client or save as PDF.
 */
import type { AssertionResult, RunResult } from '@pyx/contracts';
import { LOGO_SVG, THEME_CSS } from './design/theme.js';
import { compareResults, describeCell, type CellChangeKind } from './compare.js';
import { explain } from './explain.js';
import type { RequestRecord } from './engine.js';
import { RUNNER_VERSION } from './io.js';

export interface ReportOptions {
  /** Shown as "Prepared for". */
  client?: string;
  /** Shown as "Prepared by" (agency white-label). */
  preparedBy?: string;
  title?: string;
  /** Request ledger of the latest run; shown as an appendix. */
  requests?: ReadonlyArray<RequestRecord>;
}

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const STATUS_CLASS: Record<AssertionResult['status'], string> = { passed: 'rp-pass', failed: 'rp-fail', blocked: 'rp-blocked', not_assessed: 'rp-na' };
const STATUS_LABEL: Record<AssertionResult['status'], string> = { passed: 'Pass', failed: 'Fail', blocked: 'Blocked', not_assessed: 'Not assessed' };
const EXPECTED: Record<AssertionResult['expected'], string> = {
  exact_fixture_returned: 'Must read own record',
  fixture_not_disclosed: 'Must not see record',
};
const OUTCOME = {
  pass: { cls: 'rp-pass', word: 'Pass', line: 'Every approved expectation held, with all controls established.' },
  fail: { cls: 'rp-fail', word: 'Fail', line: 'At least one approved expectation was demonstrably violated.' },
  blocked: { cls: 'rp-blocked', word: 'Blocked', line: 'No trustworthy assessment: a control or check could not be established. This is not a pass.' },
} as const;

const ICON = {
  pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  blocked: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 6v7M12 17.5v.5"/></svg>',
};

function fmtTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function pill(status: AssertionResult['status']): string {
  return `<span class="rp-pill ${STATUS_CLASS[status]}">${STATUS_LABEL[status]}</span>`;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function matrices(r: RunResult): string {
  if (r.assertions.length === 0) return '<p class="rp-muted">No assertions were executed.</p>';
  if (r.paths.length <= 1) return matrix(r, r.assertions);
  // Paths with a demonstrated violation first: that is what the reader needs to see.
  const failing = (id: string) => r.assertions.some((a) => a.path === id && a.status === 'failed');
  return [...r.paths]
    .sort((a, b) => Number(failing(b.id)) - Number(failing(a.id)))
    .map((p) => {
      const these = r.assertions.filter((a) => a.path === p.id);
      const bad = these.filter((a) => a.status === 'failed').length;
      return `<div class="rp-path"><div class="rp-spread" style="margin:22px 0 10px"><div><span class="rp-mono">${esc(p.id)}</span> <span class="rp-faint" style="font-size:12.5px">${esc(p.kind)} · ${esc(p.route)}</span></div>${
        bad > 0 ? `<span class="rp-pill rp-fail">${bad} disclosed</span>` : ''
      }</div>${matrix(r, these)}</div>`;
    })
    .join('');
}

function matrix(r: RunResult, assertions: AssertionResult[]): string {
  const actors = unique(assertions.map((a) => a.actorRef));
  const fixtures = unique(assertions.map((a) => a.fixtureRef));
  if (actors.length === 0) return '<p class="rp-muted">No assertions were executed on this path.</p>';
  const cell = (actor: string, fixture: string) => {
    const a = assertions.find((x) => x.actorRef === actor && x.fixtureRef === fixture);
    if (!a) return '<div class="rp-cell"><span class="rp-faint">n/a</span></div>';
    const variant = a.status === 'passed' ? 'pass' : a.status === 'failed' ? 'fail' : a.status === 'blocked' ? 'blocked' : '';
    return `<div class="rp-cell ${variant ? `rp-cell--${variant}` : ''}"><div class="rp-cell__exp">${EXPECTED[a.expected]}</div><div>${pill(a.status)}</div></div>`;
  };
  const cols = `minmax(110px, 0.8fr) repeat(${fixtures.length}, minmax(130px, 1fr))`;
  let html = `<div class="rp-table-wrap"><div class="rp-matrix" style="grid-template-columns:${cols}"><div></div>`;
  html += fixtures.map((f) => `<div class="rp-matrix__head">${esc(f)}</div>`).join('');
  for (const actor of actors) {
    html += `<div class="rp-actor">${esc(actor)}<small>${actor === 'anonymous' ? 'no session' : 'signed-in user'}</small></div>`;
    html += fixtures.map((f) => cell(actor, f)).join('');
  }
  return html + '</div></div>';
}

function assertionRows(r: RunResult): string {
  return r.assertions
    .map((a) => {
      const e = explain(a.diagnostic);
      return `<tr><td>${pill(a.status)}</td><td><div class="rp-mono">${esc(a.id)}</div><div class="rp-faint" style="font-size:12.5px">${r.paths.length > 1 ? `${esc(a.path)} · ` : ''}${esc(a.actorRef)} &rarr; ${esc(a.fixtureRef)}</div></td><td>${EXPECTED[a.expected]}</td><td><div>${esc(e.meaning)}</div>${
        a.status === 'passed' ? '' : `<div class="rp-faint" style="font-size:12.5px;margin-top:4px">Next: ${esc(e.next)}</div>`
      }<div class="rp-faint rp-mono" style="font-size:11.5px;margin-top:6px">${esc(a.diagnostic)}${a.httpStatus === null ? '' : ` · HTTP ${a.httpStatus}`}</div></td></tr>`;
    })
    .join('');
}

function controlRows(r: RunResult): string {
  return r.controls
    .map((c) => {
      const cls = c.status === 'ok' ? 'rp-pass' : c.status === 'failed' ? 'rp-fail' : 'rp-na';
      const label = c.status === 'ok' ? 'Established' : c.status === 'failed' ? 'Failed' : 'Not run';
      const e = explain(c.diagnostic);
      return `<tr><td><span class="rp-pill ${cls}">${label}</span></td><td class="rp-mono">${esc(c.id)}</td><td>${c.status === 'ok' ? '<span class="rp-faint">OK</span>' : `${esc(e.meaning)}<div class="rp-faint" style="font-size:12.5px;margin-top:4px">Next: ${esc(e.next)}</div>`}</td></tr>`;
    })
    .join('');
}

const CHANGE_LABEL: Record<CellChangeKind, [string, string]> = {
  gained_access: ['Gained access', 'rp-fail'],
  lost_access: ['Lost access', 'rp-fail'],
  still_violating: ['Still exposed', 'rp-fail'],
  access_removed: ['Fixed', 'rp-pass'],
  access_restored: ['Restored', 'rp-pass'],
  now_unverified: ['Unverified', 'rp-blocked'],
  now_verified: ['Verified', 'rp-pass'],
  added: ['New check', 'rp-na'],
  removed: ['Dropped', 'rp-blocked'],
  unchanged: ['Unchanged', 'rp-na'],
};

/** The release review: who gained or lost access since the previous run of the same rule. */
function accessReview(results: RunResult[]): string {
  const r = results.at(-1)!;
  const prev = results.slice(0, -1).reverse().find((x) => x.rule.ruleId === r.rule.ruleId);
  if (!prev) return '';
  const c = compareResults(prev, r, { before: 'previous', after: 'latest' });
  const shown = c.changes.filter((x) => x.change !== 'unchanged');
  const head =
    c.regressions > 0
      ? `${c.regressions} access change${c.regressions === 1 ? '' : 's'} since the previous run`
      : c.counts.still_violating > 0
        ? 'Still exposed since the previous run'
        : shown.length === 0
          ? 'No access changes since the previous run'
          : 'Changes since the previous run';
  const rows = shown
    .map((x) => {
      const [word, cls] = CHANGE_LABEL[x.change];
      return `<tr><td><span class="rp-pill ${cls}">${word}</span></td><td>${esc(describeCell(x))}</td><td class="rp-mono">${esc(x.path)}</td></tr>`;
    })
    .join('');
  const since = `${esc(fmtTime(prev.observedAt.startedAt))}${prev.source.commit ? ` · ${esc(prev.source.commit.slice(0, 10))}` : ''}`;
  return `<section class="rp-glass rp-glass--strong rp-pad" style="margin-top:18px">
  <div class="rp-spread"><div><div class="rp-eyebrow">Access review</div><h2 class="rp-h3" style="margin-top:6px">${esc(head)}</h2></div><span class="rp-faint" style="font-size:13px">Compared with ${since} · ${c.counts.unchanged} checks unchanged</span></div>
  ${rows ? `<div class="rp-table-wrap" style="margin-top:16px"><table class="rp-table"><thead><tr><th>Change</th><th>Who</th><th>Request path</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
</section>`;
}

const PURPOSE: Record<RequestRecord['purpose'], string> = {
  'fixture-check': 'verify test records',
  identity: 'verify user',
  'anonymous-context': 'verify anonymous',
  read: 'read',
  'fixture-recheck': 're-check test records',
};

function requestLedger(requests: ReadonlyArray<RequestRecord> | undefined): string {
  if (!requests || requests.length === 0) return '';
  const rows = requests
    .map((q) => {
      const status = q.failure ? `<span class="rp-blocked">${esc(q.failure)}</span>` : esc(q.status ?? '');
      return `<tr><td class="rp-mono">${q.n}</td><td>${esc(PURPOSE[q.purpose])}${q.path ? ` <span class="rp-faint">· ${esc(q.path)}</span>` : ''}</td><td class="rp-mono">${esc(q.as)}</td><td class="rp-mono" style="word-break:break-all">GET ${esc(q.url)}</td><td class="rp-mono">${status}</td><td class="rp-mono">${q.bytes} B · ${q.ms} ms</td></tr>`;
    })
    .join('');
  return `<section class="rp-glass rp-pad" style="margin-top:18px"><div class="rp-eyebrow">Request ledger</div><h2 class="rp-h3" style="margin:6px 0 6px">Every request Pyx sent: ${requests.length}</h2><p class="rp-muted" style="margin:0 0 16px">All read-only GETs to the approved origins. “As” names the identity used; no credential is recorded. Nothing else left the machine.</p><div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>#</th><th>Purpose</th><th>As</th><th>Request</th><th>Status</th><th>Size · time</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function history(results: RunResult[]): string {
  if (results.length < 2) return '';
  const rows = results
    .map((r) => {
      const o = OUTCOME[r.summary.outcome];
      return `<tr><td class="rp-mono">${esc(fmtTime(r.observedAt.startedAt))}</td><td><span class="rp-pill ${o.cls}">${o.word}</span></td><td class="rp-mono">r${esc(r.rule.revision ?? '-')} · ${esc((r.rule.contentHash ?? 'none').slice(0, 19))}</td><td class="rp-mono">${esc(r.source.commit ? r.source.commit.slice(0, 10) : '—')}${r.source.dirty ? ' (modified)' : ''}</td><td>${r.summary.counts.passed}/${r.assertions.length} passed</td></tr>`;
    })
    .join('');
  return `<section class="rp-glass rp-pad" style="margin-top:18px"><div class="rp-eyebrow">Run history</div><h2 class="rp-h3" style="margin:6px 0 16px">${results.length} runs in this report</h2><div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>Observed</th><th>Outcome</th><th>Approved rule</th><th>Commit</th><th>Assertions</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function renderHtmlReport(resultsIn: RunResult[], opts: ReportOptions = {}): string {
  if (resultsIn.length === 0) throw new Error('no results');
  const results = [...resultsIn].sort((a, b) => a.observedAt.startedAt.localeCompare(b.observedAt.startedAt));
  const r = results.at(-1)!;
  const o = OUTCOME[r.summary.outcome];
  const icon = ICON[r.summary.outcome];
  const title = opts.title ?? 'Access-rule evidence report';
  const c = r.summary.counts;
  const prepared = [opts.client ? `Prepared for <strong>${esc(opts.client)}</strong>` : '', opts.preparedBy ? `by <strong>${esc(opts.preparedBy)}</strong>` : '']
    .filter(Boolean)
    .join(' ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(r.rule.ruleId)}</title>
<style>${THEME_CSS}
.rp-report header { padding: 36px 0 22px; }
.rp-hero { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; }
@media (max-width: 860px) { .rp-hero { grid-template-columns: 1fr; } }
</style>
</head>
<body class="rp rp-report">
<div class="rp-wrap">
<header class="rp-spread">
  <span class="rp-brand">${LOGO_SVG}Pyx</span>
  <span class="rp-faint" style="font-size:13px">${prepared || 'Synthetic-fixture evidence'}</span>
</header>

<main>
<section class="rp-hero">
  <div class="rp-glass rp-glass--strong rp-pad">
    <div class="rp-eyebrow">${esc(title)}</div>
    <h1 class="rp-h1 rp-gradient-text" style="margin:12px 0 18px;font-size:clamp(28px,3.6vw,42px)">${esc(r.rule.ruleId)}</h1>
    <div class="rp-verdict ${o.cls}">
      <div class="rp-verdict__orb">${icon}</div>
      <div><div style="font-size:24px;font-weight:660;letter-spacing:-0.02em">${o.word}</div><div class="rp-muted" style="max-width:46ch">${o.line}</div></div>
    </div>
    <hr class="rp-divider">
    <div class="rp-grid rp-grid-4">
      <div><div class="rp-stat__n rp-pass">${c.passed}</div><div class="rp-stat__l">Passed</div></div>
      <div><div class="rp-stat__n rp-fail">${c.failed}</div><div class="rp-stat__l">Failed</div></div>
      <div><div class="rp-stat__n rp-blocked">${c.blocked}</div><div class="rp-stat__l">Blocked</div></div>
      <div><div class="rp-stat__n rp-na">${c.not_assessed}</div><div class="rp-stat__l">Not assessed</div></div>
    </div>
  </div>
  <div class="rp-glass rp-pad">
    <div class="rp-eyebrow">What was checked</div>
    <dl class="rp-kv" style="margin-top:14px">
      <dt>Observed</dt><dd class="rp-mono">${esc(fmtTime(r.observedAt.startedAt))}</dd>
      <dt>Approved rule</dt><dd class="rp-mono">revision ${esc(r.rule.revision ?? '—')}<br>${esc(r.rule.contentHash ?? 'none')}</dd>
      <dt>Approval</dt><dd>${esc(r.provenance.approvalLevel ?? 'none')}</dd>
      <dt>Target</dt><dd class="rp-mono">${esc(r.target.origin ?? 'unknown')}</dd>
      <dt>Environment</dt><dd>${esc(r.target.environmentClass ?? 'unknown')}</dd>
      <dt>Request paths</dt><dd class="rp-mono">${r.paths.length > 0 ? r.paths.map((p) => esc(p.route)).join('<br>') : esc(r.target.transport)}</dd>
      <dt>Source</dt><dd class="rp-mono">${esc(r.source.commit ?? 'not recorded')}${r.source.dirty ? '<br><span class="rp-blocked">uncommitted changes present</span>' : ''}</dd>
      <dt>Completeness</dt><dd>${esc(r.summary.completeness)}</dd>
      <dt>Freshness</dt><dd>${esc(r.freshness.state)} <span class="rp-faint">(${esc(r.freshness.reason.replace(/_/g, ' '))})</span></dd>
    </dl>
  </div>
</section>
${accessReview(results)}
<section class="rp-glass rp-pad" style="margin-top:18px">
  <div class="rp-spread"><div><div class="rp-eyebrow">Proof matrix</div><h2 class="rp-h3" style="margin-top:6px">Who may read which record</h2></div><span class="rp-faint" style="font-size:13px">Rows: actors · Columns: synthetic records${r.paths.length > 1 ? ' · one matrix per request path' : ''}</span></div>
  <div style="margin-top:18px">${matrices(r)}</div>
</section>

<section class="rp-glass rp-pad" style="margin-top:18px">
  <div class="rp-eyebrow">Assertions</div>
  <h2 class="rp-h3" style="margin:6px 0 16px">Each expectation, what was observed, and what to do</h2>
  <div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>Status</th><th>Assertion</th><th>Expectation</th><th>Finding</th></tr></thead><tbody>${assertionRows(r)}</tbody></table></div>
</section>

<section class="rp-glass rp-pad" style="margin-top:18px">
  <div class="rp-eyebrow">Controls</div>
  <h2 class="rp-h3" style="margin:6px 0 16px">Preconditions established before any result was trusted</h2>
  <div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>State</th><th>Control</th><th>Detail</th></tr></thead><tbody>${controlRows(r)}</tbody></table></div>
</section>
${requestLedger(opts.requests)}
${history(results)}
<section class="rp-glass rp-pad" style="margin-top:18px">
  <div class="rp-eyebrow">Scope and limits</div>
  <div class="rp-grid rp-grid-2" style="margin-top:12px">
    <p class="rp-muted" style="margin:0">This report covers only the assertions listed above, against synthetic records, on the named target, at the observed time. It is not a security certification, a penetration test, or evidence about production or any other access path.</p>
    <p class="rp-muted" style="margin:0">${
      r.provenance.approvalLevel === 'local-self-attested'
        ? 'The approved rule was acknowledged locally (self-attested): anyone with write access to the approval store could change it. '
        : ''
    }Results are produced on infrastructure controlled by whoever ran the check; provenance identifies the producer, not honest execution. Execution context declared: ${esc(r.provenance.executionContext)}.</p>
  </div>
</section>
</main>

<footer class="rp-faint" style="font-size:12.5px;padding:28px 0 40px;text-align:center">
  Generated by Pyx ${esc(RUNNER_VERSION)} · run <span class="rp-mono">${esc(r.runId)}</span> · runner ${esc(r.runner.version)}
</footer>
</div>
</body>
</html>
`;
}
