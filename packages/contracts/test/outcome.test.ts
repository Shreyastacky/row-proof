import { describe, expect, it } from 'vitest';
import { summarize, validateSchema, type AssertionResult, type ControlResult, type RunResult } from '../src/index.js';

const ok: ControlResult = { id: 'target', status: 'ok', diagnostic: 'ok' };
const failedControl: ControlResult = { id: 'fixture:invoice-b', status: 'failed', diagnostic: 'fixture_missing' };

function a(status: AssertionResult['status'], id = `x-${Math.random().toString(36).slice(2, 8)}`): AssertionResult {
  return {
    id,
    actorRef: 'user-a',
    fixtureRef: 'invoice-b',
    expected: 'fixture_not_disclosed',
    status,
    observation: status === 'failed' ? 'exact_fixture_returned' : 'no_rows',
    diagnostic: status === 'failed' ? 'fixture_disclosed' : status === 'passed' ? 'ok' : 'owner_control_not_passed',
    httpStatus: 200,
  };
}

describe('run outcome rules', () => {
  it('passes only for a complete matrix with valid controls and every assertion passed', () => {
    const s = summarize([a('passed'), a('passed'), a('passed'), a('passed'), a('passed'), a('passed')], [ok], 6);
    expect(s).toMatchObject({ outcome: 'pass', completeness: 'complete', exitCode: 0 });
  });

  it('never passes a partial matrix', () => {
    expect(summarize([a('passed'), a('passed')], [ok], 6)).toMatchObject({ outcome: 'blocked', exitCode: 2, completeness: 'incomplete' });
  });

  it('never passes when a control failed, even if assertions passed', () => {
    expect(summarize([a('passed')], [ok, failedControl], 1)).toMatchObject({ outcome: 'blocked', exitCode: 2 });
  });

  it('never passes when nothing was required or controls are absent', () => {
    expect(summarize([], [ok], 0).outcome).toBe('blocked');
    expect(summarize([a('passed')], [], 1).outcome).toBe('blocked');
  });

  it('blocked or not-assessed assertions without a violation exit 2', () => {
    expect(summarize([a('passed'), a('blocked')], [ok], 2)).toMatchObject({ outcome: 'blocked', exitCode: 2 });
    expect(summarize([a('not_assessed')], [ok], 1)).toMatchObject({ outcome: 'blocked', exitCode: 2 });
  });

  it('a demonstrated violation exits 1 and still reports incompleteness when mixed with blocked checks', () => {
    expect(summarize([a('failed'), a('passed')], [ok], 2)).toMatchObject({ outcome: 'fail', exitCode: 1, completeness: 'complete' });
    expect(summarize([a('failed'), a('blocked')], [ok, failedControl], 2)).toMatchObject({
      outcome: 'fail',
      exitCode: 1,
      completeness: 'incomplete',
      counts: { passed: 0, failed: 1, blocked: 1, not_assessed: 0 },
    });
  });
});

function sampleResult(): RunResult {
  const assertions = [a('passed', 'a-reads-b')];
  return {
    kind: 'RunResult',
    schemaVersion: 1,
    runId: '0d000000-0000-4000-8000-000000000001',
    rule: { ruleId: 'invoice-owner-read', revision: 1, contentHash: `sha256:${'a'.repeat(64)}` },
    runner: { name: 'rowproof-runner', version: '0.1.0' },
    source: { commit: null, dirty: null },
    scope: { organizationId: null, projectId: 'invoice-portal-demo', environmentId: 'local-disposable' },
    target: { origin: 'http://127.0.0.1:54321', environmentClass: 'local-disposable', transport: 'supabase-data-api-rest-v1' },
    observedAt: { startedAt: '2026-11-05T12:00:00.000Z', finishedAt: '2026-11-05T12:00:01.000Z' },
    limits: { maxRequests: 32, requestTimeoutMs: 5000, runTimeoutMs: 60000, maxResponseBytes: 65536, concurrency: 1, retries: 0 },
    controls: [ok],
    assertions,
    summary: summarize(assertions, [ok], 1),
    freshness: { state: 'unknown', reason: 'no_dependency_observer', dependencies: [] },
    provenance: { approvalLevel: 'local-self-attested', executionContext: 'local-developer' },
  };
}

describe('result schema cannot encode a blanket security verdict or raw data', () => {
  it('accepts a well-formed result', () => {
    const r = validateSchema('RunResult', sampleResult());
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it.each([
    ['top-level secure flag', (r: Record<string, unknown>) => (r.secure = true)],
    ['security score', (r: Record<string, unknown>) => (r.score = 100)],
    ['outcome "secure"', (r: Record<string, unknown>) => ((r.summary as Record<string, unknown>).outcome = 'secure')],
    ['certified flag in summary', (r: Record<string, unknown>) => ((r.summary as Record<string, unknown>).certified = true)],
    ['raw row on an assertion', (r: Record<string, unknown>) => ((r.assertions as Array<Record<string, unknown>>)[0]!.row = { id: 'x', amount: 10 })],
    ['response body on an assertion', (r: Record<string, unknown>) => ((r.assertions as Array<Record<string, unknown>>)[0]!.body = '[]')],
    ['free-text diagnostic', (r: Record<string, unknown>) => ((r.assertions as Array<Record<string, unknown>>)[0]!.diagnostic = 'TypeError: fetch failed at ...')],
    ['request headers', (r: Record<string, unknown>) => (r.headers = { authorization: 'Bearer x' })],
    ['exit code 3', (r: Record<string, unknown>) => ((r.summary as Record<string, unknown>).exitCode = 3)],
  ])('rejects %s', (_label, mutate) => {
    const r = sampleResult() as unknown as Record<string, unknown>;
    mutate(r);
    expect(validateSchema('RunResult', r).ok).toBe(false);
  });
});
