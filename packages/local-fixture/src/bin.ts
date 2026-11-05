#!/usr/bin/env node
// Standalone entry for the fixture tool. Kept separate from cli.ts so bundling cli.ts
// into the main `rowproof` CLI never auto-runs it.
import { runFixtureCli } from './cli.js';

process.exitCode = await runFixtureCli(process.argv.slice(2));
