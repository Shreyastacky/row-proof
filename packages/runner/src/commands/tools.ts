/**
 * Onboarding and reporting commands: init, report, doctor.
 * None of these write approvals; doctor and report never print credential values.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BaselineError,
  openFileBaselineReader,
  parseExactOrigin,
  parseStrictJson,
  StrictJsonError,
  validateRuleContent,
  validateSchema,
  type AuthenticatedActor,
  type RuleContent,
  type RunResult,
} from '@pyx/contracts';
import { classifyApiKey, decodeJwtUnverified, isElevated, precheckUserToken } from '../credentials.js';
import { DEFAULT_LIMITS, plannedPaths } from '../engine.js';
import { renderHtmlReport } from '../html-report.js';
import { loadEnvFile, readTextFile, requireString, RUNNER_VERSION, UsageError, type CliIO } from '../io.js';
import { assertOutputSafe } from '../report.js';
import { BoundedFetchTransport } from '../transport.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

// ---------------------------------------------------------------- init
export function scaffoldRule(o: {
  table: string;
  ownerColumn: string;
  idColumn: string;
  markerColumn: string;
  schema: string;
  ruleId: string;
  projectId: string;
  origin: string;
  noun: string;
}): RuleContent {
  const ua = randomUUID();
  const ub = randomUUID();
  const fa = randomUUID();
  const fb = randomUUID();
  const n = o.noun;
  return {
    kind: 'RuleContent',
    schemaVersion: 1,
    ruleId: o.ruleId,
    title: `Each user reads only their own ${n} through the Data API`.slice(0, 120),
    scope: { organizationId: null, projectId: o.projectId, environmentId: 'local-disposable' },
    target: {
      adapter: 'supabase',
      environmentClass: 'local-disposable',
      allowedOrigin: o.origin,
      apiKey: { kind: 'publishable', credential: { source: 'env', name: 'PYX_PUBLISHABLE_KEY' } },
      fixtureVerification: { channel: 'supabase-secret-key', credential: { source: 'env', name: 'PYX_SETUP_SECRET_KEY' } },
    },
    resource: {
      schema: o.schema,
      table: o.table,
      operation: 'select',
      route: 'supabase-data-api-rest-v1',
      ownershipModel: 'single-owner-column',
      idColumn: o.idColumn,
      ownerColumn: o.ownerColumn,
      markerColumn: o.markerColumn,
    },
    actors: [
      { ref: 'user-a', kind: 'authenticated', expectedUserId: ua, credential: { source: 'env', name: 'PYX_USER_A_TOKEN' } },
      { ref: 'user-b', kind: 'authenticated', expectedUserId: ub, credential: { source: 'env', name: 'PYX_USER_B_TOKEN' } },
      { ref: 'anonymous', kind: 'anonymous' },
    ],
    fixtures: [
      { ref: `${n}-a`, id: fa, ownerRef: 'user-a', marker: `synthetic-${n}-a` },
      { ref: `${n}-b`, id: fb, ownerRef: 'user-b', marker: `synthetic-${n}-b` },
    ],
    expectations: [
      { id: 'a-reads-a', actorRef: 'user-a', fixtureRef: `${n}-a`, expected: 'exact_fixture_returned' },
      { id: 'b-reads-b', actorRef: 'user-b', fixtureRef: `${n}-b`, expected: 'exact_fixture_returned' },
      { id: 'a-reads-b', actorRef: 'user-a', fixtureRef: `${n}-b`, expected: 'fixture_not_disclosed' },
      { id: 'b-reads-a', actorRef: 'user-b', fixtureRef: `${n}-a`, expected: 'fixture_not_disclosed' },
      { id: 'anon-reads-a', actorRef: 'anonymous', fixtureRef: `${n}-a`, expected: 'fixture_not_disclosed' },
      { id: 'anon-reads-b', actorRef: 'anonymous', fixtureRef: `${n}-b`, expected: 'fixture_not_disclosed' },
    ],
    declaredScope: {
      covers: `SELECT of two synthetic ${o.schema}.${o.table} rows by exact id through the direct Supabase Data API on a local disposable stack, as two ordinary users and an anonymous client.`,
      notCovered: [
        'writes, updates and deletes',
        'tenant membership, shared records and delegated roles',
        'storage, edge functions, RPC and custom application APIs',
        'list or filter queries other than lookup by id',
        'production or remote environments',
      ],
    },
  };
}

export async function initCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      table: { type: 'string' },
      'owner-column': { type: 'string' },
      'id-column': { type: 'string' },
      'marker-column': { type: 'string' },
      schema: { type: 'string' },
      'rule-id': { type: 'string' },
      'project-id': { type: 'string' },
      origin: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const table = requireString(values.table, 'table');
  const ownerColumn = requireString(values['owner-column'], 'owner-column');
  const idColumn = values['id-column'] ?? 'id';
  const markerColumn = requireString(values['marker-column'], 'marker-column');
  const schema = values.schema ?? 'public';
  for (const [flag, v] of [['table', table], ['owner-column', ownerColumn], ['id-column', idColumn], ['marker-column', markerColumn], ['schema', schema]] as const) {
    if (!IDENT.test(v)) throw new UsageError(`--${flag} must be an unquoted lowercase identifier`);
  }
  const noun = table.replace(/_/g, '-').replace(/s$/, '').slice(0, 30) || 'record';
  const ruleId = values['rule-id'] ?? `${table.replace(/_/g, '-')}-owner-read`;
  const projectId = values['project-id'] ?? 'local-project';
  if (!SLUG.test(ruleId) || !SLUG.test(projectId) || !SLUG.test(noun)) throw new UsageError('--rule-id and --project-id must be lowercase slugs');
  const origin = values.origin ?? 'http://127.0.0.1:54321';
  const rule = scaffoldRule({ table, ownerColumn, idColumn, markerColumn, schema, ruleId, projectId, origin, noun });
  const v = validateRuleContent(rule);
  if (!v.ok || v.issues.length > 0) {
    io.stderr(`generated rule did not validate: ${v.issues.map((i) => i.code).join(', ')}\n`);
    return 2;
  }
  const out = resolve(io.cwd, values.out ?? `${ruleId}.rule.json`);
  const fh = await open(out, 'wx', 0o644);
  try {
    await fh.writeFile(JSON.stringify(rule, null, 2) + '\n');
  } finally {
    await fh.close();
  }
  io.stdout(
    [
      `wrote ${out}`,
      `  ${schema}.${table}: owner column ${ownerColumn}, id column ${idColumn}, synthetic marker column ${markerColumn}`,
      '  two synthetic users and two records with fresh random ids; six assertions (owners read own, nobody else, anonymous none)',
      `  request path: the Data API (/rest/v1/${table}) only. RPC functions and your API routes that return`,
      '  these rows are NOT checked until you list them under "paths" (see examples/invoice-three-paths.rule.json)',
      '',
      'Next:',
      '  1. Review the file. The marker column must be a text column the fixtures can set (it holds synthetic-* values).',
      `  2. Provision fixtures on your LOCAL stack:  pyx fixture provision --rule ${values.out ?? `${ruleId}.rule.json`}`,
      '     (add --fixture-defaults defaults.json if your table has other required columns)',
      `  3. pyx propose --rule ${values.out ?? `${ruleId}.rule.json`} --store .pyx/approvals --proposed-by <you> --out proposal.json`,
      '  4. The owner reviews `pyx diff` and runs `pyx approve ... --acknowledge <hash> --promote`',
      `  5. pyx run --store .pyx/approvals --rule ${ruleId} --credentials .pyx/local.env --html report.html`,
      '',
    ].join('\n'),
  );
  return 0;
}

// ---------------------------------------------------------------- report
export async function reportCommand(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { out: { type: 'string' }, client: { type: 'string' }, 'prepared-by': { type: 'string' }, title: { type: 'string' }, force: { type: 'boolean' } },
  });
  if (positionals.length === 0) throw new UsageError('usage: pyx report <result.json> [more results...] --out report.html');
  if (positionals.length > 200) throw new UsageError('at most 200 results per report');
  const results: RunResult[] = [];
  for (const p of positionals) {
    let raw: unknown;
    try {
      raw = parseStrictJson(await readTextFile(resolve(io.cwd, p), 1024 * 1024), { maxBytes: 1024 * 1024 });
    } catch (e) {
      if (e instanceof StrictJsonError) throw new UsageError(`${p}: ${e.message}`);
      throw e;
    }
    const v = validateSchema('RunResult', raw);
    if (!v.ok) throw new UsageError(`${p} is not a valid Pyx result`);
    results.push(v.value);
  }
  for (const [flag, val] of [['client', values.client], ['prepared-by', values['prepared-by']], ['title', values.title]] as const) {
    if (val !== undefined && (val.length > 120 || /[\u0000-\u001f]/.test(val))) throw new UsageError(`--${flag} must be at most 120 printable characters`);
  }
  const html = renderHtmlReport(results, {
    ...(values.client !== undefined && { client: values.client }),
    ...(values['prepared-by'] !== undefined && { preparedBy: values['prepared-by'] }),
    ...(values.title !== undefined && { title: values.title }),
  });
  assertOutputSafe(html, []);
  const out = resolve(io.cwd, values.out ?? 'pyx-report.html');
  if (existsSync(out) && !values.force) throw new UsageError(`output file already exists: ${out} (use --force to replace it)`);
  await writeFile(out, html, { mode: 0o644 });
  io.stdout(`wrote ${out} (${results.length} run${results.length === 1 ? '' : 's'})\n`);
  return 0;
}

// ---------------------------------------------------------------- doctor
interface Check {
  ok: boolean | null;
  label: string;
  hint?: string;
}

export async function doctorCommand(argv: string[], io: CliIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: { rule: { type: 'string' }, store: { type: 'string' }, 'rule-id': { type: 'string' }, 'credentials': { type: 'string' }, 'target-url': { type: 'string' } },
  });
  const checks: Check[] = [];
  const add = (ok: boolean | null, label: string, hint?: string) => checks.push({ ok, label, ...(hint !== undefined && { hint }) });

  const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
  add(major > 22 || (major === 22 && minor >= 12), `Node.js ${process.versions.node}`, 'Pyx needs Node 22.12 or newer.');

  // Rule: from a file, or the active approved revision in a store.
  let rule: RuleContent | null = null;
  if (values.rule) {
    const v = validateRuleContent(parseStrictJson(await readTextFile(resolve(io.cwd, values.rule))));
    if (!v.ok) add(false, `rule file ${values.rule} is invalid`, `Run: pyx validate ${values.rule}`);
    else if (v.issues.length > 0) add(false, `rule ${v.value.ruleId} is outside supported scope (${v.issues.map((i) => i.code).join(', ')})`);
    else {
      rule = v.value;
      add(true, `rule ${rule.ruleId} is valid`);
      const paths = plannedPaths(rule);
      add(null, `request paths checked: ${paths.map((p) => `${p.id} (${p.route})`).join(', ')}`);
      if (paths.length === 1) {
        add(null, 'RPC functions and your own API routes are NOT checked by this rule; list them under "paths" to cover them');
      }
    }
  }
  if (values.store) {
    const ruleId = values['rule-id'] ?? rule?.ruleId;
    if (!ruleId) add(false, 'approval store given without --rule-id', 'Pass --rule-id <id>.');
    else {
      try {
        const b = await openFileBaselineReader(resolve(io.cwd, values.store)).readActive(ruleId);
        add(true, `approved baseline ${ruleId} revision ${b.revision.revision} verifies (${b.revision.approval.provenance.level})`);
        rule ??= b.revision.content;
      } catch (e) {
        if (!(e instanceof BaselineError)) throw e;
        add(false, `approved baseline for ${ruleId}: ${e.code}`, e.code === 'not_found' ? 'Propose and approve the rule first (pyx propose / approve --promote).' : 'Inspect with pyx history.');
      }
    }
  }
  if (!rule) {
    add(false, 'no rule to diagnose', 'Pass --rule <file> or --store <dir> --rule-id <id>.');
    return report(checks, io);
  }

  const env: Record<string, string | undefined> = { ...io.env, ...(values['credentials'] ? await loadEnvFile(resolve(io.cwd, values['credentials'])) : {}) };
  const origin = rule.target.allowedOrigin;
  const target = values['target-url'] ?? env.PYX_SUPABASE_URL;
  const parsedTarget = target === undefined ? null : parseExactOrigin(target.replace(/\/+$/, ''));
  const parsedOrigin = parseExactOrigin(origin);
  add(
    !!parsedTarget && parsedTarget.ok && parsedOrigin.ok && parsedTarget.value.origin === parsedOrigin.value.origin,
    `target ${target ?? '(unset)'} matches approved origin ${origin}`,
    'Set PYX_SUPABASE_URL to the approved origin exactly (127.0.0.1 and localhost differ).',
  );

  const apiKey = env[rule.target.apiKey.credential.name];
  const apiCls = apiKey ? classifyApiKey(apiKey) : null;
  add(
    apiCls === rule.target.apiKey.kind,
    `${rule.target.apiKey.credential.name}: ${apiKey ? `present (${apiCls})` : 'missing'}; rule expects ${rule.target.apiKey.kind}`,
    apiCls && isElevated(apiCls) ? 'That is a secret key. Use the publishable key.' : 'Run `pyx fixture provision` or copy the publishable key from `supabase status`.',
  );
  const setupKey = env[rule.target.fixtureVerification.credential.name];
  const setupCls = setupKey ? classifyApiKey(setupKey) : null;
  add(
    !!setupCls && isElevated(setupCls),
    `${rule.target.fixtureVerification.credential.name}: ${setupKey ? `present (${setupCls})` : 'missing'}; needs a local secret key`,
    'Copy the local secret key from `supabase status` (local stacks only).',
  );

  const reachable = parsedOrigin.ok && apiKey && apiCls === rule.target.apiKey.kind;
  if (reachable) {
    const t = new BoundedFetchTransport({ allowedOrigins: [origin], limits: { ...DEFAULT_LIMITS, maxRequests: 16 }, runSignal: new AbortController().signal, userAgent: `pyx-doctor/${RUNNER_VERSION}` });
    const health = await t.send({ url: new URL('/auth/v1/health', origin), headers: { apikey: apiKey!, Accept: 'application/json' } });
    add(health.kind === 'response' && health.status === 200, `Auth service at ${origin}: ${health.kind === 'response' ? `HTTP ${health.status}` : health.code}`, 'Start the stack: `supabase start` (or `pnpm stack:up` in the Pyx repo).');
    const r = rule.resource;
    const probe = new URL(`/rest/v1/${r.table}`, origin);
    probe.searchParams.set('select', r.idColumn);
    probe.searchParams.set('limit', '0');
    const rest = await t.send({ url: probe, headers: { apikey: apiKey!, Accept: 'application/json', ...(r.schema === 'public' ? {} : { 'Accept-Profile': r.schema }) } });
    const restHint =
      rest.kind === 'response' && rest.status === 404
        ? `Table ${r.schema}.${r.table} is not exposed: check the name and that "${r.schema}" is in [api] schemas.`
        : rest.kind === 'response' && (rest.status === 401 || rest.status === 403)
          ? `Grant SELECT on ${r.schema}.${r.table} to anon and authenticated; RLS should filter rows, not the grant.`
          : 'Check the stack logs.';
    add(rest.kind === 'response' && rest.status === 200, `Data API route ${r.schema}.${r.table}: ${rest.kind === 'response' ? `HTTP ${rest.status}` : rest.code}`, restHint);

    for (const a of rule.actors.filter((x): x is AuthenticatedActor => x.kind === 'authenticated')) {
      const token = env[a.credential.name];
      if (!token) {
        add(false, `${a.credential.name} (${a.ref}): missing`, 'Run `pyx fixture provision`.');
        continue;
      }
      const pre = precheckUserToken(token);
      if (!pre.ok) {
        add(false, `${a.credential.name} (${a.ref}): ${pre.code}`, 'Supply an ordinary user access token.');
        continue;
      }
      const u = await t.send({ url: new URL('/auth/v1/user', origin), headers: { apikey: apiKey!, Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      let id: unknown = null;
      if (u.kind === 'response' && u.status === 200) {
        try {
          id = (JSON.parse(u.body) as { id?: unknown }).id;
        } catch {
          id = null;
        }
      }
      const exp = decodeJwtUnverified(token)?.payload.exp;
      const mins = typeof exp === 'number' ? Math.round((exp * 1000 - Date.now()) / 60000) : null;
      add(
        id === a.expectedUserId,
        `${a.credential.name} (${a.ref}): ${id === a.expectedUserId ? `verified by Auth${mins !== null ? `, expires in ${mins} min` : ''}` : u.kind === 'response' ? `rejected or wrong user (HTTP ${u.status})` : u.code}`,
        'Tokens expire (default 1 hour). Re-run `pyx fixture provision`.',
      );
    }
  } else {
    add(null, 'network checks skipped until the target and application key are correct');
  }
  return report(checks, io);
}

function report(checks: Check[], io: CliIO): number {
  const lines = ['Pyx doctor', ''];
  for (const c of checks) {
    const mark = c.ok === true ? '  ok  ' : c.ok === false ? '  FIX ' : '  --  ';
    lines.push(`${mark} ${c.label}`);
    if (c.ok === false && c.hint) lines.push(`        -> ${c.hint}`);
  }
  const bad = checks.filter((c) => c.ok === false).length;
  lines.push('', bad === 0 ? 'Everything Pyx needs is in place.' : `${bad} item${bad === 1 ? '' : 's'} to fix before a run can be trusted.`, '');
  io.stdout(lines.join('\n'));
  return bad === 0 ? 0 : 2;
}
