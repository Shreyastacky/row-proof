/* eslint-disable */
// GENERATED FILE - do not edit. Source: packages/contracts/schemas/rowproof.v1.schema.json
// Regenerate with `pnpm --filter @rowproof/contracts generate`.

/**
 * Lowercase identifier: letters, digits, single hyphens; 1-64 characters.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Slug".
 */
export type Slug = string;
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ShortText".
 */
export type ShortText = string;
/**
 * scheme://host[:port] with no path, query, fragment, or credentials. Exact form is checked semantically.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Origin".
 */
export type Origin = string;
/**
 * Unquoted lowercase Postgres identifier. Quoted or mixed-case identifiers are unsupported in v1.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "SqlIdentifier".
 */
export type SqlIdentifier = string;
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Actor".
 */
export type Actor = AuthenticatedActor | AnonymousActor;
/**
 * Canonical lowercase UUID. Uppercase is rejected so content hashes cannot vary by letter case.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string;
/**
 * Synthetic marker stored on the fixture row. The prefix makes accidental use of real records visible.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "FixtureMarker".
 */
export type FixtureMarker = string;
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ExpectedObservation".
 */
export type ExpectedObservation = 'exact_fixture_returned' | 'fixture_not_disclosed';
/**
 * Short human-readable text without control characters.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "SafeText".
 */
export type SafeText = string;
/**
 * sha256 over the RFC 8785 canonical JSON of a RuleContent document.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ContentHash".
 */
export type ContentHash = string;
/**
 * Identifier for a person or system that proposed, approved, or promoted something. Not an email address requirement; avoid personal data where possible.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ActorId".
 */
export type ActorId = string;
/**
 * UTC RFC 3339 timestamp with a Z suffix and at most millisecond precision.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string;
/**
 * local-self-attested: a filesystem owner can bypass it. protected-ref: retrieved from a separately protected Git ref (protection must be verified separately). control-plane-authenticated: recorded by an authenticated hosted reviewer (not implemented).
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ApprovalProvenanceLevel".
 */
export type ApprovalProvenanceLevel =
  'local-self-attested' | 'protected-ref' | 'control-plane-authenticated';
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "GitCommit".
 */
export type GitCommit = string;
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ControlStatus".
 */
export type ControlStatus = 'ok' | 'failed' | 'not_run';
/**
 * Allowlisted diagnostic codes. Raw SDK errors, headers, bodies, and tokens are never serialized.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "DiagnosticCode".
 */
export type DiagnosticCode =
  | 'ok'
  | 'fixture_disclosed'
  | 'owner_read_returned_no_rows'
  | 'owner_read_forbidden'
  | 'actor_unverified'
  | 'actors_not_distinct'
  | 'fixture_unverified'
  | 'owner_control_not_passed'
  | 'target_unverified'
  | 'baseline_invalid'
  | 'baseline_pin_mismatch'
  | 'origin_mismatch'
  | 'origin_not_loopback'
  | 'api_key_missing'
  | 'api_key_wrong_class'
  | 'api_key_elevated'
  | 'setup_key_missing'
  | 'setup_key_wrong_class'
  | 'token_missing'
  | 'token_malformed'
  | 'token_elevated_role'
  | 'token_rejected_by_auth'
  | 'token_expired_or_expiring'
  | 'token_issuer_mismatch'
  | 'token_anonymous_user'
  | 'user_id_mismatch'
  | 'fixture_missing'
  | 'fixture_owner_mismatch'
  | 'fixture_marker_mismatch'
  | 'fixture_returned_inconsistent'
  | 'unexpected_rows'
  | 'auth_rejected'
  | 'http_status_unexpected'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'redirect_rejected'
  | 'response_too_large'
  | 'response_malformed'
  | 'request_budget_exhausted'
  | 'run_deadline_exceeded'
  | 'cancelled'
  | 'unsupported_operation'
  | 'unsupported_ownership_model'
  | 'unsupported_route'
  | 'unsupported_environment_class'
  | 'unsupported_expectation'
  | 'unsupported_rule'
  | 'not_executed';
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "AssertionStatus".
 */
export type AssertionStatus = 'passed' | 'failed' | 'blocked' | 'not_assessed';
/**
 * What the response showed, as a safe enum. Raw rows are never recorded.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Observation".
 */
export type Observation =
  | 'exact_fixture_returned'
  | 'fixture_returned_inconsistent'
  | 'no_rows'
  | 'unexpected_rows'
  | 'error_response'
  | 'no_response'
  | 'not_requested';

/**
 * Authoritative RowProof v1 contracts. Every document type is a $defs entry; the root properties exist only so code generation emits every named type. Validate a document against its $defs entry, never against this root.
 */
