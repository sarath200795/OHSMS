# Compliance drafts

**DRAFT. Not legal advice. Not a signed DPA, not a certification, not evidence
that a penetration test has been performed.**

These documents exist because an enterprise buyer will ask for them, and
assembling them during the first deal is how they ship late and wrong. Each
file is a stub the owner (and counsel) can complete.

| File | What a buyer asks | Status |
|---|---|---|
| [DPA-TEMPLATE.md](./DPA-TEMPLATE.md) | Data processing agreement | DRAFT stub |
| [SUBPROCESSORS.md](./SUBPROCESSORS.md) | Who else sees tenant data | DRAFT, derived from what the app actually uses |
| [PENTEST-SCOPE.md](./PENTEST-SCOPE.md) | What a test should cover | DRAFT outline |

Related, already in the repository and **not** drafts:

- `docs/DATA-RIGHTS.md` — subject access, erasure classification, retention
  decisions still waiting on counsel.
- `docs/SECURITY.md` — closed findings register.
- `docs/ADR-0001-malware-scanning.md` — why sniff ≠ malware scan.
- Root `SECURITY.md` — how to report a vulnerability.

Do not copy operational detail from the private production runbook into these
files. This repository is public.
