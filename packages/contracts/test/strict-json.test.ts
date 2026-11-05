import { describe, expect, it } from 'vitest';
import { parseStrictJson, StrictJsonError } from '../src/index.js';
import { readRepoFile } from './helpers.js';

function code(text: string, opts?: Parameters<typeof parseStrictJson>[1]): string | null {
  try {
    parseStrictJson(text, opts);
    return null;
  } catch (e) {
    return e instanceof StrictJsonError ? e.code : 'other';
  }
}

describe('strict JSON parser', () => {
  it('parses ordinary documents identically to JSON.parse', () => {
    const text = readRepoFile('examples/invoice-owner-read.rule.json');
    expect(parseStrictJson(text)).toEqual(JSON.parse(text));
    expect(parseStrictJson('[1,-2.5e3,"\\u00e9\\n",true,false,null,{}]')).toEqual(JSON.parse('[1,-2.5e3,"\\u00e9\\n",true,false,null,{}]'));
  });

  it('rejects duplicate keys, which JSON.parse would silently collapse', () => {
    expect(code('{"a":1,"a":2}')).toBe('duplicate_key');
    expect(code('{"x":{"expected":"fixture_not_disclosed","expected":"exact_fixture_returned"}}')).toBe('duplicate_key');
    expect(code('{"a":1,"\\u0061":2}')).toBe('duplicate_key');
  });

  it('rejects __proto__ keys, lone surrogate escapes, deep nesting, and oversized input', () => {
    expect(code('{"__proto__":{"polluted":true}}')).toBe('forbidden_key');
    expect(code('"\\ud800"')).toBe('not_well_formed');
    expect(code('{"\\udc00":1}')).toBe('not_well_formed');
    expect(code('['.repeat(40) + ']'.repeat(40))).toBe('too_deep');
    expect(code(`"${'x'.repeat(100)}"`, { maxBytes: 50 })).toBe('input_too_large');
  });

  it('rejects syntax JSON.parse rejects', () => {
    for (const bad of ['', '{', '{"a":}', '[1,]', '{"a":1,}', "{'a':1}", '01', '1.', 'NaN', 'nul', '"\u0001"', '{"a":1} x', '"\\x"']) {
      expect(code(bad), bad).toBe('syntax_error');
    }
  });
});
