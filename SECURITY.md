# Security reporting

This project is an early prototype. It is not a security certification service. The runner checks one synthetic read boundary on disposable local Supabase stacks; it has not had an independent security review.

Please do not include live secrets, customer data, private endpoints, or exploitable private details in public issues. For sensitive reports, email **stackdrawn@gmail.com** with a minimal redacted reproduction and the affected revision. Do not send credentials or production records.

Use only environments you are authorized to test. The runner is limited to synthetic fixtures and bounded read checks against loopback (local disposable) targets. Remote targets are rejected until separately implemented and tested.

No response-time commitment or bug bounty is offered at this stage.
