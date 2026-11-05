import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const RUNNER_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

export async function readTextFile(path: string, maxBytes = 512 * 1024): Promise<string> {
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new UsageError(`${path} exceeds ${maxBytes} bytes`);
  return text;
}

/** Load KEY=VALUE pairs from a dotenv-style file without touching process.env. */
export async function loadEnvFile(path: string): Promise<Record<string, string>> {
  return parseEnv(await readTextFile(path, 64 * 1024)) as Record<string, string>;
}

export function requireString(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new UsageError(`missing required --${flag}`);
  return value;
}

export function optionalInt(value: string | boolean | undefined, flag: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new UsageError(`--${flag} must be an integer`);
  const n = Number(value);
  if (n < min || n > max) throw new UsageError(`--${flag} must be between ${min} and ${max}`);
  return n;
}
