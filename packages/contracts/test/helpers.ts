import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RuleContent } from '../src/index.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function readRepoFile(rel: string): string {
  return readFileSync(`${repoRoot}${rel}`, 'utf8');
}

export function exampleRule(): RuleContent {
  return JSON.parse(readRepoFile('examples/invoice-owner-read.rule.json')) as RuleContent;
}

/** Every JSON pointer to a primitive leaf in a value. */
export function leafPaths(value: unknown, prefix: string[] = []): string[][] {
  if (value === null || typeof value !== 'object') return [prefix];
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  return entries.flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
}

export function setAt(root: unknown, path: string[], next: unknown): void {
  let cur = root as Record<string, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string, unknown>;
  cur[path.at(-1)!] = next;
}

export function getAt(root: unknown, path: string[]): unknown {
  let cur = root as Record<string, unknown>;
  for (const key of path) cur = cur[key] as Record<string, unknown>;
  return cur;
}

/** A different value of the same primitive type. */
export function perturb(v: unknown): unknown {
  if (typeof v === 'string') return v.length > 1 ? v.slice(0, -1) + (v.endsWith('a') ? 'b' : 'a') : v + 'x';
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'boolean') return !v;
  if (v === null) return 'not-null';
  return v;
}
