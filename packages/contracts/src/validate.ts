import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type {
  ActiveBaseline,
  Approval,
  ApprovedRevision,
  Promotion,
  RuleContent,
  RuleProposal,
  RunResult,
} from './types.generated.js';

export const SCHEMA_ID = 'urn:rowproof:schemas:v1';

export type DocumentKind =
  | 'RuleContent'
  | 'RuleProposal'
  | 'Approval'
  | 'ApprovedRevision'
  | 'Promotion'
  | 'ActiveBaseline'
  | 'RunResult';

export interface DocumentTypes {
  RuleContent: RuleContent;
  RuleProposal: RuleProposal;
  Approval: Approval;
  ApprovedRevision: ApprovedRevision;
  Promotion: Promotion;
  ActiveBaseline: ActiveBaseline;
  RunResult: RunResult;
}

export interface Issue {
  /** Machine-readable code, e.g. `schema`, `matrix_incomplete`, `unsupported_operation`. */
  code: string;
  /** JSON pointer into the document. */
  path: string;
  message: string;
  /** `error`: malformed or unsafe. `unsupported`: well-formed but outside supported v1 scope. */
  severity: 'error' | 'unsupported';
}

export type ValidationResult<T> = { ok: true; value: T; issues: Issue[] } | { ok: false; issues: Issue[] };

const schemaUrl = new URL('../schemas/rowproof.v1.schema.json', import.meta.url);
export const schemaBundle: unknown = JSON.parse(readFileSync(schemaUrl, 'utf8'));

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  // oneOf with null alternatives is used deliberately; strictTypes would demand redundant `type` keywords.
  strictTypes: false,
  validateFormats: false,
});
ajv.addSchema(schemaBundle as object);

const validators = new Map<DocumentKind, ValidateFunction>();

function validatorFor(kind: DocumentKind): ValidateFunction {
  let v = validators.get(kind);
  if (!v) {
    const found = ajv.getSchema(`${SCHEMA_ID}#/$defs/${kind}`);
    if (!found) throw new Error(`schema definition ${kind} missing`);
    v = found;
    validators.set(kind, v);
  }
  return v;
}

const MAX_ISSUES = 25;

function toIssue(e: ErrorObject): Issue {
  // Ajv messages describe the schema constraint, not the offending data value.
  return { code: 'schema', path: e.instancePath || '/', message: e.message ?? 'invalid', severity: 'error' };
}

/** Structural validation against one $defs entry. Does not perform semantic checks. */
export function validateSchema<K extends DocumentKind>(kind: K, value: unknown): ValidationResult<DocumentTypes[K]> {
  const v = validatorFor(kind);
  if (v(value)) return { ok: true, value: value as DocumentTypes[K], issues: [] };
  const raw = v.errors ?? [];
  // oneOf failures produce noisy branch errors; keep the most specific first.
  const issues = raw.slice(0, MAX_ISSUES).map(toIssue);
  return { ok: false, issues };
}