export interface RowProofContractsV1 {
  ruleContent?: RuleContent;
  ruleProposal?: RuleProposal;
  approval?: Approval;
  approvedRevision?: ApprovedRevision;
  promotion?: Promotion;
  activeBaseline?: ActiveBaseline;
  runResult?: RunResult;
}
/**
 * The permission intent. This exact document, canonicalized, is what a content hash and an approval identify.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RuleContent".
 */
export interface RuleContent {
  kind: 'RuleContent';
  schemaVersion: 1;
  ruleId: Slug;
  title: ShortText;
  scope: RuleScope;
  target: Target;
  resource: Resource;
  /**
   * @minItems 2
   * @maxItems 8
   */
  actors: Actor[];
  /**
   * @minItems 1
   * @maxItems 8
   */
  fixtures: Fixture[];
  /**
   * @minItems 1
   * @maxItems 64
   */
  expectations: Expectation[];
  declaredScope: DeclaredScope;
}
/**
 * Hosted-facing identifiers. organizationId is null when the rule is used locally without a hosted account.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RuleScope".
 */
export interface RuleScope {
  organizationId: Slug | null;
  projectId: Slug;
  environmentId: Slug;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Target".
 */
export interface Target {
  adapter: 'supabase';
  /**
   * v1 supports only local-disposable. remote-non-production is representable but not assessed until separately implemented and tested.
   */
  environmentClass: 'local-disposable' | 'remote-non-production';
  allowedOrigin: Origin;
  apiKey: {
    kind: 'publishable' | 'legacy-anon';
    credential: CredentialRef;
  };
  /**
   * Privileged setup channel used only to verify fixture existence/ownership before assessment. Never used for assertions.
   */
  fixtureVerification: {
    channel: 'supabase-secret-key';
    credential: CredentialRef;
  };
}
/**
 * Reference to a credential supplied at execution time. Credential values never appear in rules or results.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "CredentialRef".
 */
export interface CredentialRef {
  source: 'env';
  /**
   * Environment variable name. The ROWPROOF_ prefix keeps rules from pointing at unrelated process secrets.
   */
  name: string;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Resource".
 */
export interface Resource {
  schema: SqlIdentifier;
  table: SqlIdentifier;
  operation: 'select' | 'insert' | 'update' | 'delete';
  route: 'supabase-data-api-rest-v1';
  ownershipModel: 'single-owner-column' | 'tenant-membership' | 'shared-record';
  idColumn: SqlIdentifier;
  ownerColumn: SqlIdentifier;
  markerColumn: SqlIdentifier;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "AuthenticatedActor".
 */
export interface AuthenticatedActor {
  ref: Slug;
  kind: 'authenticated';
  expectedUserId: Uuid;
  credential: CredentialRef;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "AnonymousActor".
 */
export interface AnonymousActor {
  ref: Slug;
  kind: 'anonymous';
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Fixture".
 */
export interface Fixture {
  ref: Slug;
  id: Uuid;
  ownerRef: Slug;
  marker: FixtureMarker;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Expectation".
 */
export interface Expectation {
  id: Slug;
  actorRef: Slug;
  fixtureRef: Slug;
  expected: ExpectedObservation;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "DeclaredScope".
 */
export interface DeclaredScope {
  covers: SafeText;
  /**
   * @maxItems 20
   */
  notCovered: SafeText[];
}
/**
 * A proposed change of intent. A proposal is never an approval and carries no authority.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RuleProposal".
 */
export interface RuleProposal {
  kind: 'RuleProposal';
  schemaVersion: 1;
  proposalId: Uuid;
  ruleId: Slug;
  contentHash: ContentHash;
  content: RuleContent;
  /**
   * The active approved revision this proposal changes, or null for the first revision.
   */
  basedOn: RevisionPointer | null;
  proposedBy: {
    id: ActorId;
    kind: 'local-user' | 'ai-assistant' | 'ci';
  };
  proposedAt: Timestamp;
  note: SafeText | null;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RevisionPointer".
 */
export interface RevisionPointer {
  revision: number;
  contentHash: ContentHash;
}
/**
 * An explicit acknowledgment that binds one approver to one exact content hash. acknowledgedHash is the hash the approver typed or confirmed and must equal contentHash.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Approval".
 */
export interface Approval {
  kind: 'Approval';
  schemaVersion: 1;
  approvalId: Uuid;
  ruleId: Slug;
  revision: number;
  contentHash: ContentHash;
  acknowledgedHash: ContentHash;
  proposalId: Uuid;
  decision: 'approved';
  approvedBy: {
    id: ActorId;
    kind: 'local-user' | 'authenticated-reviewer';
  };
  approvedAt: Timestamp;
  provenance: {
    level: ApprovalProvenanceLevel;
    statement: SafeText;
  };
  supersedes: RevisionPointer | null;
}
/**
 * Immutable approved revision: the approved content plus the approval that names its hash.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ApprovedRevision".
 */
export interface ApprovedRevision {
  kind: 'ApprovedRevision';
  schemaVersion: 1;
  ruleId: Slug;
  revision: number;
  contentHash: ContentHash;
  content: RuleContent;
  approval: Approval;
}
/**
 * Immutable record that an approved revision became the active baseline.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "Promotion".
 */
export interface Promotion {
  kind: 'Promotion';
  schemaVersion: 1;
  ruleId: Slug;
  sequence: number;
  revision: number;
  contentHash: ContentHash;
  promotedBy: ActorId;
  promotedAt: Timestamp;
  previous: RevisionPointer | null;
}
/**
 * Pointer to the currently active approved revision. It must agree with the latest Promotion record.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ActiveBaseline".
 */
export interface ActiveBaseline {
  kind: 'ActiveBaseline';
  schemaVersion: 1;
  ruleId: Slug;
  revision: number;
  contentHash: ContentHash;
  promotionSequence: number;
}
/**
 * Bounded, redacted observation of one run. It reports listed assertions only; it has no field for an overall security verdict or score.
 *
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RunResult".
 */
export interface RunResult {
  kind: 'RunResult';
  schemaVersion: 1;
  runId: Uuid;
  rule: {
    ruleId: Slug;
    revision: number | null;
    contentHash: ContentHash | null;
  };
  runner: {
    name: 'rowproof-runner';
    version: string;
  };
  source: {
    commit: GitCommit | null;
    /**
     * true when tracked files differed from commit at run time; null when not determinable (e.g. commit supplied explicitly).
     */
    dirty: boolean | null;
  };
  scope: RuleScope | null;
  target: {
    origin: Origin | null;
    environmentClass: ('local-disposable' | 'remote-non-production') | null;
    transport: 'supabase-data-api-rest-v1';
  };
  observedAt: {
    startedAt: Timestamp;
    finishedAt: Timestamp;
  };
  limits: RunLimits;
  /**
   * @maxItems 32
   */
  controls: ControlResult[];
  /**
   * @maxItems 64
   */
  assertions: AssertionResult[];
  summary: {
    /**
     * pass: complete required matrix, valid controls, every assertion passed. fail: at least one demonstrated violation. blocked: incomplete without a demonstrated violation.
     */
    outcome: 'pass' | 'fail' | 'blocked';
    completeness: 'complete' | 'incomplete';
    exitCode: 0 | 1 | 2;
    counts: {
      passed: number;
      failed: number;
      blocked: number;
      not_assessed: number;
    };
  };
  /**
   * Separate from assertion truth. v1 has no dependency observer, so state is unknown.
   */
  freshness: {
    state: 'current' | 'stale' | 'unknown';
    reason:
      | 'observed_inputs_unchanged'
      | 'observed_relevant_change'
      | 'no_dependency_observer'
      | 'incomplete_observations';
    /**
     * @maxItems 16
     */
    dependencies: DependencyFingerprint[];
  };
  provenance: {
    approvalLevel: ApprovalProvenanceLevel | null;
    /**
     * Declared by the invoker; not proof of honest execution.
     */
    executionContext: 'local-developer' | 'ci-development' | 'ci-trusted-pinned-declared';
  };
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "RunLimits".
 */
export interface RunLimits {
  maxRequests: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
  maxResponseBytes: number;
  concurrency: 1;
  retries: 0;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "ControlResult".
 */
export interface ControlResult {
  id: string;
  status: ControlStatus;
  diagnostic: DiagnosticCode;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "AssertionResult".
 */
export interface AssertionResult {
  id: Slug;
  actorRef: Slug;
  fixtureRef: Slug;
  expected: ExpectedObservation;
  status: AssertionStatus;
  observation: Observation;
  diagnostic: DiagnosticCode;
  httpStatus: number | null;
}
/**
 * This interface was referenced by `RowProofContractsV1`'s JSON-Schema
 * via the `definition` "DependencyFingerprint".
 */
export interface DependencyFingerprint {
  kind:
    | 'postgres-policies'
    | 'postgres-grants'
    | 'postgres-functions'
    | 'postgrest-schema'
    | 'auth-config';
  digest: ContentHash;
  observedAt: Timestamp;
}
