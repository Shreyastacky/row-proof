/**
 * Read local stack connection details from `supabase status -o json`.
 * Values stay in memory; nothing here prints them.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseExactOrigin } from '@rowproof/contracts';

const run = promisify(execFile);

export interface StackInfo {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  legacyAnonKey: string | null;
  legacyServiceRoleKey: string | null;
  dbUrl: string | null;
}

export class StackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StackError';
  }
}

export function parseStatusJson(text: string): StackInfo {
  let raw: unknown;
  try {
    // The CLI may print a warning line before the JSON object.
    const start = text.indexOf('{');
    raw = JSON.parse(start >= 0 ? text.slice(start) : text);
  } catch {
    throw new StackError('could not parse `supabase status -o json` output; is the local stack running?');
  }
  const r = raw as Record<string, unknown>;
  const str = (k: string): string | null => (typeof r[k] === 'string' && (r[k] as string).length > 0 ? (r[k] as string) : null);
  const apiUrl = str('API_URL');
  const publishableKey = str('PUBLISHABLE_KEY');
  const secretKey = str('SECRET_KEY');
  if (!apiUrl || !publishableKey || !secretKey) throw new StackError('stack status is missing API_URL, PUBLISHABLE_KEY or SECRET_KEY');
  return {
    apiUrl,
    publishableKey,
    secretKey,
    legacyAnonKey: str('ANON_KEY'),
    legacyServiceRoleKey: str('SERVICE_ROLE_KEY'),
    dbUrl: str('DB_URL'),
  };
}

export async function readStackStatus(supabaseBin: string, workdir: string): Promise<StackInfo> {
  try {
    const { stdout } = await run(supabaseBin, ['status', '-o', 'json', '--workdir', workdir], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
    });
    return parseStatusJson(stdout);
  } catch (e) {
    if (e instanceof StackError) throw e;
    throw new StackError('`supabase status` failed; start the local stack first (pnpm stack:up)');
  }
}

/**
 * Mutation tooling must never accept a remote target. The stack URL must be a
 * loopback origin and must equal the origin approved in the rule.
 */
export function assertLocalTarget(stackApiUrl: string, approvedOrigin: string): void {
  const s = parseExactOrigin(stackApiUrl.replace(/\/+$/, ''));
  const a = parseExactOrigin(approvedOrigin);
  if (!s.ok || !s.value.isLoopback) throw new StackError('refusing: the stack API URL is not a loopback origin');
  if (!a.ok || a.value.origin !== s.value.origin) {
    throw new StackError('refusing: the stack API URL differs from the rule\'s approved origin');
  }
}
