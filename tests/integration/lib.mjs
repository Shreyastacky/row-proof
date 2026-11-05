// Shared helpers for the real-HTTP integration harness. Plain ESM, no build step.
import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const repo = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const supabaseBin = join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');
export const runnerCli = join(repo, 'packages', 'runner', 'dist', 'cli.js');
export const fixtureCli = join(repo, 'packages', 'local-fixture', 'dist', 'cli.js');
export const EXCLUDE = 'studio,postgres-meta,imgproxy,vector,logflare,supavisor,storage-api,edge-runtime,realtime,mailpit';

const baseEnv = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };

/** Run a command; never inherit stdout (CLIs can print keys). Returns code/stdout/stderr. */
export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repo,
    env: { ...baseEnv, ...(opts.env ?? {}) },
    input: opts.input,
    encoding: 'utf8',
    timeout: opts.timeout ?? 600_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { code: r.status ?? (r.signal ? 128 : 2), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function supabase(args, workdir, opts = {}) {
  return sh(supabaseBin, [...args, '--workdir', workdir], opts);
}

export function stackStatus(workdir) {
  const r = supabase(['status', '-o', 'json'], workdir, { timeout: 60_000 });
  if (r.code !== 0) throw new Error(`supabase status failed for ${workdir}`);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
}

export function readEnvFile(path) {
  return parseEnv(readFileSync(path, 'utf8'));
}

/** Apply SQL inside a LAB instance's own database container. Refuses anything else. */
export function labSql(projectId, sql) {
  if (!/^ship-safe-lab-[a-z0-9]+$/.test(projectId)) throw new Error('labSql refuses non-lab projects');
  const container = `supabase_db_${projectId}`;
  const r = sh('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: sql,
    timeout: 60_000,
  });
  if (r.code !== 0) throw new Error(`lab SQL failed: ${r.stderr.slice(0, 300)}`);
}

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

/**
 * Setup-channel token minting for negative tests: re-sign a real token's claims with
 * the local stack's legacy HS256 secret and a chosen expiry. Local disposable stacks only.
 */
export function mintFromRealToken(realToken, jwtSecret, exp) {
  const claims = { ...decodePayload(realToken), exp, iat: exp - 3600 };
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url(claims);
  return `${h}.${p}.${createHmac('sha256', jwtSecret).update(`${h}.${p}`).digest('base64url')}`;
}

/** A structurally valid user JWT with a forged signature (wrong signing key / other project). */
export function forgedToken(sub, iss) {
  const h = b64url({ alg: 'ES256', typ: 'JWT', kid: randomUUID() });
  const p = b64url({ iss, sub, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, session_id: randomUUID(), is_anonymous: false });
  return `${h}.${p}.${Buffer.from('not-a-valid-signature-for-this-project').toString('base64url')}`;
}

export function exists(p) {
  return existsSync(p);
}
