// Shared helpers for the real-HTTP integration harness. Plain ESM, no build step.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
export const supabaseBin = join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');
export const runnerCli = join(repo, 'packages', 'runner', 'dist', 'cli.js');
export const fixtureCli = join(repo, 'packages', 'local-fixture', 'dist', 'bin.js');
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

function psqlIn(projectId, sql) {
  const container = `supabase_db_${projectId}`;
  return sh('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: sql,
    timeout: 60_000,
  });
}

/**
 * Bind this harness to the lab instance it created: write a random nonce into the
 * lab database (a schema the Data API does not expose). Every later mutation first
 * proves, inside the same psql session, that it is talking to that database.
 * A container name or URL alone is not enough: another stack could own them.
 * Must be called again after `supabase db reset`, which recreates the database.
 */
export function bindLab(projectId) {
  if (!/^pyx-lab-[a-z0-9]+$/.test(projectId)) throw new Error('bindLab refuses non-lab projects');
  const nonce = randomUUID();
  const r = psqlIn(
    projectId,
    `create schema if not exists pyx_lab; revoke all on schema pyx_lab from public;
     create table if not exists pyx_lab.instance (nonce uuid not null);
     delete from pyx_lab.instance; insert into pyx_lab.instance values ('${nonce}');`,
  );
  if (r.code !== 0) throw new Error(`lab binding failed: ${r.stderr.slice(0, 300)}`);
  return nonce;
}

/** Apply SQL inside a LAB instance's own database, only if it holds this harness's nonce. */
export function labSql(projectId, nonce, sql) {
  if (!/^pyx-lab-[a-z0-9]+$/.test(projectId)) throw new Error('labSql refuses non-lab projects');
  if (!/^[0-9a-f-]{36}$/.test(nonce ?? '')) throw new Error('labSql requires the instance nonce from bindLab');
  const guard = `do $pyx$ begin
    if not exists (select 1 from pyx_lab.instance where nonce = '${nonce}') then
      raise exception 'pyx: this database is not the lab instance this harness created';
    end if;
  end $pyx$;\n`;
  const r = psqlIn(projectId, guard + sql);
  if (r.code !== 0) throw new Error(`lab SQL failed: ${r.stderr.slice(0, 300)}`);
}

/** True when the lab project's own gateway container publishes the given loopback port. */
export function labServesPort(projectId, port) {
  const r = sh('docker', ['port', `supabase_kong_${projectId}`], { timeout: 30_000 });
  return r.code === 0 && r.stdout.split('\n').some((l) => l.trim().endsWith(`:${port}`));
}

/** Start the demo app (examples/demo-app) on 127.0.0.1:8787 and wait until it listens. */
export function startDemoApp(credentialsFile, mode) {
  const child = spawn(process.execPath, [join(repo, 'examples', 'demo-app', 'server.mjs'), '--credentials', credentialsFile, '--mode', mode, '--port', '8787'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '' },
  });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo app did not start')), 15_000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`demo app exited (${code})`));
    });
  });
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  return { ready, stop, output: () => out, child };
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
