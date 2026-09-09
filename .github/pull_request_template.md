<!--
Keep this short. The point is not paperwork — it is that the two questions
below get asked before a change lands rather than during an audit.
Delete any section that genuinely does not apply.
-->

## What this changes, and why

<!-- The problem first, then the fix. If there is a defect or finding id, name it. -->

## Security impact

<!--
Answer this even when the answer is "none" — "none" is a useful thing to have
said on the record. Tick anything this PR touches:
-->

- [ ] `firestore.rules` or `storage.rules` — **who can read or write what changes**
- [ ] `src/shared/crypto/` — which fields are encrypted, or under which key class
- [ ] `functions/lib/retention.js` — what gets destroyed, or when
- [ ] `functions/lib/claims.js` — the token claim `storage.rules` enforces on
- [ ] `.github/workflows/` — the pipeline that deploys all of the above
- [ ] A new dependency, or a new external service the app talks to
- [ ] Personal or health data reaches somewhere it did not before (a log, an
      export, a third party, a wider audience inside the app)
- [ ] None of the above

If any box above is ticked, say what a mistake in it would expose:

## Evidence it works

<!--
Not "tests pass" — CI says that. Which test would fail if this change were
reverted or subtly wrong? A rules change should name the assertion in tests/
that covers the new permission, in both directions: what is now allowed, and
what is still refused.
-->

## Anything deliberately left undone

<!--
Known gaps, follow-ups, accepted risks. If this PR closes part of a finding and
leaves the rest, say which part — a half-closed finding recorded as closed is
worse than one left open.
-->
