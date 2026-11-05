// Bundles the Pyx CLI (runner + contracts + fixture tooling) into one ESM file for npm.
// `--smoke` additionally packs the package and runs it from a clean temporary install.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const runnerVersion = JSON.parse(readFileSync(join(repo, 'packages/runner/package.json'), 'utf8')).version;
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
if (pkg.version !== runnerVersion) throw new Error(`version mismatch: cli ${pkg.version} vs runner ${runnerVersion}`);

rmSync(join(here, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [join(repo, 'packages/runner/dist/cli.js')],
  outfile: join(here, 'dist/pyx.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  legalComments: 'linked',
  // Ajv and parts of supabase-js are CommonJS; give the ESM bundle a real `require`.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __rpCreateRequire } from 'node:module';\nconst require = __rpCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
// The shebang in the entry source must not be duplicated.
const out = join(here, 'dist/pyx.mjs');
const text = readFileSync(out, 'utf8').replace(/\n#!\/usr\/bin\/env node\n/, '\n');
writeFileSync(out, text, { mode: 0o755 });

// Start from an empty schemas folder so a renamed or removed schema is never shipped.
rmSync(join(here, 'schemas'), { recursive: true, force: true });
mkdirSync(join(here, 'schemas'), { recursive: true });
cpSync(join(repo, 'packages/contracts/schemas/pyx.v1.schema.json'), join(here, 'schemas/pyx.v1.schema.json'));
cpSync(join(repo, 'LICENSE.md'), join(here, 'LICENSE.md'));
console.log(`built dist/pyx.mjs (${(text.length / 1024).toFixed(0)} KiB)`);

if (process.argv.includes('--smoke')) {
  // Invoke npm's JavaScript entry point, not a .cmd shim or an unquoted shell.
  const npmBesideNode = join(dirname(process.execPath), 'npm');
  const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    ...(existsSync(npmBesideNode) ? [realpathSync(npmBesideNode)] : [])]
    .find((p) => p && p.endsWith('npm-cli.js') && existsSync(p));
  if (!npmCli) throw new Error('npm-cli.js not found beside Node; install npm with Node to smoke-test packaging');
  const tmp = mkdtempSync(join(tmpdir(), 'pyx-pack-'));
  try {
    // A clean install must not inherit a developer's registry/auth/script settings.
    const config = join(tmp, 'empty.npmrc');
    writeFileSync(config, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
    const npm = (args, options) => execFileSync(process.execPath, [npmCli, '--userconfig', config, ...args], { ...options, env });
    const tgz = npm(['pack', '--silent', '--pack-destination', tmp], { cwd: here }).toString().trim().split('\n').pop().trim();
    npm(['init', '-y'], { cwd: tmp, stdio: 'ignore' });
    npm(['install', '--no-audit', '--no-fund', '--offline', join(tmp, tgz)], { cwd: tmp, stdio: 'inherit' });
    const bin = join(tmp, 'node_modules/pyx-cli/dist/pyx.mjs');
    const run = (...a) => execFileSync(process.execPath, [bin, ...a], { cwd: tmp }).toString();
    console.log(run('--version').trim());
    run('init', '--table', 'invoices', '--owner-column', 'owner_id', '--marker-column', 'title', '--out', 'r.json');
    console.log(run('validate', 'r.json').trim());
    // The release review from the installed package, on the two real sample results.
    const results = join(here, '..', '..', 'examples', 'results');
    let review = '';
    try {
      run('compare', join(results, 'release-41-pass.json'), join(results, 'release-42-fail.json'));
    } catch (e) {
      review = String(e.stdout ?? '');
      if (e.status !== 1) throw e;
    }
    if (!review.includes('GAINED ACCESS')) throw new Error('compare did not report the regression');
    console.log('compare: regression reported, exit 1');
    console.log(`packed ${tgz}: install and first commands OK`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
