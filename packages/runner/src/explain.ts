/**
 * Plain-language explanations for every diagnostic code, written for the person
 * who has to act on a result (often not a security specialist). Each has a
 * short meaning and a concrete next step. Kept exhaustive by a unit test.
 */
import type { DiagnosticCode } from '@rowproof/contracts';

export interface Explanation {
  meaning: string;
  next: string;
}

export const EXPLANATIONS: Record<DiagnosticCode, Explanation> = {
  ok: { meaning: 'Observed exactly what the approved rule expects.', next: 'Nothing to do.' },
  fixture_disclosed: {
    meaning: 'A user who must not see this record received it. This is a real access-control regression for this route.',
    next: 'Review recent changes to RLS policies, grants, views and security-definer functions on this table. Fix the policy, then re-run.',
  },
  owner_read_returned_no_rows: {
    meaning: 'The owner could not read their own record (empty result), even though identity and fixture were verified.',
    next: 'An owner SELECT policy is probably missing or too strict. Check the policy USING clause for the owner column.',
  },
  owner_read_forbidden: {
    meaning: 'The owner was refused with a permission error: the role lacks the SELECT grant on this table.',
    next: 'Restore `grant select on <table> to authenticated` (and anon if intended), then re-run.',
  },
  actor_unverified: { meaning: 'This user identity could not be verified, so nothing was assessed as this user.', next: 'See the identity control above for the exact reason.' },
  actors_not_distinct: { meaning: 'Two test users resolved to the same account, so isolation between them cannot be shown.', next: 'Provision two different users and give each its own token.' },
  fixture_unverified: { meaning: 'The test record could not be independently verified, so results for it are not trustworthy.', next: 'Run `rowproof fixture verify` or re-provision fixtures.' },
  owner_control_not_passed: {
    meaning: 'The owner read of this record did not pass, so an empty result for other users proves nothing.',
    next: 'Fix the owner read first; denials are only meaningful once the owner can see the record.',
  },
  target_unverified: { meaning: 'The target environment did not match the approved one, so no requests were sent.', next: 'See the target control above.' },
  baseline_invalid: { meaning: 'The approved rule could not be loaded or failed its integrity check.', next: 'Run `rowproof history` to inspect the approval store; re-approve if it was tampered with.' },
  baseline_pin_mismatch: { meaning: 'The active approved revision differs from the revision or hash this run was pinned to.', next: 'Update the pin to the newly approved revision, or investigate who promoted it.' },
  origin_mismatch: { meaning: 'The target URL differs from the exact origin the rule approves.', next: 'Set ROWPROOF_SUPABASE_URL (or --target-url) to the approved origin, character for character.' },
  origin_not_loopback: { meaning: 'Local-disposable rules may only target a loopback address.', next: 'Point the rule at your local stack (http://127.0.0.1:54321).' },
  api_key_missing: { meaning: 'The application (publishable) key was not supplied.', next: 'Provide the env variable named in the rule.' },
  api_key_wrong_class: { meaning: 'The supplied application key is not the kind the rule declares.', next: 'Use the publishable key, or declare legacy-anon in the rule if you rely on the legacy anon key.' },
  api_key_elevated: { meaning: 'A secret / service-role key was supplied where an ordinary application key belongs. It bypasses RLS, so it was refused.', next: 'Use the publishable key. Never ship a secret key to clients.' },
  setup_key_missing: { meaning: 'The setup-channel key used to verify fixtures independently was not supplied.', next: 'Provide the secret key env variable named in the rule (local stacks only).' },
  setup_key_wrong_class: { meaning: 'The setup-channel key is not a secret / service-role key.', next: 'Use the local stack secret key for fixture verification.' },
  token_missing: { meaning: 'No access token was supplied for this user.', next: 'Run `rowproof fixture provision` to mint tokens.' },
  token_malformed: { meaning: 'The supplied value is not a user access token.', next: 'Supply the user session access token (a JWT with role authenticated).' },
  token_elevated_role: { meaning: 'A privileged credential was supplied as a user token and was refused.', next: 'Use an ordinary signed-in user token.' },
  token_rejected_by_auth: { meaning: "The target's Auth service rejected this token (expired, revoked, or from another project).", next: 'Re-run `rowproof fixture provision` to mint fresh tokens for this target.' },
  token_expired_or_expiring: { meaning: 'The token expires within a minute, too soon to trust for this run.', next: 'Mint fresh tokens and re-run.' },
  token_issuer_mismatch: { meaning: 'The token was issued for a different origin than the approved target.', next: 'Use tokens minted by the approved target (127.0.0.1 and localhost are different origins).' },
  token_anonymous_user: { meaning: 'The token belongs to an anonymous sign-in, not an ordinary user.', next: 'Provision a regular user for this actor.' },
  user_id_mismatch: { meaning: 'The token belongs to a different user than the rule expects.', next: 'Check the tokens are assigned to the right actors, or re-provision.' },
  fixture_missing: { meaning: 'The test record does not exist on the target.', next: 'Re-run `rowproof fixture provision`.' },
  fixture_owner_mismatch: { meaning: 'The test record exists but belongs to a different user than the rule says.', next: 'Re-provision fixtures; something changed the owner column.' },
  fixture_marker_mismatch: { meaning: 'The test record exists but its synthetic marker changed.', next: 'Re-provision fixtures.' },
  fixture_returned_inconsistent: { meaning: 'A row with the fixture id came back with a different owner or marker.', next: 'Re-provision fixtures and check triggers or views that rewrite rows.' },
  unexpected_rows: { meaning: 'The response contained rows other than the requested fixture.', next: 'Check views, RPC rewrites or filters on this route; the id filter should return one row at most.' },
  auth_rejected: { meaning: 'The request was rejected as unauthenticated (401). That is not a supported way to express denial, so it is not a pass.', next: 'Check token validity and gateway configuration.' },
  http_status_unexpected: { meaning: 'The API returned a status the supported semantics do not cover. Only an empty result counts as denial.', next: 'Inspect the route; grants should allow SELECT and RLS should filter rows.' },
  not_found: { meaning: 'The table or route was not found (404). A missing route is not evidence of protection.', next: 'Check the table is in an exposed schema and the name is right.' },
  rate_limited: { meaning: 'The target rate-limited the request (429).', next: 'Retry later; RowProof does not retry automatically.' },
  server_error: { meaning: 'The target returned a server error (5xx).', next: 'Check the stack logs and re-run.' },
  timeout: { meaning: 'The request did not finish within the per-request limit.', next: 'Check the stack is healthy, or raise --request-timeout-ms.' },
  network_error: { meaning: 'The target could not be reached.', next: 'Start the stack (`supabase start`) and check the URL.' },
  redirect_rejected: { meaning: 'The target answered with a redirect. RowProof never follows redirects, so the request was not assessed.', next: 'Use the direct API origin.' },
  response_too_large: { meaning: 'The response exceeded the size limit and was not read.', next: 'Check the route returns single rows; raise --max-response-bytes only if justified.' },
  response_malformed: { meaning: 'The response was not the JSON shape expected from the Data API.', next: 'Check the route and columns named in the rule.' },
  request_budget_exhausted: { meaning: 'The run hit its request limit before this check.', next: 'Raise --max-requests.' },
  run_deadline_exceeded: { meaning: 'The run hit its total time limit before this check.', next: 'Raise --run-timeout-ms or check stack performance.' },
  cancelled: { meaning: 'The run was cancelled before this check.', next: 'Re-run.' },
  unsupported_operation: { meaning: 'Only SELECT is supported today.', next: 'Keep write checks in your own tests for now.' },
  unsupported_ownership_model: { meaning: 'Only single-owner tables are supported today.', next: 'Tenant and shared models are on the roadmap.' },
  unsupported_route: { meaning: 'Only the direct Data API route is supported today.', next: 'Test custom APIs separately.' },
  unsupported_environment_class: { meaning: 'Only local disposable environments are supported today.', next: 'Run against a local stack.' },
  unsupported_expectation: { meaning: 'The rule expects access that the single-owner model does not support (shared or delegated reads).', next: 'Keep the rule owner-only, or wait for shared-record support.' },
  unsupported_rule: { meaning: 'The approved rule is outside what this runner version supports.', next: 'Run `rowproof validate` on the rule.' },
  not_executed: { meaning: 'This check was not executed.', next: 'See the controls above.' },
};

export function explain(code: DiagnosticCode): Explanation {
  return EXPLANATIONS[code];
}
