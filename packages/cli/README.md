# RowProof

**Owner-approved access rules for Supabase, checked against real requests on every release.**

RowProof turns "Alice reads Alice's invoices, Bob never sees them" into a versioned rule that the data owner approves. It then checks the rule through the real Supabase Data API, with real Auth tokens, on a disposable local stack. If a policy change exposes one user's rows to another, `rowproof run` exits 1 and names the exact record and rule revision.

```bash
npm install -g rowproof
```

```bash
rowproof init --table invoices --owner-column owner_id --marker-column title
```

```bash
rowproof fixture provision --rule invoices-owner-read.rule.json
```

```bash
rowproof doctor --rule invoices-owner-read.rule.json --credentials .rowproof/local.env
```

Then propose, approve (the owner acknowledges an exact content hash) and run:

```bash
rowproof run --store .rowproof/approvals --rule invoices-owner-read --credentials .rowproof/local.env --html report.html --junit junit.xml
```

Exit codes: `0` every approved expectation held with all controls established, `1` a demonstrated violation, `2` blocked or incomplete (never a pass).

- Scope today: SELECT through the Supabase Data API on user-owned tables, against a local disposable stack. Not a pentest or certification.
- No production access and no customer data. Credentials stay on your machine and never appear in outputs.
- Docs, CI template and source: https://github.com/Shreyastacky/row-proof

License: FSL-1.1-ALv2. Free to use, including commercially for your own apps. Competing products and services are not permitted. Each version becomes Apache-2.0 two years after release.
