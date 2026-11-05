#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UsageError, type CliIO } from './io.js';

const HELP = `ship-safe <command> [options]

Approval workflow (writes the local, self-attested approval store):
  validate <file>     validate rule content or a proposal
  hash <rule.json>    print the canonical content hash
  propose             create a proposal from rule content (no authority)
  diff                show intent changes versus the active approved revision
  approve             approve exactly one acknowledged content hash
  promote             make an approved revision the active baseline
  history             list approved revisions and the active one

Assessment (reads the approval store only):
  run                 execute the approved matrix; see \`ship-safe run --help\`
`;

export async function main(argv: string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'run': {
        // Loaded lazily so the assessment path never loads the approval writer.
        const { runCommand } = await import('./commands/run.js');
        return await runCommand(rest, io);
      }
      case 'validate':
      case 'hash':
      case 'propose':
      case 'diff':
      case 'approve':
      case 'promote':
      case 'history': {
        const m = await import('./commands/approval.js');
        const fn = {
          validate: m.validateCommand,
          hash: m.hashCommand,
          propose: m.proposeCommand,
          diff: m.diffCommand,
          approve: m.approveCommand,
          promote: m.promoteCommand,
          history: m.historyCommand,
        }[command];
        return await fn(rest, io);
      }
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        io.stdout(HELP);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    }
  } catch (e) {
    if (e instanceof UsageError || (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'))) {
      io.stderr(`${e.message}\n`);
      return 2;
    }
    if (e instanceof Error && 'code' in e && (e.code === 'ENOENT' || e.code === 'EEXIST' || e.code === 'EACCES')) {
      io.stderr(`file error (${String(e.code)})\n`);
      return 2;
    }
    // Never print raw error objects: they can carry request details.
    io.stderr(`internal error (${e instanceof Error ? e.name : 'unknown'}); no result was produced\n`);
    return 2;
  }
}

function isEntrypoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return pathToFileURL(realpathSync(script)).href === import.meta.url;
  } catch {
    return false;
  }
}
const isEntry = isEntrypoint();
if (isEntry) {
  // A closed pipe (e.g. `| head`) is not an error worth a stack trace.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  });
  const code = await main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    cwd: process.cwd(),
  });
  process.exitCode = code;
}
