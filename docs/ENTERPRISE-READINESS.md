# Enterprise readiness

An honest assessment of what this app would meet, and what it would fail, in a
mid-to-large enterprise procurement or security review. Written against what is
in the repository today, not what is planned.

**Short answer: yes for the security review, with caveats on data lifecycle and
compliance paperwork.** The two items that used to stop a deal on their own —
no backups, and file storage that was not tenant-isolated — are both closed.

**Read this next to `SECURITY.md`, not instead of it.** That file is the
authority on what is open; this one is the buyer-facing summary. Where they
disagree, `SECURITY.md` is right.

---

## Scorecard

| Area | State | Verdict |
|---|---|---|
| Tenant isolation (database) | Org-scoped paths, enforced in rules, 448 rules tests | **Ready** |
| Tenant isolation (files) | `orgId` claim on the token, enforced in `storage.rules` | **Ready** |
| Authentication | SAML/OIDC implemented and configured | **Ready** |
| MFA | TOTP, self-service enrolment, enabled | **Ready** |
| Authorization | 4 roles, site scoping, manager-only decisions — all in rules | **Ready** |
| Audit trail | Append-only, immutable, actor pinned to caller | **Ready** |
| Encryption at rest (application layer) | Envelope encryption, escrowed master key in Secret Manager, on | **Ready** |
| Abuse control on public surfaces | App Check enforced | **Ready** |
| Backups / disaster recovery | PITR (7d) + weekly schedule (30d), delete protection, **restore drilled** 2026-08-16 | **Ready** |
| Observability | Sentry wired with a DSN. No metrics, no uptime check, no on-call path | **Partial** |
| Data lifecycle — export | Subject access implemented (`exportSubjectData`) | **Ready** |
| Data lifecycle — erasure & retention | Classified, not executed. No retention periods | **Gap** |
| Testing | 1754 unit, 448 rules, 357 functions, server suite, e2e smoke | **Ready** |
| CI/CD | Lint, tests (all four suites), build, audit gate; ordered deploy | **Ready** |
| Environments | Staging pipeline built; production ships on a version tag | **Ready in code** |
| Secrets handling | Nothing committed; client keys are appropriately public | **Ready** |
| Scalability | Uncapped collection listeners (`SECURITY.md` S-04) | **Gap** |
| Compliance artifacts | ISO 27001 self-audit written. No DPA, no subprocessor list, no pen test, no certification | **Gap** |

---

## What closed, and what it took

**File storage is tenant-isolated.** The blocker was that `storage.rules` could
only see what the ID token claimed, and the token carried no `orgId`. Only the
Admin SDK can set a custom claim, and there was no `functions/` tier to do it.
`syncUserClaims` and `backfillClaims` are live in `asia-south1`, the claim is on
the token, and the stricter ruleset is deployed. `SECURITY.md` S-01.

**Manager-only actions are enforced in rules.** Approving permits, deciding
defect reports and managing sites were gated in React only, so an ordinary
member could do them from the SDK. For a safety system that mattered more than
it sounds: the value of an approval is that only the approver could have made
it. `SECURITY.md` S-02.

**Backups exist and a restore has actually been performed.** PITR with a 7-day
window, a weekly scheduled export at 30-day retention, and delete protection —
plus a drill on 2026-08-16 that restored a real backup into a scratch database
in about 15 minutes. That distinction is the whole point: a backup nobody has
restored is a belief, not a control. `PRODUCTION.md` §3 and §3a, and §3a is
worth reading *before* you need it, because a restore in progress looks exactly
like an empty backup for most of its run.

**Console hardening is applied.** App Check on the public write surfaces, TOTP
for admins, application-layer encryption on, API key referrer restrictions.
`SECURITY.md` S-05, now closed.

---

## The remaining gaps

**No data lifecycle beyond export.** Subject access works: `exportSubjectData`
gathers a person's records, manager-gated and org-scoped, and reports the
collections it could not read rather than omitting them silently. Erasure is
*classified but not executed*, and that is deliberate — in an occupational
health system the honest answer to "delete everything about me" is mostly "most
of this cannot be deleted, and here is each part and why". What is genuinely
missing is **retention periods**: a record classed `STATUTORY` is currently kept
forever, and indefinite retention is not lawful merely because some retention
is. See `DATA-RIGHTS.md`, including the warning that the retention table is an
engineering reading of the law and needs someone with legal authority to sign it
off. A buyer's privacy review will ask.

