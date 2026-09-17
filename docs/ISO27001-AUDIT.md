# ISO/IEC 27001 audit reports — moved out of this repository

**This file is a pointer. The audit reports themselves are private.**

Moved on 2026-09-10, by the recommendation of the second of them.

## What was here

The internal Annex A audit of 13 August 2026 and its triage of 16 August: three
HIGH findings, forty MEDIUM and thirty-five LOW, each written up with the
mechanism, the `file:line` of the vulnerable predicate and — in two cases — a
reproduction confirmed against the emulator.

A follow-up audit on 9 September 2026 re-verified every finding the first left
open, and raised as its second-highest finding that this document was being
served to anyone who asked for it. Its own words on why that is a different
decision from publishing the ruleset:

> Publishing `firestore.rules` is a defensible choice, and arguably a good one —
> a rule whose strength depends on nobody reading it is not a rule. The same is
> true of the closed half of the register: a documented, fixed finding is a
> credential. The finding is that the *open* half is published alongside it, in
> the same file, under a heading that identifies it as open.

## Where the work is visible instead

The audits are private; what they produced is not, and most of it is legible
from the repository itself:

- `docs/SECURITY.md` — the closed register, entry by entry, each with what was
  tried, what was rejected and why.
- `tests/` — 584 security-rules tests against the emulator. Several exist
  because an audit finding said the rule was decorative; a few are inverted
  older tests, where the vulnerability had been written down as expected
  behaviour.
- `.github/workflows/ci.yml` and `scripts/audit-gate.mjs` — the dependency gate
  a finding asked for, including the distinction between what ships and what
  only builds.
- `docs/DATA-RIGHTS.md` — the privacy classification, and the retention
  decisions still open, stated as open.

## Asking for a copy

Contact the maintainer as described in the root `SECURITY.md`. A due-diligence
or security-review request is exactly what these documents are for; they are
private because an unremediated finding is an instruction, not because the work
is embarrassing.
