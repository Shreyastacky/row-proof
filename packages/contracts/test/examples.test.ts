import { describe, expect, it } from 'vitest';
import {
  parseStrictJson,
  StrictJsonError,
  validateRuleContent,
  verifyApprovedRevision,
  verifyProposal,
  type Issue,
} from '../src/index.js';
import { readRepoFile } from './helpers.js';

interface Case {
  file: string;
  kind: 'RuleContent' | 'RuleProposal' | 'ApprovedRevision';
  expect: { valid: true } | { code: string } | { unsupported: string };
}

const manifest = JSON.parse(readRepoFile('examples/contracts/cases.json')) as { cases: Case[] };

function run(kind: Case['kind'], text: string): { ok: boolean; issues: Issue[] } {
  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch (e) {
    if (e instanceof StrictJsonError) return { ok: false, issues: [{ code: `json_${e.code}`, path: '/', message: e.message, severity: 'error' }] };
    throw e;
  }
  if (kind === 'RuleContent') return validateRuleContent(value);
  if (kind === 'RuleProposal') return verifyProposal(value);
  return verifyApprovedRevision(value);
}

describe('example corpus', () => {
  it('the canonical invoice rule is valid and supported', () => {
    const r = run('RuleContent', readRepoFile('examples/invoice-owner-read.rule.json'));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('has invalid and unsupported cases', () => {
    expect(manifest.cases.filter((c) => 'code' in c.expect).length).toBeGreaterThanOrEqual(15);
    expect(manifest.cases.filter((c) => 'unsupported' in c.expect).length).toBeGreaterThanOrEqual(3);
  });

  it.each(manifest.cases.map((c) => [c.file, c] as const))('%s', (_file, c) => {
    const r = run(c.kind, readRepoFile(`examples/contracts/${c.file}`));
    const codes = r.issues.map((i) => i.code);
    if ('valid' in c.expect) {
      expect(r.ok, JSON.stringify(r.issues)).toBe(true);
      expect(r.issues.filter((i) => i.severity === 'unsupported')).toEqual([]);
    } else if ('code' in c.expect) {
      expect(r.ok).toBe(false);
      expect(codes).toContain(c.expect.code);
    } else {
      expect(r.ok, JSON.stringify(r.issues)).toBe(true);
      expect(r.issues.filter((i) => i.severity === 'unsupported').map((i) => i.code)).toContain(c.expect.unsupported);
    }
  });

  it('issue messages never echo credential-shaped input values', () => {
    const r = run('RuleContent', readRepoFile('examples/contracts/invalid/credential-value-in-title.json'));
    expect(JSON.stringify(r.issues)).not.toMatch(/eyJ/);
  });
});
