#!/usr/bin/env node
// RowProof real-HTTP integration harness (Phases 2-5 gate).
//
// Stage A  healthy disposable stack (repo ./supabase): real authorization behaviour
//          for the six assertions plus identity, credential, target and baseline controls.
// Stage B  separate THROWAWAY lab instance (copied config, unique project id): apply
//          deliberately broken policies/fixtures, confirm the runner reports them, then
//          destroy the instance and its volumes.
// Stage C  no stack running: confirm a real connection failure is blocked, never a pass.
//
// Always tears down. Writes only redacted artifacts to artifacts/integration/.
// WARNING: stops the local `rowproof-demo` stack and deletes its local data (--no-backup).
//
// Usage: pnpm integration      (requires Docker and `pnpm install`)
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { contentHashOf } from '../../packages/contracts/dist/index.js';
import {
  EXCLUDE,
  exists,
  fixtureCli,
  forgedToken,
  labSql,
  mintFromRealToken,
  readEnvFile,
  repo,
  runnerCli,
  sh,
  stackStatus,
  supabase,
} from './lib.mjs';

const RULE_FILE = join(repo, 'examples', 'invoice-owner-read.rule.json');
const RULE = JSON.parse(readFileSync(RULE_FILE, 'utf8'));
const RULE_ID = RULE.ruleId;
const USER_A = RULE.actors[0].expectedUserId;
const USER_B = RULE.actors[1].expectedUserId;
const INVOICE_B = RULE.fixtures[1].id;
const ORIGIN = RULE.target.allowedOrigin;

const work = mkdtempSync(join(tmpdir(), 'rowproof-it-'));
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = join(repo, 'artifacts', 'integration', runStamp);
mkdirSync(join(artifactDir, 'results'), { recursive: true });

const scenarios = [];
const sensitive = new Map(); // credential value -> non-secret label
const captured = [];
const resultFiles = [];
const started = new Set(); // workdirs with a running stack
let labDir = null;
let labProjectId = null;

function log(s) {
  process.stdout.write(`${s}\n`);
}

// ---------------------------------------------------------------- teardown
function stopStack(workdir) {
  const r = supabase(['stop', '--no-backup'], workdir, { timeout: 180_000 });
  started.delete(workdir);
  return r.code;
}
function teardown() {
  for (const w of [...started]) stopStack(w);
  if (labDir) rmSync(labDir, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`\n${sig}: tearing down`);
    teardown();
    rmSync(work, { recursive: true, force: true });
    process.exit(130);
  });
}

// ---------------------------------------------------------------- helpers
// Non-secret values that legitimately appear in output (the target origin) are never registered.
const NOT_SECRET = new Set(['ROWPROOF_SUPABASE_URL']);
function remember(label, value) {
  if (typeof value === 'string' && value.length >= 16) sensitive.set(value, label);
}
function rememberEnv(env, prefix) {
  for (const [k, v] of Object.entries(env)) if (!NOT_SECRET.has(k)) remember(`${prefix}:${k}`, v);
}

