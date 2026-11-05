import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createApprovedRevision,
  createProposal,
  type RuleContent,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@pyx/contracts';
import { approvedOrigins, DEFAULT_LIMITS, executeRun, type RunOutput } from '../src/engine.js';
import { BoundedFetchTransport, type FetchLike } from '../src/transport.js';
import { ORIGIN } from './fake-supabase.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function exampleRule(): RuleContent {
  return JSON.parse(readFileSync(`${repoRoot}examples/invoice-owner-read.rule.json`, 'utf8')) as RuleContent;
}

export function threePathRule(): RuleContent {
  return JSON.parse(readFileSync(`${repoRoot}examples/invoice-three-paths.rule.json`, 'utf8')) as RuleContent;
}

export function approvedBaseline(content: RuleContent = exampleRule()): VerifiedBaseline {
  const proposal = createProposal({
    content,
    basedOn: null,
    proposedBy: { id: 'dev', kind: 'local-user' },
    note: null,
    proposalId: '7b2f0000-0000-4000-8000-000000000001',
    now: new Date(),
  });
  const revision = createApprovedRevision({
    proposal,
    revision: 1,
    acknowledgedHash: proposal.contentHash,
    approvedBy: { id: 'owner', kind: 'local-user' },
    provenanceLevel: 'local-self-attested',
    supersedes: null,
    approvalId: '7b2f0000-0000-4000-8000-0000000000a1',
    now: new Date(),
  });
  return { revision, active: null, sourceDescription: 'test' };
}

export interface RunOpts {
  env: Record<string, string | undefined>;
  baseline?: VerifiedBaseline;
  limits?: Partial<RunLimits>;
  signal?: AbortSignal;
  targetUrl?: string;
}

export async function runEngine(fetchImpl: FetchLike, opts: RunOpts): Promise<RunOutput & { requestsMade: number }> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const baseline = opts.baseline ?? approvedBaseline();
  const transport = new BoundedFetchTransport({
    allowedOrigins: approvedOrigins(baseline.revision.content),
    limits,
    runSignal: opts.signal ?? new AbortController().signal,
    fetchImpl,
    userAgent: 'pyx-runner/test',
  });
  const out = await executeRun({
    baseline,
    baselineFailure: null,
    env: opts.env,
    targetUrl: 'targetUrl' in opts ? opts.targetUrl : opts.env.PYX_SUPABASE_URL,
    transport,
    limits,
    source: { commit: null, dirty: null },
    executionContext: 'local-developer',
    runnerVersion: '0.1.0',
    runId: '0d000000-0000-4000-8000-000000000001',
    now: () => new Date(),
  });
  return { ...out, requestsMade: transport.requestsMade };
}

export function byId(result: RunResult): Record<string, { status: string; diagnostic: string }> {
  return Object.fromEntries(result.assertions.map((a) => [a.id, { status: a.status, diagnostic: a.diagnostic }]));
}

/** Assertions keyed by `<path>/<expectation id>`. */
export function byPath(result: RunResult): Record<string, { status: string; diagnostic: string }> {
  return Object.fromEntries(result.assertions.map((a) => [`${a.path}/${a.id}`, { status: a.status, diagnostic: a.diagnostic }]));
}

export function control(result: RunResult, id: string): { status: string; diagnostic: string } | undefined {
  const c = result.controls.find((x) => x.id === id);
  return c && { status: c.status, diagnostic: c.diagnostic };
}
