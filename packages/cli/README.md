# Pyx

**Review who gained or lost access before each Supabase release.**

Pyx signs in as test users on a disposable local copy of your app and asks for records they must not see, through the Supabase Data API, your RPC functions and your own API routes. Each release, it tells you who can now read what:

```text
GAINED ACCESS  user-a can now read invoice-b  [app-invoice-route]
```

```bash
npm install -g pyx-cli
```

```bash
pyx init --table invoices --owner-column owner_id --marker-column title
```

```bash
pyx fixture provision --rule invoices-owner-read.rule.json
```

```bash
pyx doctor --rule invoices-owner-read.rule.json --credentials .pyx/local.env
```

The data owner approves the rule (`pyx propose`, `pyx diff`, `pyx approve --acknowledge <hash> --promote`). Then:

```bash
pyx run --store .pyx/approvals --rule invoices-owner-read --credentials .pyx/local.env --html report.html --requests ledger.json --compare-to last-release.json
```

| Command | What it does |
| --- | --- |
| `run` | Checks the approved rule; `--html`, `--junit`, `--summary-md`, `--requests` (request ledger), `--compare-to` |
| `compare` | Who gained or lost access between two results |
| `repro` | A README and curl script for every failing check, with no credentials |
| `init`, `fixture`, `doctor` | Scaffold a rule, create synthetic users and records locally, diagnose setup |
| `validate`, `hash`, `propose`, `diff`, `approve`, `promote`, `history` | The approval workflow |
| `report` | An HTML report from one or more results |

Exit codes: `0` every approved check held, `1` someone can read what they must not (or an owner lost access), `2` blocked or incomplete, never a pass.

- Local disposable stacks and synthetic data only. No production access. Credentials never appear in any output.
- Scope: reads by id on user-owned records. Not a penetration test or a certification. See the [benchmark](https://github.com/Shreyastacky/row-proof/blob/HEAD/docs/BENCHMARK.md) for what it catches and misses.
- Source, docs and the CI template: https://github.com/Shreyastacky/row-proof

License: FSL-1.1-ALv2. Free to use on your own apps and in client work. Building a competing product or service is not permitted. Each version becomes Apache-2.0 two years after release.
