/**
 * Deterministic canonicalization: RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * - Object members sorted by UTF-16 code units of their keys.
 * - No insignificant whitespace.
 * - Numbers serialized with ECMAScript Number-to-String (what JSON.stringify does
 *   for finite numbers; -0 becomes 0).
 * - Strings serialized with JSON.stringify escaping, which matches JCS for
 *   well-formed strings. Lone surrogates are rejected.
 *
 * The content hash is `sha256:` + lowercase hex SHA-256 of the UTF-8 bytes of the
 * canonical form. A RuleContent document carries `kind` and `schemaVersion`, which
 * gives natural domain separation from other document types.
 */
import { createHash } from 'node:crypto';

export class CanonicalizationError extends Error {
  readonly code: 'unsupported_value' | 'non_finite_number' | 'not_well_formed' | 'cycle';
  constructor(code: CanonicalizationError['code'], message: string) {
    super(message);
    this.name = 'CanonicalizationError';
    this.code = code;
  }
}

export function canonicalize(value: unknown): string {
  const stack = new Set<object>();

  const walk = (v: unknown): string => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'boolean':
        return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new CanonicalizationError('non_finite_number', 'non-finite number');
        return JSON.stringify(v);
      case 'string':
        if (!v.isWellFormed()) throw new CanonicalizationError('not_well_formed', 'string with lone surrogate');
        return JSON.stringify(v);
      case 'object': {
        if (stack.has(v)) throw new CanonicalizationError('cycle', 'cyclic structure');
        stack.add(v);
        let out: string;
        if (Array.isArray(v)) {
          out = '[' + v.map((item) => walk(item)).join(',') + ']';
        } else {
          const proto = Object.getPrototypeOf(v);
          if (proto !== Object.prototype && proto !== null) {
            throw new CanonicalizationError('unsupported_value', 'only plain objects can be canonicalized');
          }
          const record = v as Record<string, unknown>;
          const keys = Object.keys(record).sort();
          const parts: string[] = [];
          for (const key of keys) {
            if (!key.isWellFormed()) throw new CanonicalizationError('not_well_formed', 'key with lone surrogate');
            const member = record[key];
            if (member === undefined) {
              throw new CanonicalizationError('unsupported_value', `undefined member ${JSON.stringify(key)}`);
            }
            parts.push(JSON.stringify(key) + ':' + walk(member));
          }
          out = '{' + parts.join(',') + '}';
        }
        stack.delete(v);
        return out;
      }
      default:
        throw new CanonicalizationError('unsupported_value', `unsupported type ${typeof v}`);
    }
  };

  return walk(value);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Content hash of any JSON document, e.g. a RuleContent. */
export function contentHashOf(value: unknown): `sha256:${string}` {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}

/** Constant-time-ish string equality for hashes (avoids early exit on mismatch). */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
