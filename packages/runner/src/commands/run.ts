/**
 * `pyx run`: read the approved revision (read-only), execute the matrix,
 * write a safe JSON result and print a summary. This module must never import
 * the approval writer; a unit test enforces that.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BaselineError,
  openFileBaselineReader,
  parseStrictJson,
  StrictJsonError,
  validateSchema,
  type ApprovedBaselineReader,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@pyx/contracts';
import { approvedOrigins, DEFAULT_LIMITS, executeRun, type RunContext } from '../engine.js';
import { loadEnvFile, optionalInt, readTextFile, requireString, RUNNER_VERSION, UsageError, type CliIO } from '../io.js';
import { appendFile } from 'node:fs/promises';
import { assertOutputSafe, OutputSafetyError, renderSummary, serializeResult, writeResultFile } from '../report.js';
import { renderHtmlReport } from '../html-report.js';
import { renderJunit, renderMarkdownSummary } from '../ci-formats.js';
import { compareResults, CompareError, renderComparison, renderComparisonMarkdown } from '../compare.js';
import { ABORT_CANCELLED, ABORT_DEADLINE, BoundedFetchTransport, type FetchLike } from '../transport.js';

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const CONTEXTS = ['local-developer', 'ci-development', 'ci-trusted-pinned-declared'] as const;

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return null;
  }
}

/** Source commit plus whether tracked files differ from it. An explicit commit cannot be checked, so dirty is null. */
export function detectSource(explicit: string | undefined, env: CliIO['env'], cwd: string): RunResult['source'] {
  const candidate = explicit ?? env.GITHUB_SHA;
  if (candidate !== undefined) {
    if (!COMMIT.test(candidate)) throw new UsageError('--source-commit must be a full lowercase hex commit id');
    return { commit: candidate, dirty: null };
  }
  const head = git(['rev-parse', 'HEAD'], cwd)?.trim() ?? null;
  if (head === null || !COMMIT.test(head)) return { commit: null, dirty: null };
  const status = git(['status', '--porcelain', '--untracked-files=no'], cwd);
  return { commit: head, dirty: status === null ? null : status.trim().length > 0 };
}

export interface RunCommandDeps {
  fetchImpl?: FetchLike;
  reader?: ApprovedBaselineReader;
  /** Lets tests trigger cancellation. */
  signal?: AbortSignal;
  now?: () => Date;
}

export const RUN_HELP = `pyx run --store <dir> --rule <rule-id> [options]

Reads the ACTIVE approved revision (read-only), verifies target, keys, fixtures and
identities, then executes the approved read matrix against the Supabase Data API.

Options:
  --store <dir>              approval store to read (or PYX_APPROVAL_STORE)
  --rule <id>                rule id
  --revision <n>             require that the active revision is n
  --expect-hash <sha256:..>  require that the active content hash is exactly this
  --credentials <path>       read credentials from a dotenv file (kept out of process.env;
                             named so Node does not intercept it like --env-file)
  --target-url <origin>      target origin (or PYX_SUPABASE_URL); must equal the approved origin
  --out <path>               result JSON path (default artifacts/pyx/<run-id>.json)
  --html <path>              also write a self-contained HTML evidence report
  --junit <path>             also write JUnit XML (one test case per assertion) for CI test reporters
  --summary-md <path>        append a Markdown summary (use "$GITHUB_STEP_SUMMARY" in GitHub Actions)
  --requests <path>          also write the request ledger: every request sent, with its purpose,
                             identity used (by name, never the credential), status and size
  --compare-to <result.json> after the run, print who gained or lost access since that
                             earlier run (e.g. the last release) and add it to --summary-md
  --force                    replace existing output files
  --source-commit <sha>      source commit (default GITHUB_SHA or git rev-parse HEAD)
  --execution-context <c>    local-developer | ci-development | ci-trusted-pinned-declared
  --max-requests <n>  --request-timeout-ms <n>  --run-timeout-ms <n>  --max-response-bytes <n>

Exit codes: 0 every required assertion passed with valid controls;
            1 at least one demonstrated violation (even if others are blocked);
            2 blocked or incomplete without a demonstrated violation, or invalid invocation.
`;

