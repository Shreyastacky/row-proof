#!/usr/bin/env node
// Disposable local Supabase stack lifecycle for the RowProof demo.
//
//   node scripts/stack.mjs up      [--workdir <dir>]   start Postgres, Auth, PostgREST, gateway
//   node scripts/stack.mjs reset   [--workdir <dir>]   re-apply migrations to the LOCAL database
//   node scripts/stack.mjs down    [--workdir <dir>]   stop and DELETE local volumes (--no-backup)
//   node scripts/stack.mjs status  [--workdir <dir>]   show non-secret status
//
// Uses the pinned Supabase CLI from node_modules. Refuses to operate on a
// directory that has been linked to a hosted project.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');

// Services the demo does not need. Config already disables most; listing them is explicit and harmless.
const EXCLUDE = 'studio,postgres-meta,imgproxy,vector,logflare,supavisor,storage-api,edge-runtime,realtime,mailpit';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { workdir: { type: 'string' } } });
const command = positionals[0];
const workdir = resolve(values.workdir ?? repo);

if (!existsSync(bin)) {
  console.error('Supabase CLI not found. Run `pnpm install` first.');
  process.exit(2);
}
if (existsSync(join(workdir, 'supabase', '.temp', 'project-ref'))) {
  console.error('Refusing: this directory is linked to a hosted Supabase project. The demo stack is local-only.');
  process.exit(2);
}

const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
function supabase(args, { quiet = false } = {}) {
  const r = spawnSync(bin, [...args, '--workdir', workdir], { stdio: quiet ? ['ignore', 'pipe', 'inherit'] : 'inherit', env, shell: process.platform === 'win32' });
  return r.status ?? 2;
}

let code;
switch (command) {
  case 'up':
    // `supabase start` prints every key to stdout when stdout is not a terminal (e.g. CI).
    // Capture and discard stdout so keys never reach logs; progress still goes to stderr.
    code = supabase(['start', '-x', EXCLUDE], { quiet: true });
    if (code === 0) console.log('Local stack is up. Keys were not printed; `pnpm fixture:provision` writes them to .rowproof/local.env (mode 0600).');
    break;
  case 'reset':
    code = supabase(['db', 'reset']);
    break;
  case 'down':
    code = supabase(['stop', '--no-backup']);
    break;
  case 'status': {
    const r = spawnSync(bin, ['status', '-o', 'json', '--workdir', workdir], { env, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error('stack is not running');
      code = 2;
      break;
    }
    const s = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    // Print only non-secret fields.
    console.log(JSON.stringify({ API_URL: s.API_URL, REST_URL: s.REST_URL, DB_URL_HOST: s.DB_URL ? new URL(s.DB_URL).host : null }, null, 2));
    code = 0;
    break;
  }
  default:
    console.error('usage: node scripts/stack.mjs up|reset|down|status [--workdir <dir>]');
    code = 2;
}
process.exit(code);
