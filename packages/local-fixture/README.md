# @rowproof/local-fixture

Privileged, local-only setup tooling for the disposable demo. It is not part of the runner.

`provision` reads the local stack's keys from `supabase status`. It refuses non-loopback targets and targets that differ from the rule's approved origin. Then it:

1. deletes and recreates each synthetic user with its fixed id through the Auth admin API;
2. replaces the rule's fixture rows;
3. signs each user in with an isolated client (no persisted session, no auto-refresh);
4. verifies each token with `auth.getUser(jwt)` and each fixture's owner and marker through the setup channel;
5. writes credentials to `.rowproof/local.env` with mode 0600.

Every SDK error is checked and reported as a step plus status code, never as a raw payload. `verify` repeats step 4 without changing anything.
