/**
 * In-memory stand-in for the Supabase gateway, used ONLY to exercise transport
 * failures, response-shape handling and output safety. It is not evidence that
 * RLS works; that comes from tests/integration against a real local stack.
 */
import type { FetchLike } from '../src/transport.js';

export const ORIGIN = 'http://127.0.0.1:54321';
export const PUBLISHABLE = 'sb_publishable_TESTPUBLISHABLEKEY0001';
export const SECRET = 'sb_secret_TESTSECRETKEY000000000001';
export const USER_A = '5a1e0000-0000-4000-8000-00000000000a';
export const USER_B = '5a1e0000-0000-4000-8000-00000000000b';
export const INVOICE_A = '1a5e0000-0000-4000-8000-00000000000a';
export const INVOICE_B = '1a5e0000-0000-4000-8000-00000000000b';

export function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'ES256', typ: 'JWT' })}.${enc(payload)}.c2lnbmF0dXJlLW5vdC1jaGVja2VkLWhlcmU`;
}

export function userToken(sub: string, overrides: Record<string, unknown> = {}): string {
  return fakeJwt({
    iss: `${ORIGIN}/auth/v1`,
    sub,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    is_anonymous: false,
    session: Math.random().toString(36),
    ...overrides,
  });
}

export const LEGACY_ANON = fakeJwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 });
export const LEGACY_SERVICE = fakeJwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 });

export type Policy = 'owner-only' | 'permissive-authenticated' | 'permissive-all' | 'deny-all';

export interface Row {
  id: string;
  owner_id: string;
  fixture_marker: string;
  amount_cents?: number;
}

export interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

export interface FakeSupabase {
  fetch: FetchLike;
  requests: RecordedRequest[];
  rows: Row[];
  users: Map<string, { id: string; is_anonymous?: boolean }>;
  policy: Policy;
  override: ((req: RecordedRequest) => Response | Promise<Response> | undefined) | undefined;
}

export function defaultRows(): Row[] {
  return [
    { id: INVOICE_A, owner_id: USER_A, fixture_marker: 'synthetic-invoice-a', amount_cents: 1200 },
    { id: INVOICE_B, owner_id: USER_B, fixture_marker: 'synthetic-invoice-b', amount_cents: 3400 },
  ];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export function createFake(): FakeSupabase & { tokenA: string; tokenB: string } {
  const tokenA = userToken(USER_A);
  const tokenB = userToken(USER_B);
  const fake: FakeSupabase & { tokenA: string; tokenB: string } = {
    tokenA,
    tokenB,
    requests: [],
    rows: defaultRows(),
    users: new Map([
      [tokenA, { id: USER_A }],
      [tokenB, { id: USER_B }],
    ]),
    policy: 'owner-only',
    override: undefined,
    fetch: async (input, init) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const req: RecordedRequest = { url: new URL(input.href), headers };
      fake.requests.push(req);
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const o = fake.override?.(req);
      if (o) return await o;
      const bearer = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : null;
      if (req.url.pathname === '/auth/v1/user') {
        const u = bearer ? fake.users.get(bearer) : undefined;
        if (!u) return json(403, { code: 403, error_code: 'bad_jwt', msg: `invalid JWT ${bearer ?? ''}` });
        return json(200, { id: u.id, aud: 'authenticated', role: 'authenticated', email: `${u.id}@synthetic.test`, is_anonymous: u.is_anonymous ?? false });
      }
      if (req.url.pathname === '/rest/v1/invoices') {
        const isService = headers.apikey === SECRET || headers.apikey === LEGACY_SERVICE;
        const uid = bearer ? fake.users.get(bearer)?.id : undefined;
        const idFilter = req.url.searchParams.get('id') ?? '';
        let ids: string[] = [];
        if (idFilter.startsWith('eq.')) ids = [idFilter.slice(3)];
        else if (idFilter.startsWith('in.(')) ids = idFilter.slice(4, -1).split(',');
        let visible = fake.rows.filter((r) => ids.includes(r.id));
        if (!isService) {
          visible = visible.filter((r) => {
            switch (fake.policy) {
              case 'owner-only':
                return uid !== undefined && r.owner_id === uid;
              case 'permissive-authenticated':
                return uid !== undefined;
              case 'permissive-all':
                return true;
              case 'deny-all':
                return false;
            }
          });
        }
        const select = (req.url.searchParams.get('select') ?? '').split(',');
        return json(200, visible.map((r) => Object.fromEntries(select.map((c) => [c, (r as unknown as Record<string, unknown>)[c]]))));
      }
      return json(404, { code: 'PGRST205', message: 'not found' });
    },
  };
  return fake;
}

export function baseEnv(fake: { tokenA: string; tokenB: string }): Record<string, string> {
  return {
    ROWPROOF_SUPABASE_URL: ORIGIN,
    ROWPROOF_PUBLISHABLE_KEY: PUBLISHABLE,
    ROWPROOF_SETUP_SECRET_KEY: SECRET,
    ROWPROOF_USER_A_TOKEN: fake.tokenA,
    ROWPROOF_USER_B_TOKEN: fake.tokenB,
  };
}
