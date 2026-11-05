/**
 * Exact origin handling. A target is identified by scheme, host, and port only.
 * Labels such as "staging" never establish that a URL is non-production.
 */

export interface ParsedOrigin {
  /** Normalized `scheme://host:port` with the port always explicit. */
  origin: string;
  scheme: 'http' | 'https';
  host: string;
  port: number;
  isLoopback: boolean;
}

export type OriginParseFailure =
  | 'not_a_url'
  | 'unsupported_scheme'
  | 'has_credentials'
  | 'has_path_query_or_fragment'
  | 'not_in_exact_form';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Parse an origin string that must already be in exact form: no trailing slash,
 * path, query, fragment, or credentials. Returns a failure reason otherwise.
 */
export function parseExactOrigin(input: string): { ok: true; value: ParsedOrigin } | { ok: false; reason: OriginParseFailure } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'not_a_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'unsupported_scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'has_credentials' };
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return { ok: false, reason: 'has_path_query_or_fragment' };
  }
  // URL normalizes; require the input to already be the normalized origin (with or without default port).
  if (input !== url.origin) return { ok: false, reason: 'not_in_exact_form' };
  const scheme = url.protocol === 'http:' ? 'http' : 'https';
  const port = url.port === '' ? (scheme === 'http' ? 80 : 443) : Number(url.port);
  const host = url.hostname;
  return {
    ok: true,
    value: {
      origin: `${scheme}://${host}:${port}`,
      scheme,
      host,
      port,
      isLoopback: LOOPBACK_HOSTS.has(host),
    },
  };
}

/** True when two exact origins identify the same scheme/host/port. */
export function sameOrigin(a: string, b: string): boolean {
  const pa = parseExactOrigin(a);
  const pb = parseExactOrigin(b);
  return pa.ok && pb.ok && pa.value.origin === pb.value.origin;
}
