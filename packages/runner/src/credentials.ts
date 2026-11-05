/**
 * Credential classification. Decoding a JWT here is used ONLY to refuse
 * obviously wrong credentials before they are sent, and to read claims of a
 * token the Auth server has already accepted. Decoding is never treated as
 * verification of identity.
 */

export type ApiKeyClass =
  | 'publishable'
  | 'secret'
  | 'legacy-anon'
  | 'legacy-service-role'
  | 'user-access-token'
  | 'unknown-jwt'
  | 'unknown';

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

const HEADER_SAFE = /^[A-Za-z0-9._~+/=-]{8,8192}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** True when a credential can be placed in an HTTP header without injection risk. */
export function isHeaderSafe(value: string): boolean {
  return HEADER_SAFE.test(value);
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** UNVERIFIED decode. Never use the result as proof of who a token belongs to. */
export function decodeJwtUnverified(token: string): DecodedJwt | null {
  if (!JWT_SHAPE.test(token)) return null;
  const [h, p] = token.split('.');
  if (h === undefined || p === undefined) return null;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  return header && payload ? { header, payload } : null;
}

export function classifyApiKey(value: string): ApiKeyClass {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return 'publishable';
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return 'secret';
  const jwt = decodeJwtUnverified(value);
  if (!jwt) return 'unknown';
  switch (jwt.payload.role) {
    case 'anon':
      return 'legacy-anon';
    case 'service_role':
      return 'legacy-service-role';
    case 'authenticated':
      return 'user-access-token';
    default:
      return 'unknown-jwt';
  }
}

export function isElevated(cls: ApiKeyClass): boolean {
  return cls === 'secret' || cls === 'legacy-service-role';
}

export type UserTokenCheck =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; code: 'token_malformed' | 'token_elevated_role' };

/**
 * Pre-flight check of a user access token before it is sent anywhere.
 * Rejects secret/service-role credentials and anything that is not a JWT with
 * the `authenticated` role claim.
 */
export function precheckUserToken(value: string): UserTokenCheck {
  if (!isHeaderSafe(value)) return { ok: false, code: 'token_malformed' };
  const cls = classifyApiKey(value);
  if (isElevated(cls)) return { ok: false, code: 'token_elevated_role' };
  if (cls !== 'user-access-token') return { ok: false, code: 'token_malformed' };
  const decoded = decodeJwtUnverified(value);
  if (!decoded) return { ok: false, code: 'token_malformed' };
  return { ok: true, claims: decoded.payload };
}
