/**
 * `rowproof run`: read the approved revision (read-only), execute the matrix,
 * write a safe JSON result and print a summary. This module must never import
 * the approval writer; a unit test enforces that.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BaselineError,
  openFileBaselineReader,
  type ApprovedBaselineReader,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@rowproof/contracts';
import { DEFAULT_LIMITS, executeRun, type RunContext } from '../engine.js';
import { loadEnvFile, optionalInt, requireString, RUNNER_VERSION, UsageError, type CliIO } from '../io.js';
import { OutputSafetyError, renderSummary, serializeResult, writeResultFile } from '../report.js';
import { ABORT_CANCELLED, ABORT_DEADLINE, BoundedFetchTransport, type FetchLike } from '../transport.js';

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const CONTEXTS = ['local-developer', 'ci-development', 'ci-trusted-pinned-declared'] as const;

function detectCommit(explicit: string | undefined, env: CliIO['env'], cwd: string): string | null {
  const candidate = explicit ?? env.GITHUB_SHA;
  if (candidate !== undefined) {
    if (!COMMIT.test(candidate)) throw new UsageError('--source-commit must be a full lowercase hex commit id');
    return candidate;
  }
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return COMMIT.test(out) ? out : null;
  } catch {
    return null;
  }
}

export interface RunCommandDeps {
  fetchImpl?: FetchLike;
  reader?: ApprovedBaselineReader;
  /** Lets tests trigger cancellation. */
  signal?: AbortSignal;
  now?: () => Date;
}

export const RUN_HELP = `rowproof run --store <dir> --rule <rule-id> [options]

Reads the ACTIVE approved revision (read-only), verifies target, keys, fixtures and
identities, then executes the approved read matrix against the Supabase Data API.

Options:
  --store <dir>              approval store to read (or ROWPROOF_APPROVAL_STORE)
  --rule <id>                rule id
  --revision <n>             require that the active revision is n
  --expect-hash <sha256:..>  require that the active content hash is exactly this
  --env-file <path>          read credentials from a dotenv file (not process-wide)
  --target-url <origin>      target origin (or ROWPROOF_SUPABASE_URL); must equal the approved origin
  --out <path>               result JSON path (default artifacts/rowproof/<run-id>.json)
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
      'env-file': { type: 'string' },
      'target-url': { type: 'string' },
      out: { type: 'string' },
      'source-commit': { type: 'string' },
      'execution-context': { type: 'string' },
      'max-requests': { type: 'string' },
      'request-timeout-ms': { type: 'string' },
      'run-timeout-ms': { type: 'string' },
      'max-response-bytes': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    io.stdout(RUN_HELP);
    return 0;
  }
  const store = values.store ?? io.env.ROWPROOF_APPROVAL_STORE;
  if (!store) throw new UsageError('missing --store (or ROWPROOF_APPROVAL_STORE)');
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

  const fileEnv = values['env-file'] ? await loadEnvFile(resolve(io.cwd, values['env-file'])) : {};
  const env: Record<string, string | undefined> = { ...io.env, ...fileEnv };
  const targetUrl = values['target-url'] ?? env.ROWPROOF_SUPABASE_URL;
  const sourceCommit = detectCommit(values['source-commit'], io.env, io.cwd);

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

  const runId = randomUUID();
  const allowedOrigin = baseline?.revision.content.target.allowedOrigin ?? 'http://127.0.0.1:1';
  let output;
  try {
    output = await executeRun({
      baseline,
      baselineFailure,
      env,
      targetUrl,
      transport: new BoundedFetchTransport({
        allowedOrigin,
        limits,
        runSignal: controller.signal,
        userAgent: `rowproof-runner/${RUNNER_VERSION}`,
        ...(deps.fetchImpl && { fetchImpl: deps.fetchImpl }),
      }),
      limits,
      sourceCommit,
      executionContext: ctxName as RunResult['provenance']['executionContext'],
      runnerVersion: RUNNER_VERSION,
      runId,
      now: deps.now ?? (() => new Date()),
    });
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  const outPath = resolve(io.cwd, values.out ?? `artifacts/rowproof/${runId}.json`);
  let text: string;
  try {
    text = serializeResult(output.result, output.sensitiveValues);
  } catch (e) {
    if (e instanceof OutputSafetyError) {
      io.stderr(`refusing to write output: ${e.code}\n`);
      return 2;
    }
    throw e;
  }
  const summary = renderSummary(output.result, outPath);
  try {
    // The summary is also checked: it must never carry credential material.
    serializeResult(output.result, output.sensitiveValues);
    if (output.sensitiveValues.some((v) => v.length >= 8 && summary.includes(v))) throw new OutputSafetyError('output_leak_prevented');
  } catch (e) {
    if (e instanceof OutputSafetyError) {
      io.stderr(`refusing to print summary: ${e.code}\n`);
      return 2;
    }
    throw e;
  }
  await writeResultFile(outPath, text);
  io.stdout(summary);
  return output.result.summary.exitCode;
}
