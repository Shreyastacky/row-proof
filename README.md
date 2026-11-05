# Ship Safe

**Keep agreed access rules intact as your app changes.**

Ship Safe is an early-stage project for maintaining permission expectations and checking whether supported application behavior still matches them after a release.

The first proposed integration is Supabase: two synthetic users should each be able to read their own invoice and should never receive the other user's invoice through the tested Data API route.

## Current status

**Planning foundation only. There is no working runner, hosted application, or security assessment service in this repository yet.**

This repository contains the product scope, architecture, acceptance criteria, and implementation backlog. The first milestone is a reproducible local demonstration of one access boundary.

The existing Ship Safe checklist/kit and the separate `ship-safe-check` secrets scanner are earlier products. They are not implementations of Access Rules. Paid kit files, customer information, and internal research are not included here.

## First supported boundary

| Request | Required observation |
| --- | --- |
| User A reads invoice A | Exact synthetic fixture is returned |
| User B reads invoice B | Exact synthetic fixture is returned |
| User A reads invoice B | Invoice B is not disclosed |
| User B reads invoice A | Invoice A is not disclosed |
| Anonymous reads invoice A and invoice B | Neither fixture is disclosed; two assertions |

Positive owner reads must work before denied reads can establish a passing isolation result. A failed login, missing fixture, timeout, or broken endpoint must never turn into a green result.

## Start here

1. Read [the product scope](docs/PRODUCT.md).
2. Follow [the ordered implementation roadmap](ROADMAP.md).
3. Use [the acceptance scenarios](docs/ACCEPTANCE.md) as the definition of working behavior.
4. Review [the architecture](docs/ARCHITECTURE.md) before choosing dependencies.

Work is tracked in [nine implementation issues](https://github.com/Shreyastacky/ship-safe/issues). Start with [#1: the rule contract](https://github.com/Shreyastacky/ship-safe/issues/1).

## Planned layout

```text
apps/web/              Hosted rule review and run history (not implemented)
packages/runner/       Customer-run checks (not implemented)
supabase/              Disposable demo schema and fixtures (not implemented)
examples/              Synthetic rule proposal
docs/                  Scope, architecture, acceptance scenarios
```

No installation command is provided until executable software exists. See [the illustrative rule proposal](examples/invoice-rule.proposed.json); it is not an approved rule or a stable configuration format.

## Result language

- **passed / failed**: a supported assertion completed against the named fixtures and environment.
- **blocked**: execution or setup did not produce a trustworthy assessment.
- **not assessed**: the requested behavior is outside supported coverage.
- **current / stale / unknown**: separate evidence freshness, based only on available observations.

A passing run describes those checks at that time. It does not certify an application, cover every access path, or establish production parity. Customer-produced results can also be forged by a customer-controlled runner.

## Development priorities

Build the local fixture, explicit rule model, and reliable runner first. Prove the runner detects a deliberately broken policy in a disposable local database. Add CI, approval history, and a hosted interface after that foundation works. Validate repeat customer use before expanding the supported surface.

## Repository visibility and rights

This repository is public for development visibility. No open-source license has been selected; public visibility alone does not grant a license to reuse the project. See [contribution guidance](CONTRIBUTING.md) and [security reporting](SECURITY.md).
