/**
 * Readable intent diff between the active approved content and a proposal.
 * Expectation changes are shown as matrix cells (actor -> fixture), because that
 * is what an owner actually agrees to. Everything else is shown by JSON path.
 */
import type { RuleContent } from '@pyx/contracts';

export interface IntentChange {
  area: 'expectation' | 'actor' | 'fixture' | 'target' | 'resource' | 'scope' | 'declared-scope' | 'metadata';
  path: string;
  before: string | null;
  after: string | null;
}

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value === null || typeof value !== 'object') {
    out.set(prefix || '/', JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, '[]');
    value.forEach((v, i) => flatten(v, `${prefix}/${i}`, out));
    return;
  }
  for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}/${k}`, out);
}

function keyed<T>(items: T[], key: (t: T) => string): Map<string, T> {
  return new Map(items.map((i) => [key(i), i] as const));
}

function diffKeyed<T>(
  area: IntentChange['area'],
  label: string,
  before: T[],
  after: T[],
  key: (t: T) => string,
  show: (t: T) => string,
  out: IntentChange[],
): void {
  const b = keyed(before, key);
  const a = keyed(after, key);
  for (const [k, v] of b) {
    const n = a.get(k);
    if (!n) out.push({ area, path: `${label}[${k}]`, before: show(v), after: null });
    else if (show(n) !== show(v)) out.push({ area, path: `${label}[${k}]`, before: show(v), after: show(n) });
  }
  for (const [k, v] of a) if (!b.has(k)) out.push({ area, path: `${label}[${k}]`, before: null, after: show(v) });
}

export function diffIntent(before: RuleContent | null, after: RuleContent): IntentChange[] {
  const out: IntentChange[] = [];
  const empty = { actors: [], fixtures: [], expectations: [] } as unknown as RuleContent;
  const b = before ?? empty;

  diffKeyed(
    'expectation',
    'matrix',
    b.expectations,
    after.expectations,
    (e) => `${e.actorRef} -> ${e.fixtureRef}`,
    (e) => e.expected,
    out,
  );
  diffKeyed(
    'actor',
    'actors',
    b.actors,
    after.actors,
    (x) => x.ref,
    (x) => (x.kind === 'authenticated' ? `authenticated user ${x.expectedUserId} via $${x.credential.name}` : 'anonymous'),
    out,
  );
  diffKeyed(
    'fixture',
    'fixtures',
    b.fixtures,
    after.fixtures,
    (f) => f.ref,
    (f) => `id ${f.id}, owner ${f.ownerRef}, marker ${f.marker}`,
    out,
  );

  const sections: Array<[IntentChange['area'], keyof RuleContent]> = [
    ['target', 'target'],
    ['resource', 'resource'],
    ['scope', 'scope'],
    ['declared-scope', 'declaredScope'],
    ['metadata', 'title'],
    ['metadata', 'ruleId'],
    ['metadata', 'schemaVersion'],
  ];
  for (const [area, key] of sections) {
    const fb = new Map<string, string>();
    const fa = new Map<string, string>();
    if (before) flatten(before[key], `/${key}`, fb);
    flatten(after[key], `/${key}`, fa);
    for (const [p, v] of fb) {
      const n = fa.get(p);
      if (n === undefined) out.push({ area, path: p, before: v, after: null });
      else if (n !== v) out.push({ area, path: p, before: v, after: n });
    }
    for (const [p, v] of fa) if (!fb.has(p)) out.push({ area, path: p, before: null, after: v });
  }
  return out;
}

export function renderDiff(changes: IntentChange[], beforeLabel: string, afterLabel: string): string {
  if (changes.length === 0) return `No intent changes between ${beforeLabel} and ${afterLabel}.\n`;
  const lines = [`Intent changes from ${beforeLabel} to ${afterLabel}:`];
  const permission = changes.filter((c) => c.area === 'expectation');
  if (permission.length > 0) {
    lines.push('', '  PERMISSION CHANGES (who may read what):');
    for (const c of permission) {
      lines.push(`    ${c.path.replace(/^matrix\[|\]$/g, '')}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`);
    }
  }
  const other = changes.filter((c) => c.area !== 'expectation');
  if (other.length > 0) {
    lines.push('', '  OTHER CHANGES:');
    for (const c of other) lines.push(`    [${c.area}] ${c.path}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`);
  }
  return lines.join('\n') + '\n';
}
