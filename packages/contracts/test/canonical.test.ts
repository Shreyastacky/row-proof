import { describe, expect, it } from 'vitest';
import { canonicalize, CanonicalizationError, contentHashOf, parseStrictJson, ruleContentHash } from '../src/index.js';
import { exampleRule, readRepoFile } from './helpers.js';

describe('RFC 8785 canonicalization', () => {
  it('matches the RFC 8785 section 3.2.2 sample', () => {
    const input = parseStrictJson(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
        '"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals": [null, true, false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units (RFC 8785 section 3.2.3 ordering)', () => {
    const input = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    // Read keys from the canonical text itself: JS objects always enumerate integer-like keys first.
    const canonical = canonicalize(input);
    const keys = [...canonical.matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(keys).toEqual(['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('is independent of key order and whitespace', () => {
    const rule = exampleRule();
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v !== null && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v;
    const reordered = reverseKeys(rule);
    expect(Object.keys(reordered as object)[0]).toBe('declaredScope');
    const compact = JSON.parse(JSON.stringify(rule)) as unknown;
    expect(contentHashOf(reordered)).toBe(contentHashOf(rule));
    expect(contentHashOf(compact)).toBe(contentHashOf(rule));
  });

  it('serializes -0 as 0 and rejects values JSON cannot represent', () => {
    expect(canonicalize({ a: -0 })).toBe('{"a":0}');
    expect(() => canonicalize({ a: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Date())).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: '\ud800' })).toThrow(CanonicalizationError);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalize(cyc)).toThrow(CanonicalizationError);
  });

  it('keeps the example rule hash stable (golden value guards accidental canonicalization changes)', () => {
    expect(ruleContentHash(exampleRule())).toBe('sha256:1b9f55aa616a164d8fb853c4cac187ef4854fb3b6b8981387f968917cba9f9b3');
  });

  it('hashes the parsed document, not the file bytes', () => {
    const text = readRepoFile('examples/invoice-owner-read.rule.json');
    expect(contentHashOf(parseStrictJson(text))).toBe(contentHashOf(parseStrictJson(text.replace(/\n\s*/g, ''))));
  });
});
