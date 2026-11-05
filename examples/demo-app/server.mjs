#!/usr/bin/env node
// A tiny invoice app used to show what Pyx checks on an application route.
// It serves GET /api/invoices/:id on 127.0.0.1 and has two modes:
//
//   healthy          forwards the caller's access token to the Supabase Data API,
//                    so the table's RLS policy decides what comes back.
//   service-key-bug  the common server-side mistake: it checks that the caller is
//                    signed in, then fetches the invoice with the SECRET key, which
//                    bypasses RLS. Any signed-in user can read any invoice.
//
// Synthetic local data only. It never prints a key or a token.
//
// Usage:
//   node examples/demo-app/server.mjs --credentials .pyx/local.env [--mode healthy|service-key-bug] [--port 8787]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';

const { values } = parseArgs({
  options: {
    credentials: { type: 'string' },
    mode: { type: 'string', default: 'healthy' },
    port: { type: 'string', default: '8787' },
  },
});
if (!values.credentials) {
  process.stderr.write('missing --credentials <env file> (the file `pyx fixture provision` wrote)\n');
  process.exit(2);
}
if (!['healthy', 'service-key-bug'].includes(values.mode)) {
  process.stderr.write('--mode must be healthy or service-key-bug\n');
  process.exit(2);
}
const env = parseEnv(readFileSync(values.credentials, 'utf8'));
const SUPABASE = env.PYX_SUPABASE_URL;
const PUBLISHABLE = env.PYX_PUBLISHABLE_KEY;
const SECRET = env.PYX_SETUP_SECRET_KEY;
if (!SUPABASE || !PUBLISHABLE || (values.mode === 'service-key-bug' && !SECRET)) {
  process.stderr.write('the credentials file lacks PYX_SUPABASE_URL / PYX_PUBLISHABLE_KEY (and PYX_SETUP_SECRET_KEY for the bug mode)\n');
  process.exit(2);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SELECT = 'id,owner_id,fixture_marker,amount_cents';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function signedInUser(token) {
  const r = await fetch(`${SUPABASE}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === 'string' ? u : null;
}

async function loadInvoice(id, token) {
  const url = `${SUPABASE}/rest/v1/invoices?select=${SELECT}&id=eq.${id}&limit=1`;
  const headers =
    values.mode === 'healthy'
      ? { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } // RLS applies as the caller
      : { apikey: SECRET }; // BUG: the secret key bypasses RLS
  const r = await fetch(url, { headers });
  if (!r.ok) return { error: r.status };
  const rows = await r.json();
  return { row: rows[0] ?? null };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const m = /^\/api\/invoices\/([^/]+)$/.exec(url.pathname);
    if (req.method !== 'GET' || !m) return send(res, 404, { error: 'not found' });
    const id = m[1].toLowerCase();
    if (!UUID.test(id)) return send(res, 404, { error: 'not found' });
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return send(res, 401, { error: 'sign in required' });
    if (values.mode === 'service-key-bug' && !(await signedInUser(token))) return send(res, 401, { error: 'sign in required' });
    const { row, error } = await loadInvoice(id, token);
    if (error === 401 || error === 403) return send(res, 401, { error: 'sign in required' });
    if (error) return send(res, 502, { error: 'upstream error' });
    if (!row) return send(res, 404, { error: 'not found' });
    return send(res, 200, { invoice: row });
  } catch {
    return send(res, 500, { error: 'internal error' });
  }
});

server.listen(Number(values.port), '127.0.0.1', () => {
  process.stdout.write(`demo app (${values.mode}) listening on http://127.0.0.1:${values.port}\n`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
