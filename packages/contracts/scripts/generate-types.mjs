// Generates src/types.generated.ts from the authoritative JSON Schema bundle.
// `--check` fails if the committed file differs, so types cannot drift from the schema.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = fileURLToPath(new URL('.', import.meta.url));
const schemaPath = `${here}../schemas/pyx.v1.schema.json`;
const outPath = `${here}../src/types.generated.ts`;

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const banner =
  '/* eslint-disable */\n' +
  '// GENERATED FILE - do not edit. Source: packages/contracts/schemas/pyx.v1.schema.json\n' +
  '// Regenerate with `pnpm --filter @pyx/contracts generate`.\n';

const ts = await compile(schema, 'PyxContractsV1', {
  bannerComment: banner,
  additionalProperties: false,
  unreachableDefinitions: true,
  strictIndexSignatures: true,
  ignoreMinAndMaxItems: true,
  maxItems: -1,
  enableConstEnums: false,
  style: { singleQuote: true, semi: true, printWidth: 100 },
});

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(outPath, 'utf8');
  } catch {
    // missing file is drift
  }
  if (current !== ts) {
    console.error('types.generated.ts is out of date with the schema. Run: pnpm --filter @pyx/contracts generate');
    process.exit(1);
  }
  console.log('types.generated.ts matches the schema.');
} else {
  await writeFile(outPath, ts);
  console.log(`wrote ${outPath}`);
}
