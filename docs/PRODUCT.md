# Product scope

## User and job

The initial user is an agency or developer maintaining an authenticated Supabase application with a conventional user-owned or tenant-owned resource. The job is to preserve an explicitly agreed permission boundary across releases and explain a concrete change in observed behavior.

This is a product hypothesis. Demand, setup time, willingness to pay, and repeat use have not been established for this workflow.

## First slice

Support a customer-controlled local or authorized non-production environment, a single resource, SELECT through the direct Supabase Data API, and synthetic users/fixtures. Ship one demonstrable invoice isolation rule before generalizing.

The initial demo uses per-user ownership. Tenant membership introduces additional setup and must be implemented and tested explicitly before claiming tenant-owned support.

The owner agrees to both permitted reads and denied reads. AI may help draft expectations; it does not approve business intent. Proposed changes require explicit owner approval independently of normal application-code edits.

## Outcomes

| State | Meaning |
| --- | --- |
| passed | A supported assertion completed and matched the approved expectation |
| failed | A supported assertion completed and contradicted the approved expectation |
| blocked | Setup/execution could not establish a trustworthy assessment |
| not assessed | Unsupported behavior or an assertion not executed |

Freshness is separate: current relative to available observations, stale after observed relevant changes, or unknown when dependencies/observations are incomplete. A failed run can also become stale.

Run-level summaries must not turn a partially executed matrix into an overall pass. If a valid forbidden read discloses a fixture, retain that concrete failure even if another assertion is blocked.

## Trust boundaries

- Customers authorize the exact environments and test scope. A URL alone is insufficient authority.
- Credentials and raw fixture responses stay in the customer execution environment.
- Hosted results are bounded, redacted, customer-produced observations.
- A compromised or malicious runner can forge results. A signature identifies provenance, not truthful execution.
- Staging observations do not establish production behavior.
- No observer means no claim of continuous detection of out-of-band changes.

## Explicit exclusions

The first slice does not assess writes, deletes, sharing exceptions, delegated roles, storage, edge functions, arbitrary application endpoints, payments, injection, infrastructure, or overall application security.

Do not market it as certification, hacker-proofing, a complete security review, or proof that every data leak is caught.