function startStack(workdir) {
  const r = supabase(['start', '-x', EXCLUDE], workdir, { timeout: 900_000 }); // stdout (keys) captured, not printed
  if (r.code !== 0) throw new Error(`supabase start failed in ${workdir}: ${r.stderr.slice(-400)}`);
  started.add(workdir);
  const s = stackStatus(workdir);
  for (const k of ['PUBLISHABLE_KEY', 'SECRET_KEY', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET']) remember(`status:${k}`, s[k]);
  return s;
}

function provision(workdir, out, ruleFile = RULE_FILE) {
  const r = sh('node', [fixtureCli, 'provision', '--rule', ruleFile, '--workdir', workdir, '--out', out, '--supabase-bin', join(repo, 'node_modules', '.bin', 'supabase')]);
  captured.push(r.stdout, r.stderr);
  if (r.code !== 0) throw new Error(`provision failed: ${r.stderr.trim()}`);
  const env = readEnvFile(out);
  rememberEnv(env, 'provisioned');
  return env;
}

function writeEnv(base, changes, name) {
  const env = { ...base };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  rememberEnv(env, name);
  const p = join(work, `${name}.env`);
  writeFileSync(p, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  return p;
}

function rowproofCli(args) {
  // Strip inherited ROWPROOF_* so only the env file supplies credentials.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ROWPROOF_')));
  const r = sh('node', [runnerCli, ...args], { env: clean, timeout: 120_000 });
  captured.push(r.stdout, r.stderr);
  return r;
}

let runCounter = 0;
function run(label, { store, envFile, rule = RULE_ID, extra = [] }) {
  const out = join(work, `${String(++runCounter).padStart(2, '0')}-${label}.json`);
  const r = rowproofCli(['run', '--store', store, '--rule', rule, '--env-file', envFile, '--out', out, '--execution-context', 'ci-development', ...extra]);
  const result = exists(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  if (result) resultFiles.push(out);
  return { code: r.code, result, stdout: r.stdout, stderr: r.stderr };
}

function approve(store, ruleFile, by = 'client-owner') {
  const p = join(work, `proposal-${Math.random().toString(36).slice(2, 8)}.json`);
  const pr = rowproofCli(['propose', '--rule', ruleFile, '--store', store, '--proposed-by', 'integration', '--out', p]);
  if (pr.code !== 0) throw new Error(`propose failed: ${pr.stderr}`);
  const hash = JSON.parse(readFileSync(p, 'utf8')).contentHash;
  const ap = rowproofCli(['approve', '--proposal', p, '--store', store, '--approver', by, '--acknowledge', hash, '--promote']);
  return { code: ap.code, stderr: ap.stderr, proposal: p, hash };
}

class Mismatch extends Error {}
function check(cond, message) {
  if (!cond) throw new Mismatch(message);
}
function statusOf(result, id) {
  const a = result?.assertions.find((x) => x.id === id);
  return a ? `${a.status}:${a.diagnostic}` : 'absent';
}
function controlOf(result, id) {
  const c = result?.controls.find((x) => x.id === id);
  return c ? `${c.status}:${c.diagnostic}` : 'absent';
}
function expectRun(r, { exit, assertions = {}, controls = {}, noPass = false }) {
  check(r.result !== null, `no result file (exit ${r.code}; ${r.stderr.trim().slice(0, 200)})`);
  check(r.code === exit, `exit ${r.code}, expected ${exit}`);
  check(r.result.summary.exitCode === exit, `result exitCode ${r.result.summary.exitCode}, expected ${exit}`);
  for (const [id, want] of Object.entries(assertions)) {
    const got = statusOf(r.result, id);
    check(want.includes(':') ? got === want : got.startsWith(`${want}:`), `${id} is ${got}, expected ${want}`);
  }
  for (const [id, want] of Object.entries(controls)) {
    const got = controlOf(r.result, id);
    check(want.includes(':') ? got === want : got.startsWith(`${want}:`), `control ${id} is ${got}, expected ${want}`);
  }
  if (noPass) check(r.result.summary.outcome !== 'pass', 'outcome must not be pass');
}

async function scenario(stage, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    scenarios.push({ stage, name, outcome: 'as-expected', ms: Date.now() - t0 });
    log(`  ok    ${name}`);
  } catch (e) {
    const detail = e instanceof Mismatch ? e.message : `harness error: ${e.message}`;
    scenarios.push({ stage, name, outcome: 'UNEXPECTED', detail, ms: Date.now() - t0 });
    log(`  FAIL  ${name}: ${detail}`);
  }
}

const ALL_PASSED = Object.fromEntries(RULE.expectations.map((e) => [e.id, 'passed:ok']));

// ---------------------------------------------------------------- main
async function main() {
  if (!exists(runnerCli) || !exists(fixtureCli)) {
    log('UNRUN: build output is missing. Run `pnpm build` first (or use `pnpm integration`, which builds).');
    return 2;
  }
  const docker = sh('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 30_000 });
  if (docker.code !== 0) {
    log('UNRUN: Docker is not available. Real integration tests did not execute. See docs/INTEGRATION.md.');
    return 2;
  }
  const cliVersion = sh(join(repo, 'node_modules', '.bin', 'supabase'), ['--version']).stdout.trim();
  const env0 = { node: process.version, docker: docker.stdout.trim(), supabaseCli: cliVersion, platform: process.platform };
  log(`RowProof integration harness  node ${env0.node}  docker ${env0.docker}  supabase CLI ${env0.supabaseCli}`);

  // ============================================================ Stage A
  log('\nStage A: healthy disposable stack');
  stopStack(repo); // clean start; deletes local demo data
  const status = startStack(repo);
  check(status.API_URL === ORIGIN, `stack API_URL ${status.API_URL} differs from rule origin ${ORIGIN}`);
  const healthyEnvFile = join(work, 'healthy.env');
  const henv = provision(repo, healthyEnvFile);
  const store = join(work, 'store');
  const ap = approve(store, RULE_FILE);
  check(ap.code === 0, `initial approval failed: ${ap.stderr}`);

  const legacyRule = structuredClone(RULE);
  legacyRule.ruleId = `${RULE_ID}-legacy-anon`;
  legacyRule.target.apiKey = { kind: 'legacy-anon', credential: { source: 'env', name: 'ROWPROOF_LEGACY_ANON_KEY' } };
  const legacyRuleFile = join(work, 'legacy.rule.json');
  writeFileSync(legacyRuleFile, JSON.stringify(legacyRule, null, 2));
  check(approve(store, legacyRuleFile).code === 0, 'legacy rule approval failed');

  await scenario('A', 'healthy owner-only policy: six assertions pass, exit 0', () => {
    const r = run('healthy', { store, envFile: healthyEnvFile });
    expectRun(r, { exit: 0, assertions: ALL_PASSED });
    check(r.result.controls.every((c) => c.status === 'ok'), 'all controls ok');
    check(r.result.summary.completeness === 'complete', 'complete');
    check(r.result.freshness.state === 'unknown', 'freshness unknown without observer');
  });

  await scenario('A', 'runner identity check agrees with supabase-js getUser(jwt)', async () => {
    const client = createClient(ORIGIN, henv.ROWPROOF_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const a = await client.auth.getUser(henv.ROWPROOF_USER_A_TOKEN);
    const b = await client.auth.getUser(henv.ROWPROOF_USER_B_TOKEN);
    check(!a.error && a.data.user?.id === USER_A, 'getUser(A) returns user A');
    check(!b.error && b.data.user?.id === USER_B, 'getUser(B) returns user B');
    const forged = forgedToken(USER_B, `${ORIGIN}/auth/v1`);
    const f = await client.auth.getUser(forged);
    check(f.error !== null, 'getUser rejects a forged token');
    const r = run('forged-token', { store, envFile: writeEnv(henv, { ROWPROOF_USER_B_TOKEN: forged }, 'forged') });
    expectRun(r, { exit: 2, controls: { 'identity:user-b': 'failed:token_rejected_by_auth' }, noPass: true });
  });

  await scenario('A', 'same-user sessions (B token is A) cannot produce an isolation pass', () => {
    const r = run('same-user', { store, envFile: writeEnv(henv, { ROWPROOF_USER_B_TOKEN: henv.ROWPROOF_USER_A_TOKEN }, 'same-user') });
    expectRun(r, {
      exit: 2,
      controls: { 'identity:user-b': 'failed:user_id_mismatch' },
      assertions: { 'a-reads-a': 'passed', 'b-reads-a': 'blocked:actor_unverified', 'a-reads-b': 'blocked' },
      noPass: true,
    });
  });

  await scenario('A', 'expired token is rejected by the real Auth service and blocked', () => {
    const expired = mintFromRealToken(henv.ROWPROOF_USER_A_TOKEN, status.JWT_SECRET, Math.floor(Date.now() / 1000) - 120);
    remember('minted:expired', expired);
    const r = run('expired-token', { store, envFile: writeEnv(henv, { ROWPROOF_USER_A_TOKEN: expired }, 'expired') });
    expectRun(r, { exit: 2, controls: { 'identity:user-a': 'failed:token_rejected_by_auth' }, noPass: true });
  });

  await scenario('A', 'token accepted by Auth but about to expire is blocked by the runner', async () => {
    const soon = mintFromRealToken(henv.ROWPROOF_USER_A_TOKEN, status.JWT_SECRET, Math.floor(Date.now() / 1000) + 30);
    remember('minted:expiring', soon);
    const client = createClient(ORIGIN, henv.ROWPROOF_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const g = await client.auth.getUser(soon);
    check(!g.error && g.data.user?.id === USER_A, 'precondition: Auth accepts the near-expiry token');
    const r = run('expiring-token', { store, envFile: writeEnv(henv, { ROWPROOF_USER_A_TOKEN: soon }, 'expiring') });
    expectRun(r, { exit: 2, controls: { 'identity:user-a': 'failed:token_expired_or_expiring' }, noPass: true });
  });

  await scenario('A', 'elevated credentials are refused in user and application-key contexts', () => {
    const cases = [
      ['secret-as-user', { ROWPROOF_USER_A_TOKEN: status.SECRET_KEY }, 'identity:user-a', 'failed:token_elevated_role'],
      ['service-role-as-user', { ROWPROOF_USER_A_TOKEN: status.SERVICE_ROLE_KEY }, 'identity:user-a', 'failed:token_elevated_role'],
      ['secret-as-app-key', { ROWPROOF_PUBLISHABLE_KEY: status.SECRET_KEY }, 'api-key', 'failed:api_key_elevated'],
      ['service-role-as-app-key', { ROWPROOF_PUBLISHABLE_KEY: status.SERVICE_ROLE_KEY }, 'api-key', 'failed:api_key_elevated'],
    ];
    for (const [label, change, controlId, want] of cases) {
      const r = run(label, { store, envFile: writeEnv(henv, change, label) });
      expectRun(r, { exit: 2, controls: { [controlId]: want }, noPass: true });
      check(r.result.summary.counts.passed <= 3, `${label}: no isolation pass for the affected actor`);
    }
  });

  await scenario('A', 'legacy anon key works only when the rule declares it', () => {
    const ok = run('legacy-anon-declared', { store, envFile: healthyEnvFile, rule: legacyRule.ruleId });
    expectRun(ok, { exit: 0, assertions: ALL_PASSED });
    const bad = run('legacy-anon-undeclared', { store, envFile: writeEnv(henv, { ROWPROOF_PUBLISHABLE_KEY: henv.ROWPROOF_LEGACY_ANON_KEY }, 'legacy-undeclared') });
    expectRun(bad, { exit: 2, controls: { 'api-key': 'failed:api_key_wrong_class' } });
  });

  await scenario('A', 'a target URL other than the approved origin is refused before any request', () => {
    for (const [label, url] of [['localhost-alias', 'http://localhost:54321'], ['other-port', 'http://127.0.0.1:54322'], ['remote', 'https://example.com']]) {
      const r = run(`target-${label}`, { store, envFile: writeEnv(henv, { ROWPROOF_SUPABASE_URL: url }, `target-${label}`) });
      expectRun(r, { exit: 2, controls: { target: 'failed:origin_mismatch' } });
      check(r.result.assertions.every((a) => a.diagnostic === 'target_unverified'), 'all assertions blocked as target_unverified');
    }
  });

  await scenario('A', 'missing setup channel blocks fixture verification and every pass', () => {
    const r = run('no-setup-key', { store, envFile: writeEnv(henv, { ROWPROOF_SETUP_SECRET_KEY: undefined }, 'no-setup') });
    expectRun(r, { exit: 2, controls: { 'setup-key': 'failed:setup_key_missing' }, noPass: true });
    check(r.result.summary.counts.passed === 0, 'no assertion passes without fixture verification');
  });

  await scenario('A', 'baseline pins: wrong hash blocked, correct pin passes; tampered store blocked', () => {
    expectRun(run('pin-wrong', { store, envFile: healthyEnvFile, extra: ['--expect-hash', `sha256:${'0'.repeat(64)}`] }), {
      exit: 2,
      controls: { baseline: 'failed:baseline_pin_mismatch' },
    });
    expectRun(run('pin-right', { store, envFile: healthyEnvFile, extra: ['--revision', '1', '--expect-hash', ap.hash] }), { exit: 0 });
    const tampered = join(work, 'tampered-store');
    cpSync(store, tampered, { recursive: true });
    const revFile = join(tampered, RULE_ID, 'revisions', 'r000001.json');
    const rev = JSON.parse(readFileSync(revFile, 'utf8'));
    rev.content.expectations.find((e) => e.id === 'a-reads-b').expected = 'exact_fixture_returned';
    writeFileSync(revFile, JSON.stringify(rev, null, 2));
    expectRun(run('tampered-store', { store: tampered, envFile: healthyEnvFile }), { exit: 2, controls: { baseline: 'failed:baseline_invalid' } });
  });

  await scenario('A', 'request budget is enforced against the real stack', () => {
    const r = run('budget', { store, envFile: healthyEnvFile, extra: ['--max-requests', '4'] });
    expectRun(r, { exit: 2, noPass: true });
    check(r.result.assertions.some((a) => a.diagnostic === 'request_budget_exhausted'), 'budget exhaustion reported');
  });

  check(stopStack(repo) === 0, 'healthy stack stopped');

  // ============================================================ Stage B
  log('\nStage B: separate throwaway lab instance');
  labProjectId = `rowproof-lab-${Math.random().toString(36).slice(2, 10)}`;
  labDir = join(work, 'lab');
  mkdirSync(labDir, { recursive: true });
  cpSync(join(repo, 'supabase'), join(labDir, 'supabase'), {
    recursive: true,
    filter: (src) => !/[\\/]\.(temp|branches)([\\/]|$)/.test(src),
  });
  const cfgPath = join(labDir, 'supabase', 'config.toml');
  writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace(/^project_id = ".*"$/m, `project_id = "${labProjectId}"`));
  const labStatus = startStack(labDir);
  check(labStatus.API_URL === ORIGIN, 'lab stack serves the approved origin');
  let lenv = provision(labDir, join(work, 'lab.env'));
  const labEnvFile = join(work, 'lab.env');

  const resetLab = () => {
    const r = supabase(['db', 'reset'], labDir, { timeout: 300_000 });
    if (r.code !== 0) throw new Error(`lab db reset failed: ${r.stderr.slice(-300)}`);
    lenv = provision(labDir, labEnvFile);
  };

  await scenario('B', 'lab instance starts from the same healthy boundary', () => {
    expectRun(run('lab-healthy', { store, envFile: labEnvFile }), { exit: 0, assertions: ALL_PASSED });
  });

  await scenario('B', 'deliberately permissive SELECT policy: cross-user disclosure fails, exit 1', () => {
    labSql(labProjectId, readFileSync(join(repo, 'supabase', 'lab', 'permissive-select.sql'), 'utf8'));
    const r = run('lab-permissive', { store, envFile: labEnvFile });
    expectRun(r, {
      exit: 1,
      assertions: {
        'a-reads-a': 'passed:ok',
        'b-reads-b': 'passed:ok',
        'a-reads-b': 'failed:fixture_disclosed',
        'b-reads-a': 'failed:fixture_disclosed',
        'anon-reads-a': 'passed:ok',
        'anon-reads-b': 'passed:ok',
      },
    });
    check(r.stdout.includes('FAIL'), 'summary shows the failure');
  });

  await scenario('B', 'weakening the proposed rule alongside the broken policy cannot replace the approved baseline', () => {
    const weakened = structuredClone(RULE);
    for (const e of weakened.expectations) if (e.id === 'a-reads-b' || e.id === 'b-reads-a') e.expected = 'exact_fixture_returned';
    const weakFile = join(work, 'weakened.rule.json');
    writeFileSync(weakFile, JSON.stringify(weakened, null, 2));
    const attempt = approve(store, weakFile, 'ai-coding-session');
    check(attempt.code === 2 && attempt.stderr.includes('proposal_unsupported'), 'weakened approval is refused');
    // Editing the rule file in the working tree changes nothing either: run reads the approved store.
    const r = run('lab-permissive-after-weakening', { store, envFile: labEnvFile, extra: ['--expect-hash', ap.hash] });
    expectRun(r, { exit: 1, assertions: { 'a-reads-b': 'failed:fixture_disclosed' } });
  });

  await scenario('B', 'the baseline is read from the protected ref; a forged approval in the PR tree is ignored', () => {
    // A throwaway git repo: `main` holds the approved store; branch `pr` changes the app AND forges a
    // fully hash-consistent weakened revision 2 + promotion + active pointer in its own tree.
    const gitRepo = join(work, 'trusted-repo');
    mkdirSync(gitRepo);
    const git = (...args) => {
      const r = sh('git', ['-C', gitRepo, '-c', 'user.name=rowproof-it', '-c', 'user.email=it@synthetic.rowproof.test', '-c', 'commit.gpgsign=false', ...args]);
      if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
      return r.stdout;
    };
    git('init', '-q', '-b', 'main');
    cpSync(store, join(gitRepo, 'baseline'), { recursive: true });
    git('add', '-A');
    git('commit', '-q', '-m', 'approved baseline');
    git('checkout', '-q', '-b', 'pr');
    const ruleDir = join(gitRepo, 'baseline', RULE_ID);
    const rev1 = JSON.parse(readFileSync(join(ruleDir, 'revisions', 'r000001.json'), 'utf8'));
    const forged = structuredClone(rev1);
    for (const e of forged.content.expectations) if (e.id === 'a-reads-b' || e.id === 'b-reads-a') e.expected = 'exact_fixture_returned';
    const h = contentHashOf(forged.content);
    Object.assign(forged, { revision: 2, contentHash: h });
    Object.assign(forged.approval, { revision: 2, contentHash: h, acknowledgedHash: h, supersedes: { revision: 1, contentHash: rev1.contentHash } });
    writeFileSync(join(ruleDir, 'revisions', 'r000002.json'), JSON.stringify(forged, null, 2));
    writeFileSync(join(ruleDir, 'promotions', 'p000002.json'), JSON.stringify({ kind: 'Promotion', schemaVersion: 1, ruleId: RULE_ID, sequence: 2, revision: 2, contentHash: h, promotedBy: 'pr-author', promotedAt: new Date().toISOString(), previous: { revision: 1, contentHash: rev1.contentHash } }, null, 2));
    writeFileSync(join(ruleDir, 'active.json'), JSON.stringify({ kind: 'ActiveBaseline', schemaVersion: 1, ruleId: RULE_ID, revision: 2, contentHash: h, promotionSequence: 2 }, null, 2));
    writeFileSync(join(gitRepo, 'app-change.sql'), '-- the application change that broke the policy\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'PR: change app and weaken rule');

    // Trusted assessment: baseline materialized from `main`, never from the PR working tree.
    const trusted = join(work, 'trusted-from-main');
    const f = sh('node', [join(repo, 'scripts', 'fetch-trusted-baseline.mjs'), '--repo', gitRepo, '--ref', 'main', '--path', 'baseline', '--out', trusted]);
    check(f.code === 0, `fetch-trusted-baseline failed: ${f.stderr}`);
    const t = run('boundary-trusted-main', { store: trusted, envFile: labEnvFile });
    expectRun(t, { exit: 1, assertions: { 'a-reads-b': 'failed:fixture_disclosed', 'b-reads-a': 'failed:fixture_disclosed' } });
    check(t.result.rule.revision === 1 && t.result.rule.contentHash === ap.hash, 'assessment used approved revision 1 from main');

    // Even the PR tree's forged store cannot turn the disclosure green: the forged intent is outside v1 scope.
    const p = run('boundary-pr-tree', { store: join(gitRepo, 'baseline'), envFile: labEnvFile });
    check(p.code !== 0 && p.result.summary.outcome !== 'pass', 'forged PR baseline never produces a pass');
    check(p.result.assertions.every((a) => a.status === 'not_assessed' && a.diagnostic === 'unsupported_expectation'), 'forged intent is not assessed');
  });

  await scenario('B', 'policy open to anonymous: anonymous disclosures fail', () => {
    resetLab();
    labSql(labProjectId, 'create policy rowproof_lab_anon_open on public.invoices for select to anon using (true);');
    const r = run('lab-anon-open', { store, envFile: labEnvFile });
    expectRun(r, { exit: 1, assertions: { 'anon-reads-a': 'failed:fixture_disclosed', 'anon-reads-b': 'failed:fixture_disclosed', 'a-reads-b': 'passed:ok' } });
  });

  await scenario('B', 'owner policy removed: denied owner access fails; dependent denials blocked', () => {
    resetLab();
    labSql(labProjectId, 'drop policy invoices_owner_select on public.invoices;');
    const r = run('lab-owner-denied', { store, envFile: labEnvFile });
    expectRun(r, {
      exit: 1,
      assertions: {
        'a-reads-a': 'failed:owner_read_returned_no_rows',
        'b-reads-b': 'failed:owner_read_returned_no_rows',
        'a-reads-b': 'blocked:owner_control_not_passed',
        'anon-reads-a': 'blocked:owner_control_not_passed',
      },
    });
    check(r.result.summary.completeness === 'incomplete', 'reported incomplete');
  });

  await scenario('B', 'SELECT grant revoked: owner read forbidden is failed; 403 is never a denial pass', () => {
    resetLab();
    labSql(labProjectId, 'revoke select on public.invoices from authenticated;');
    const r = run('lab-grant-revoked', { store, envFile: labEnvFile });
    expectRun(r, { exit: 1, assertions: { 'a-reads-a': 'failed:owner_read_forbidden', 'a-reads-b': 'blocked', 'anon-reads-a': 'blocked:owner_control_not_passed' } });
  });

  await scenario('B', 'missing fixture is blocked, not passed', () => {
    resetLab();
    labSql(labProjectId, `delete from public.invoices where id = '${INVOICE_B}';`);
    const r = run('lab-fixture-missing', { store, envFile: labEnvFile });
    expectRun(r, {
      exit: 2,
      controls: { 'fixture:invoice-b': 'failed:fixture_missing' },
      assertions: { 'b-reads-b': 'blocked:fixture_unverified', 'a-reads-b': 'blocked:fixture_unverified', 'a-reads-a': 'passed' },
      noPass: true,
    });
  });

  await scenario('B', 'wrong-owner fixture is blocked, not mistaken for a disclosure or a pass', () => {
    resetLab();
    labSql(labProjectId, `update public.invoices set owner_id = '${USER_A}' where id = '${INVOICE_B}';`);
    const r = run('lab-fixture-wrong-owner', { store, envFile: labEnvFile });
    expectRun(r, { exit: 2, controls: { 'fixture:invoice-b': 'failed:fixture_owner_mismatch' }, noPass: true });
    check(r.result.summary.counts.failed === 0, 'no false disclosure');
  });

  await scenario('B', 'wrong-marker fixture is blocked', () => {
    resetLab();
    labSql(labProjectId, `update public.invoices set fixture_marker = 'synthetic-tampered' where id = '${INVOICE_B}';`);
    const r = run('lab-fixture-wrong-marker', { store, envFile: labEnvFile });
    expectRun(r, { exit: 2, controls: { 'fixture:invoice-b': 'failed:fixture_marker_mismatch' }, noPass: true });
  });

  await scenario('B', 'lab instance and its volumes are destroyed', () => {
    check(stopStack(labDir) === 0, 'lab stop succeeded');
    const ps = sh('docker', ['ps', '-a', '--filter', `name=${labProjectId}`, '--format', '{{.Names}}']).stdout.trim();
    const vols = sh('docker', ['volume', 'ls', '--filter', `name=${labProjectId}`, '--format', '{{.Name}}']).stdout.trim();
    check(ps === '', `lab containers remain: ${ps}`);
    check(vols === '', `lab volumes remain: ${vols}`);
    rmSync(labDir, { recursive: true, force: true });
    labDir = null;
  });

  // ============================================================ Stage C
  log('\nStage C: no stack running');
  await scenario('C', 'connection refused is blocked, never a pass', () => {
    const r = run('no-stack', { store, envFile: healthyEnvFile });
    expectRun(r, { exit: 2, controls: { 'fixture:invoice-a': 'failed:network_error' }, noPass: true });
    check(r.result.summary.counts.passed === 0, 'nothing passes');
  });

  // ============================================================ Output safety
  await scenario('safety', 'no credential appears in any runner/fixture output or result file', () => {
    const texts = [
      ...captured.map((t, i) => [`captured output #${i}`, t]),
      ...resultFiles.map((f) => [`result ${f.split(/[\\/]/).pop()}`, readFileSync(f, 'utf8')]),
    ];
    for (const [where, t] of texts) {
      for (const [v, label] of sensitive) check(!t.includes(v), `${label} appeared in ${where}`);
      check(!/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]/.test(t), `credential-shaped text appeared in ${where}`);
    }
    check(sensitive.size >= 8, 'leak scan covered the loaded credentials');
  });

  // ============================================================ Artifacts
  for (const f of resultFiles) cpSync(f, join(artifactDir, 'results', f.split(/[\\/]/).pop()));
  const failed = scenarios.filter((s) => s.outcome !== 'as-expected');
  const summary = {
    kind: 'RowProofIntegrationSummary',
    ranAt: new Date().toISOString(),
    environment: env0,
    scenarios,
    totals: { scenarios: scenarios.length, asExpected: scenarios.length - failed.length, unexpected: failed.length },
    note: 'Real HTTP against disposable local Supabase stacks with synthetic fixtures. Not evidence about any other environment.',
  };
  writeFileSync(join(artifactDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  log(`\n${summary.totals.asExpected}/${summary.totals.scenarios} scenarios behaved as expected. Artifacts: ${artifactDir}`);
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  log(`\nHARNESS ERROR: ${e.message}`);
  code = 2;
} finally {
  teardown();
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
