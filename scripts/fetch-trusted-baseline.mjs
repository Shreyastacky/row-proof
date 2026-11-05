#!/usr/bin/env node
// Materialize the approved baseline from a specific git ref (e.g. the protected
// default branch) instead of trusting the candidate working tree.
//
//   node scripts/fetch-trusted-baseline.mjs --ref origin/main [--path baseline] --out <dir> [--repo <dir>]
//
// Reads files with `git show <commit>:<file>`, never from the working tree.
// Refuses symlinks/submodules, bounds file count and size, and writes
// <out>/SOURCE.txt recording the exact commit used. Exit 3 means the ref has
// no baseline (nothing to assess); exit 2 is any other failure.
//
// What this does NOT prove: that the ref is actually protected. Branch
// protection / rulesets must be configured and checked separately.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const MAX_FILES = 500;
const MAX_BYTES = 256 * 1024;

const { values } = parseArgs({
  options: { ref: { type: 'string' }, path: { type: 'string' }, out: { type: 'string' }, repo: { type: 'string' } },
});
if (!values.ref || !values.out) {
  console.error('usage: fetch-trusted-baseline.mjs --ref <git-ref> --out <dir> [--path baseline] [--repo <dir>]');
  process.exit(2);
}
const repo = resolve(values.repo ?? '.');
const base = (values.path ?? 'baseline').replace(/\/+$/, '');
if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..')) {
  console.error('invalid --path');
  process.exit(2);
}
const out = resolve(values.out);

function git(args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: opts.encoding ?? 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`git ${args[0]} failed`);
    process.exit(2);
  }
  return r.stdout;
}

const commit = git(['rev-parse', '--verify', `${values.ref}^{commit}`]).trim();
if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) process.exit(2);

const listing = git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', base]);
const entries = listing.split('\0').filter(Boolean);
if (entries.length === 0) {
  console.error(`no baseline at ${base}/ in ${values.ref} (${commit})`);
  process.exit(3);
}
if (entries.length > MAX_FILES) {
  console.error('too many baseline files');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const entry of entries) {
  const [meta, path] = entry.split('\t');
  const [mode, type, blob] = meta.split(' ');
  if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
    console.error(`refusing non-regular entry in baseline: ${path}`);
    process.exit(2);
  }
  const size = Number(git(['cat-file', '-s', blob]).trim());
  if (size > MAX_BYTES) {
    console.error(`baseline file too large: ${path}`);
    process.exit(2);
  }
  const rel = path.slice(base.length + 1);
  const dest = resolve(out, rel);
  if (!dest.startsWith(out + sep)) {
    console.error('path escapes output directory');
    process.exit(2);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, git(['cat-file', 'blob', blob], { encoding: 'buffer' }), { flag: 'wx' });
}
writeFileSync(join(out, 'SOURCE.txt'), `ref=${values.ref}\ncommit=${commit}\npath=${base}\n`);
console.log(`trusted baseline: ${entries.length} files from ${values.ref} @ ${commit}`);