export async function runCommand(argv: string[], io: CliIO, deps: RunCommandDeps = {}): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      store: { type: 'string' },
      rule: { type: 'string' },
      revision: { type: 'string' },
      'expect-hash': { type: 'string' },
      'credentials': { type: 'string' },
      'target-url': { type: 'string' },
      out: { type: 'string' },
      'source-commit': { type: 'string' },
      'execution-context': { type: 'string' },
      'max-requests': { type: 'string' },
      'request-timeout-ms': { type: 'string' },
      'run-timeout-ms': { type: 'string' },
      'max-response-bytes': { type: 'string' },
      force: { type: 'boolean' },
      html: { type: 'string' },
      junit: { type: 'string' },
      'summary-md': { type: 'string' },
      'compare-to': { type: 'string' },
      requests: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    io.stdout(RUN_HELP);
    return 0;
  }
  const store = values.store ?? io.env.PYX_APPROVAL_STORE;
  if (!store) throw new UsageError('missing --store (or PYX_APPROVAL_STORE)');
  const ruleId = requireString(values.rule, 'rule');
  const pinRevision = optionalInt(values.revision, 'revision', 1, 1_000_000);
  const pinHash = values['expect-hash'];
  if (pinHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(pinHash)) throw new UsageError('--expect-hash must be sha256:<64 hex>');
  const ctxName = values['execution-context'] ?? 'local-developer';
  if (!(CONTEXTS as readonly string[]).includes(ctxName)) throw new UsageError(`--execution-context must be one of ${CONTEXTS.join(', ')}`);

  const limits: RunLimits = {
    ...DEFAULT_LIMITS,
    ...(optionalInt(values['max-requests'], 'max-requests', 1, 200) !== undefined && { maxRequests: Number(values['max-requests']) }),
    ...(optionalInt(values['request-timeout-ms'], 'request-timeout-ms', 100, 60_000) !== undefined && {
      requestTimeoutMs: Number(values['request-timeout-ms']),
    }),
    ...(optionalInt(values['run-timeout-ms'], 'run-timeout-ms', 1000, 600_000) !== undefined && { runTimeoutMs: Number(values['run-timeout-ms']) }),
    ...(optionalInt(values['max-response-bytes'], 'max-response-bytes', 1024, 1_048_576) !== undefined && {
      maxResponseBytes: Number(values['max-response-bytes']),
    }),
  };

  const fileEnv = values['credentials'] ? await loadEnvFile(resolve(io.cwd, values['credentials'])) : {};
  const env: Record<string, string | undefined> = { ...io.env, ...fileEnv };
  const targetUrl = values['target-url'] ?? env.PYX_SUPABASE_URL;
  const source = detectSource(values['source-commit'], io.env, io.cwd);

  // Fail before assessing if an output path is unusable, so a finding is never lost to a write error.
  const runId = randomUUID();
  const outPath = resolve(io.cwd, values.out ?? `artifacts/pyx/${runId}.json`);
  const extraOutputs = [values.html, values.junit, values.requests].filter((p): p is string => typeof p === 'string').map((p) => resolve(io.cwd, p));
  const outputPaths = [outPath, ...extraOutputs, ...(values['summary-md'] ? [resolve(io.cwd, values['summary-md'])] : [])];
  const pathKey = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
  if (new Set(outputPaths.map(pathKey)).size !== outputPaths.length) {
    throw new UsageError('output paths must be distinct');
  }
  const inputs = [values.credentials, values['compare-to']].filter((p): p is string => typeof p === 'string');
  if (inputs.some((p) => outputPaths.map(pathKey).includes(pathKey(resolve(io.cwd, p))))) {
    throw new UsageError('output paths must not overwrite credentials or the previous result');
  }
  if (!values.force) {
    for (const p of [outPath, ...extraOutputs]) {
      if (existsSync(p)) throw new UsageError(`output file already exists: ${p} (use --force to replace it)`);
    }
  }

  // An earlier result to compare against: loaded and validated before anything is sent.
  let previous: RunResult | null = null;
  if (values['compare-to']) {
    const p = values['compare-to'];
    let raw: unknown;
    try {
      raw = parseStrictJson(await readTextFile(resolve(io.cwd, p), 1024 * 1024), { maxBytes: 1024 * 1024 });
    } catch (e) {
      if (e instanceof StrictJsonError) throw new UsageError(`--compare-to ${p}: ${e.message}`);
      throw e;
    }
    const v = validateSchema('RunResult', raw);
    if (!v.ok) throw new UsageError(`--compare-to ${p} is not a valid Pyx result`);
    if (v.value.rule.ruleId !== ruleId) throw new UsageError(`--compare-to ${p} is a result for rule ${v.value.rule.ruleId}, not ${ruleId}`);
    previous = v.value;
  }

  // Approved baseline: read-only.
  const reader = deps.reader ?? openFileBaselineReader(resolve(io.cwd, store));
  let baseline: VerifiedBaseline | null = null;
  let baselineFailure: RunContext['baselineFailure'] = null;
  try {
    baseline = await reader.readActive(ruleId, {
      ...(pinRevision !== undefined && { revision: pinRevision }),
      ...(pinHash !== undefined && { contentHash: pinHash }),
    });
  } catch (e) {
    if (!(e instanceof BaselineError)) throw e;
    baselineFailure = { ruleId, diagnostic: e.code === 'pin_mismatch' ? 'baseline_pin_mismatch' : 'baseline_invalid' };
    io.stderr(`approved baseline unavailable: ${e.code}\n`);
  }

  // Run-wide deadline and cancellation.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(ABORT_DEADLINE), limits.runTimeoutMs);
  const onSignal = () => controller.abort(ABORT_CANCELLED);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  deps.signal?.addEventListener('abort', onSignal, { once: true });
  if (deps.signal?.aborted) onSignal();

  const allowedOrigins = baseline ? approvedOrigins(baseline.revision.content) : ['http://127.0.0.1:1'];
  let output;
  try {
    output = await executeRun({
      baseline,
      baselineFailure,
      env,
      targetUrl,
      transport: new BoundedFetchTransport({
        allowedOrigins,
        limits,
        runSignal: controller.signal,
        userAgent: `pyx-runner/${RUNNER_VERSION}`,
        ...(deps.fetchImpl && { fetchImpl: deps.fetchImpl }),
      }),
      limits,
      source,
      executionContext: ctxName as RunResult['provenance']['executionContext'],
      runnerVersion: RUNNER_VERSION,
      runId,
      now: deps.now ?? (() => new Date()),
    });
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    deps.signal?.removeEventListener('abort', onSignal);
  }

  let text: string;
  let summary: string;
  try {
    text = serializeResult(output.result, output.sensitiveValues);
    summary = renderSummary(output.result, outPath);
    // The terminal summary must never carry credential material either.
    assertOutputSafe(summary, output.sensitiveValues);
  } catch (e) {
    if (e instanceof OutputSafetyError) {
      io.stderr(`refusing to write or print output: ${e.code}\n`);
      return 2;
    }
    throw e;
  }
  // Print first: a write failure must not hide what was observed.
  io.stdout(summary);
  let exitCode = output.result.summary.exitCode;
  try {
    await writeResultFile(outPath, text, values.force === true);
    if (values.html) {
      const html = renderHtmlReport([output.result], { requests: output.requests });
      assertOutputSafe(html, output.sensitiveValues);
      await writeResultFile(resolve(io.cwd, values.html), html, values.force === true);
      io.stdout(`  HTML report: ${resolve(io.cwd, values.html)}\n`);
    }
    if (values.requests) {
      const ledger = JSON.stringify({ kind: 'PyxRequestLedger', runId: output.result.runId, requests: output.requests }, null, 2) + '\n';
      assertOutputSafe(ledger, output.sensitiveValues);
      await writeResultFile(resolve(io.cwd, values.requests), ledger, values.force === true);
      io.stdout(`  Request ledger: ${resolve(io.cwd, values.requests)} (${output.requests.length} requests)\n`);
    }
    if (values.junit) {
      const xml = renderJunit(output.result);
      assertOutputSafe(xml, output.sensitiveValues);
      await writeResultFile(resolve(io.cwd, values.junit), xml, values.force === true);
    }
    const mdPath = values['summary-md'];
    if (mdPath) {
      const md = renderMarkdownSummary(output.result);
      assertOutputSafe(md, output.sensitiveValues);
      // Appends, so it can target $GITHUB_STEP_SUMMARY.
      await appendFile(resolve(io.cwd, mdPath), md, 'utf8');
    }
    if (previous) {
      try {
        const c = compareResults(previous, output.result, {
          before: previous.source.commit?.slice(0, 10) ?? 'previous',
          after: output.result.source.commit?.slice(0, 10) ?? 'this run',
        });
        const text = renderComparison(c);
        exitCode = exitCode === 1 || c.exitCode === 1 ? 1 : Math.max(exitCode, c.exitCode) as 0 | 2;
        assertOutputSafe(text, output.sensitiveValues);
        io.stdout(`\n${text}`);
        if (mdPath) await appendFile(resolve(io.cwd, mdPath), renderComparisonMarkdown(c), 'utf8');
      } catch (e) {
        if (!(e instanceof CompareError)) throw e;
        io.stderr(`access review skipped: ${e.message}\n`);
      }
    }
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? String((e as NodeJS.ErrnoException).code) : 'unknown';
    io.stderr(`could not write an output file (${code}); the outcome above still stands\n`);
    // Keep a demonstrated violation visible as exit 1; otherwise report the incomplete output as 2.
    return exitCode === 1 ? 1 : 2;
  }
  return exitCode;
}
