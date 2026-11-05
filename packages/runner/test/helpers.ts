import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createApprovedRevision,
  createProposal,
  type RuleContent,
  type RunLimits,
  type RunResult,
  type VerifiedBaseline,
} from '@ship-safe/contracts';
import { DEFAULT_LIMITS, executeRun, type RunOutput } from '../src/engine.js';
import { BoundedFetchTransport, type FetchLike } from '../src/transport.js';
import { ORIGIN } from './fake-supabase.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function exampleRule(): RuleContent {
  return JSON.parse(readFileSync(`${repoRoot}examples/invoice-owner-read.rule.json`, 'utf8')) as RuleContent;
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
  const transport = new BoundedFetchTransport({
    allowedOrigin: ORIGIN,
    limits,
    runSignal: opts.signal ?? new AbortController().signal,
    fetchImpl,
    userAgent: 'ship-safe-runner/test',
  });
  const out = await executeRun({
    baseline: opts.baseline ?? approvedBaseline(),
    baselineFailure: null,
    env: opts.env,
    targetUrl: 'targetUrl' in opts ? opts.targetUrl : opts.env.SHIPSAFE_SUPABASE_URL,
    transport,
    limits,
    sourceCommit: null,
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

export function control(result: RunResult, id: string): { status: string; diagnostic: string } | undefined {
  const c = result.controls.find((x) => x.id === id);
  return c && { status: c.status, diagnostic: c.diagnostic };
}
