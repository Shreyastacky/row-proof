/**
 * Strict JSON parsing for documents that carry permission intent or approvals.
 *
 * JSON.parse silently keeps the last of duplicate keys. For an approval workflow
 * that is dangerous: a reviewer reading the raw file could see one value while the
 * hash covers another. This parser rejects duplicate keys, `__proto__` keys,
 * lone surrogates, non-finite numbers, and inputs over a byte bound.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class StrictJsonError extends Error {
  readonly code:
    | 'input_too_large'
    | 'syntax_error'
    | 'duplicate_key'
    | 'forbidden_key'
    | 'not_well_formed'
    | 'too_deep';
  readonly position: number;

  constructor(code: StrictJsonError['code'], message: string, position: number) {
    super(`${message} (at character ${position})`);
    this.name = 'StrictJsonError';
    this.code = code;
    this.position = position;
  }
}

export interface StrictJsonOptions {
  /** Maximum UTF-8 byte length of the input. Default 256 KiB. */
  maxBytes?: number;
  /** Maximum nesting depth. Default 32. */
  maxDepth?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_DEPTH = 32;

export function parseStrictJson(text: string, options: StrictJsonOptions = {}): JsonValue {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new StrictJsonError('input_too_large', `input exceeds ${maxBytes} bytes`, 0);
  }
  if (!text.isWellFormed()) {
    throw new StrictJsonError('not_well_formed', 'input contains lone surrogate code units', 0);
  }
  let i = 0;
  // Allow a single leading BOM? No: canonical documents are written without one.

  const fail = (code: StrictJsonError['code'], msg: string): never => {
    throw new StrictJsonError(code, msg, i);
  };

  const skipWs = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };

  const parseString = (): string => {
    // assumes text[i] === '"'
    i++;
    let out = '';
    let start = i;
    while (true) {
      if (i >= text.length) fail('syntax_error', 'unterminated string');
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail('syntax_error', 'unescaped control character in string');
      if (c === 0x5c) {
        out += text.slice(start, i);
        i++;
        const e = text[i];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('syntax_error', 'invalid unicode escape');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail('syntax_error', 'invalid escape');
        }
        i++;
        start = i;
        continue;
      }
      i++;
    }
  };

  const parseNumber = (): number => {
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 400));
    if (!m) return fail('syntax_error', 'invalid number');
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) fail('syntax_error', 'number is not finite');
    return n;
  };

  const parseValue = (depth: number): JsonValue => {
    if (depth > maxDepth) fail('too_deep', `nesting exceeds ${maxDepth}`);
    skipWs();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: { [key: string]: JsonValue } = {};
      const seen = new Set<string>();
      skipWs();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      while (true) {
        skipWs();
        if (text[i] !== '"') fail('syntax_error', 'expected string key');
        const key = parseString();
        if (!key.isWellFormed()) fail('not_well_formed', 'key contains a lone surrogate escape');
        if (key === '__proto__') fail('forbidden_key', 'key "__proto__" is not allowed');
        if (seen.has(key)) fail('duplicate_key', `duplicate key ${JSON.stringify(key.slice(0, 64))}`);
        seen.add(key);
        skipWs();
        if (text[i] !== ':') fail('syntax_error', 'expected ":"');
        i++;
        obj[key] = parseValue(depth + 1);
        skipWs();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return obj;
        }
        fail('syntax_error', 'expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const arr: JsonValue[] = [];
      skipWs();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        fail('syntax_error', 'expected "," or "]"');
      }
    }
    if (c === '"') {
      const str = parseString();
      if (!str.isWellFormed()) fail('not_well_formed', 'string contains a lone surrogate escape');
      return str;
    }
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return parseNumber();
    return fail('syntax_error', 'unexpected token');
  };

  const value = parseValue(0);
  skipWs();
  if (i !== text.length) fail('syntax_error', 'unexpected trailing content');
  return value;
}