**One trap worth naming, because encryption is now on.** Every field the
subject-access "mentions" scan would search is a field the crypto policy seals.
A server-side scan for a name therefore reads ciphertext and finds nothing — and
**zero matches is indistinguishable from a person who is genuinely not
mentioned**. That is a silent wrong answer to a legal request.
`scanFeasibility()` exists to say so out loud; the mentions half must be done in
the browser of somebody entitled to the keys, or recorded as not performed. It
must never be reported as "none found". `DATA-RIGHTS.md` §2.

**Nothing is watching in real time.** Sentry has a DSN, so errors reach
somebody. There are still no metrics, no uptime check and no on-call path, so
the way you find out production is *down* — as opposed to throwing — is that a
user tells you.

**Scalability has a known ceiling.** Whole collections are read with no limit
(`SECURITY.md` S-04) and aggregation happens in the browser. The analytics page
opens eleven such listeners at once. Fine now; a tenant with tens of thousands
of records will find the edge.

**Compliance artifacts are thin.** `ISO27001-AUDIT.md` is a substantial internal
self-audit, which is real work and worth showing. It is not a certification. No
DPA template, no data-flow or subprocessor list, no security whitepaper, no
penetration test, no SOC 2 or ISO 27001. Assembling these takes months of
calendar time — worth starting before the first enterprise deal, not during it.

**Console state is invisible to version control.** App Check, MFA, the API key
restrictions, backups — all of them are toggles in a console, and nothing in
this repository fails if one is switched off later. There is no test for it and
no diff that shows it. Re-verifying them belongs in a periodic review.

---

## What is genuinely strong

Worth saying plainly, because gap lists read worse than the system is:

- **Tenancy is enforced where it cannot be bypassed.** Not in middleware someone
  can forget to call — in rules, with 455 tests that send hostile payloads
  rather than well-behaved ones.
- **The audit trail is real.** Append-only, no updates, no deletes, entries
  pinned to the caller.
- **The public QR surfaces are tightly bound.** An anonymous write must present
  a token that resolves to the org and the asset being written to, so a write is
  tied to physical access to the equipment. Sharper than most products manage on
  an unauthenticated endpoint.
- **The seams are real.** Storage and data sit behind adapters with a documented
  contract, so swapping infrastructure is a file, not a project.
- **The deploy order is understood and written down**, including the failure
  modes that motivated it — rules before hosting, backfill before rules.
- **The security register is kept honestly.** Findings are written up with what
  the attacker actually gets, including the ones that are still open.

---

## Suggested order

1. Retention periods and an erasure decision signed off by someone with legal
   authority (`DATA-RIGHTS.md` §3) — the largest remaining gap, and the one a
   privacy review will find first
2. An uptime check and one alert, so a total outage is not user-reported
3. DPA template, data-flow diagram and subprocessor list — paperwork, but it is
   what actually gets asked for
4. A penetration test, once 1–3 are done

---

## Decisions taken, so they are not re-litigated

Written down because each of these looks like an oversight from the outside, and
each one is a choice.

### Accessibility — WCAG 2.1 AA, enforced two ways

A buyer asking for a VPAT or an accessibility statement can be pointed at
something real rather than an intention:

- **`eslint-plugin-jsx-a11y` at `error`, not `warn`.** Every rule in the
  recommended set, plus `control-has-associated-label`, is enforced and at zero.
  The gate was built as a ratchet — each rule sat at `warn` while its backlog was
  cleared and moved to `error` in the change that cleared it — and the ratchet is
  now fully wound. It cannot regress without failing CI.
- **`@axe-core/playwright` against the rendered DOM** (`e2e/accessibility.spec.js`),
  failing on any serious or critical WCAG 2.1 A/AA violation, over the portal, a
  list page, a form and an open dialog.

Both halves are load-bearing and neither is redundant. The dominant form control
in this app binds its label to its input at runtime, which is invisible to a
static rule and plain to axe; an icon-only button with no name is the reverse.
Static lint for what is statically visible, axe for the rest.

What this found that no review had: the colour palette failed AA at its two
most-used text stops (`SECURITY.md` S-23). The markup was right and the colours
were wrong, which is precisely the class of defect a code review cannot see.

### Offline — not supported, deliberately

Firestore's `persistentLocalCache` is enabled, so data survives a connection
drop and the app keeps working while it is open. There is **no service worker
and no web app manifest**: the app is not installable, and a hard refresh with no
signal is a blank page.

That is a known limit, not an omission. It was assessed and declined: the users
are online in practice, and a service worker brings a cache-invalidation surface
that has to be right on every deploy — a real cost against a benefit nobody has
asked for.

If a customer does require offline capture — field inspections in a plant room
with no signal is the plausible case — treat it as a project, not a patch. The
data path is the easy half; the hard half is conflict resolution on a permit or
an isolation procedure that two people edited while apart, and that is a safety
decision before it is a technical one.
