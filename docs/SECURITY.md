# Security register

Every security defect found in this codebase, what was done about it, and what
is still open. Kept beside the code so a finding cannot quietly become folklore.

**How to read severity.** It is about what an attacker actually gets, not how
alarming the mechanism sounds. A cross-tenant data leak and a missing size cap
are not the same thing even when both are "a rules bug".

**The one structural fact behind most of this.** There is no application server.
The browser talks to Firestore directly, so `firestore.rules` is the only
enforcement that cannot be bypassed. Anything enforced in React — `can()`, a
hidden button, a disabled field — is a usability feature, not a control. Every
entry below marked *"enforced only in React"* means exactly that: the same
action succeeds from the browser console.

Two failure patterns account for most of the list, and both are worth
recognising on sight:

1. **The permissive union.** Firestore rules OR together. A narrow rule that
   refuses something is worthless if a broader `match` grants it. Found three
   times here.
2. **The post-state branch.** `request.resource.data` on an update is the state
   *after* the write. A rule that authorises against it lets the writer supply
   the value that authorises them. Found three times here.

---

## Open findings are not in this file

**This register is the CLOSED half only.** The open entries — findings that are
live, or accepted with a residual risk — were moved out of this repository on
2026-09-10 and are held privately by the maintainer.

This repository is public. A closed finding written up with its mechanism, its
fix and its test is a credential: it shows the defect was found, understood and
proven closed, and publishing it costs nothing because there is nothing left to
exploit. An **open** finding written up to the same standard is a different
document — it names a live weakness, its reachability, and where in the source
to look. An ISO 27001 audit (2026-09-09, finding H-2 under A.5.12 / A.8.4)
raised that both halves were being served to anyone who asked, and that the
second half was almost certainly not a decision anyone had made.

So the split is now explicit, and the rule for anything added here is:

> A finding goes in this file when it is closed. While it is open it lives in
> the private register, however well written up it is. If you are unsure whether
> something is exploitable as described, that uncertainty means private.

Ask the maintainer (see the root `SECURITY.md` for how to make contact) if you
need the open register — for a security review, a due-diligence request, or a
disclosure you are checking against what is already known.

Note that git history still holds the open entries as they stood before this
split, and rewriting it was considered and rejected: it would change every
commit SHA and orphan the `v*` release tags that tie each deployment to a
commit, which is a traceability control this project actively relies on.
Treating that history as public is the safer assumption, so the entries moved
out are being worked rather than merely hidden.

## Recently closed

### S-04 · Unbounded collection listeners — CLOSED

Every live collection listener in the app is now capped at
`COLLECTION_READ_CAP`, and every screen that totals one renders
`<IncompleteNotice>` when the cap is reached.

The shared seam — `subscribeCollections`, `subscribeOrgCollection`,
`incompleteReadNotice` — already existed and was already honest. What was left
was **adoption**, and the gaps were exactly where they hurt most:

- **`objectives` threw the signal away.** `ObjectivesContext` destructured
  `{ rows }` from `subscribeOrgCollection` and dropped `status`, so the KPI
  scorecard — the one screen whose numbers get quoted upward — reported a capped
  count as a real one.
- **The fire module capped SILENTLY, at five different ceilings.** Reports and
  mock drills at 1 000; signage, AEDs and FAS at 2 000; extinguishers at 2 000
  with a banner. So the dashboard said "the most recent 2 000 extinguishers"
  while the four other registers on the same page were being truncated with no
  mention — a caveat naming one of five short numbers reads as an assurance
  about the other four.
- **CCTV, committee, emergency, LOTO, audit and objectives had no cap at all.**

`e2e/capped-reads.spec.js` is what keeps this closed. It runs with
`VITE_TEST_READ_CAP` lowered so the seeded org is already past the ceiling, and
asserts the notice on every screen that totals a capped register. Without it,
"the notice exists and is unit tested" would keep being mistaken for "the page
asks for it".

### S-21 · The API server was removed — CLOSED

`server/` was an Express + firebase-admin service intended to take over the
write path. Nothing deployed it and no traffic reached it, but its
`src/authz/policy.js` was a hand-maintained second copy of eight
`firestore.rules` role helpers, annotated with the line ranges it mirrored and
tied to them by nothing. A silent divergence there would have become a hole on
the day the server first served — and the rules could not backstop it, because
the whole point of the service was to bypass them.

Removed rather than maintained: a standing drift risk paid for every month
against a benefit with no date on it. Recoverable from git history at
`b08dc1c` if the migration is revived. Note that `assertSegment` in
`functions/index.js` was the other half of that mirror and is now the only copy.

### S-22 · Root `/sites` was a granted collection nothing used — CLOSED

`isLegacyOrgCollection` in `firestore.rules` listed `sites`, granting read,
create, update and delete on a **top-level** `/sites` collection to any approved
member of any org. The site registry has always lived at
`/organizations/{orgId}/sites`; the only code that ever read the root one was
`src/modules/loto/services/sites.js`, which was imported by nothing.

So this was a whole collection's worth of permission that no code exercised —
the kind nobody can notice is wrong, because nothing fails when it is. Both the
dead file and the grant are gone, and `tests/firestore.rules.test.js` now
asserts the root path is denied for every role, with controls proving the real
org-scoped registry and the remaining LOTO top-level collections still work.

This moved the rules-test count by +7, which is the intended semantic change
`AGENTS.md` asks to be stated rather than assumed.

### S-23 · Colour contrast failed WCAG AA across the design system — CLOSED

Found by the axe pass added in `e2e/accessibility.spec.js`, and by nothing else
— the markup was correct, the colours were not.

`text-ink-400` (494 uses, the app's standard secondary text) measured **2.12:1**
on `clay-bg` against a 4.5:1 requirement; `text-ink-500` (372 uses, every field
label) measured 3.29:1. 43 offending nodes on the portal home alone. The
`ink-400`–`ink-900` ramp was re-spaced — same hue and saturation, lightness
lowered — and `50`–`300` left alone as the surface and border tones they are.

Two derived patterns had the same fault and are now computed rather than
hand-picked, in `src/shared/lib/contrast.js`:

- the soft badge used one colour as both its 10% fill and its text
  (`readableOnTint`), and
- the solid badge wrote white on a mid-tone fill (`solidBackground`).

## Closed

### S-05 · Console-only hardening — CLOSED

Moved to Closed. Recorded here in full because "it is a console toggle" is the
reason this sat open, and the toggles are not visible from the repository —
nothing in a diff will ever tell the next reader whether they were flipped.

Applied: **App Check is enforced** on the public write surfaces, **admin MFA
(TOTP) is enabled**, **application-layer encryption is on**, Firestore backups
are configured (PITR 7d plus a weekly schedule at 30d retention, `PRODUCTION.md`
§3), and the API key referrer restrictions are in place (`PRODUCTION.md` §9,
§9b).

Two things this does NOT close, kept visible on purpose:

- **App Check is the only volume control the anonymous QR surfaces have.**
  Rules cannot count requests. `/reports`, `/observations` and `/defectLocks`
  bound who may write and what they may say, never how often. Turning App Check
  off does not weaken those rules; it removes the only thing standing between a
  photographed QR sticker and unlimited writes on your bill.
- **Console state is not under version control.** There is no test, no CI job
  and no diff that fails if one of these is switched off later. Re-checking them
  belongs in whatever periodic review this project keeps, not in a code review.

### S-01 · Cloud Storage was not tenant-isolated — HIGH

`storage.rules` captured `{orgId}` in the path and checked it against nothing.
Any signed-in user of any tenant could read and delete any other tenant's
uploaded files if they knew the path — incident photos, permit documents, LOTO
procedure photos, training content.

**Fixed** by putting the organization on the ID token. Storage rules cannot
query Firestore, so a claim is the only thing they can learn about a caller;
`syncUserClaims` in `functions/index.js` mirrors `/users/{uid}` onto the token,
and only for an **approved** member — a pending joiner's profile already names
an org, since that is what the waiting room is, so minting a claim from it would
let anyone sign up naming a tenant and read its files at once.

An earlier draft used `firestore.get()`, which needs cross-service rules granted
on the project and costs a document read per file operation. The claim needs
neither and the check is local to the request.

**Two things the emulator caught before this shipped.**

Reading an absent claim as `request.auth.token.orgId` *raises* rather than
returning null. An erroring rule denies, so the outcome was right — but it was
right by accident, and it logged an evaluation error for every signed-in user
who had not been stamped, which during the cutover is all of them.

And the bigger one: **`allow update: if false` does not prevent an overwrite.**
Cloud Storage evaluates an upload onto an existing path as a **create**, so the
update denial never saw it. Both the deployed rules and this register previously
claimed that vector was closed. It was not — any signed-in user of any tenant
could replace another tenant's safety evidence in place, which is worse than
this entry described. Closed by `resource == null` on create, which needed no
claims and shipped ahead of the cutover.

`update` in Storage rules does not mean what it means in Firestore rules, and a
comment asserting a control is not the same as a test exercising one.

**Order mattered.** A token with no `orgId` is denied by every rule in the new
set, so deploying before the claims existed would have locked the organization
out of its own files. Sequence was: deploy functions → run `backfillClaims` →
confirm a real token actually carried the claim → then deploy the rules. The
confirmation step was not ceremony: the backfill reported `0 updated, 2 skipped`,
which is ambiguous between "everyone was already correct" and "nobody
qualified", and only the token settled it.

Verified in `tests/storage.rules.test.js` — 17 cases against the emulator,
minting tokens carrying the same claims `syncUserClaims` stamps.

### S-02 · Manager-only actions were enforced only in React — HIGH

Approving a permit, deciding a defect report, verifying an injury, closing a
finding: each was gated by `can()` in the UI and by nothing else, so the same
write went through unchallenged from the SDK. The value of an approval is that
only the approver could have made it.

**Fixed** by naming only the states that *record a decision* — writing each
module's state machine out in full would be unmaintainable and wrong the first
time someone added a status. `pending`, `draft` and `pending_approval` are
deliberately absent: asking is not deciding, and a member must still be able to
raise a record and submit it. Both directions are gated, because clearing an
approval is as much the approver's act as granting it.

Deliberately **not** decisions: an extinguisher reaching `closed` (refilled —
the ordinary end of the fire workflow), an inspection template going Active, and
a permit's `closedDueToObservation`. Stopping unsafe work is not approving it,
and a rule that sent someone to find a manager before they could stop it would be
a safety defect rather than a control.

The gate lives *inside* the generic collection rule rather than in per-collection
matches, because rules are a permissive union — a narrow match restricts nothing
while the generic one still grants the same write. One conjunct covers every
collection, so adding a module cannot forget it.

Two things fell out of doing it properly. The member branch on `/reports` and
`/observations` create is gone: it was the broader half of a union, and once
approving became a manager's act it would have let any member file a report that
was *already approved* and skip the queue. And `isWriterOf` now covers the QR
mirrors, defect locks, id counters and LOTO collections — each was still a place
an auditor could write.

One boundary that is deliberately **not** role-based: an auditor can still create
a defect lock when they hold a scanned token, because that branch authorises on
proof of physical scan and is open to a stranger with no account at all.
Refusing an auditor something any passer-by can do would be incoherent.

### S-03 · Duplicate reference numbers under concurrency — MEDIUM

`refNo` was issued by a read-then-write, so two reports filed at the same moment
took the same number — and these are the records quoted to a regulator.
**Fixed** with a transaction, following the pattern `reserve.js` already used.

### S-07 · Public QR mirrors could be captured by another tenant — HIGH

`/qr` and `/permitQr` allowed an update if the caller was a member of the org
named in the **post** state, so setting `orgId` to your own org satisfied the
rule regardless of who owned the document.

One signup makes anyone an approved admin of a throwaway org, and a QR token is
not a secret — it is printed on the sticker. Photographing someone else's
extinguisher label was therefore enough to re-point that unit's public page into
your own tenant, where every future defect report scanned from it would land
while the person scanning is told it was submitted and the owner's safety team
hears nothing. The attacker could then rewrite what the next scanner sees, or
delete the mirror so the printed label goes dead.

The permit mirror was worse: the same call lets an expired hot-work permit be
displayed to a fire watcher as approved.

**Fixed** by pinning `orgId` across the write. Costs nothing — every legitimate
writer already owns the mirror it is updating, and a merge write carries the
existing `orgId` into the post state.

**Why the tests missed it:** the existing cross-tenant test only ever sent
payloads that kept `orgId` unchanged, so it exercised the safe branch and never
the capture branch.

### S-08 · LOTO documents could be captured by another tenant — MEDIUM

The same post-state branch on the top-level `procedures` / `locks` /
`technicians` collections, which are tenanted by an `orgId` field rather than by
path. One update captured another org's live isolation procedure. **Fixed** the
same way.

### S-09 · Auditor could write — MEDIUM

`auditor` is documented as read-only across all modules and was read-only only in
React. An auditor is typically an outside party given a login to inspect the
safety record; editing the evidence they are auditing is the one thing the role
exists to prevent. **Fixed** — writes now go through `isWriterOf()`, which
excludes auditors.

### S-10 · A member could widen their own site access — MEDIUM

Self-update pinned `role`, `status` and `orgId`, but not `access` or `siteId`.
Since site-level documents are readable by whoever reaches the site, a member
could grant themselves every restricted document in the org from the browser
console — without touching their role, so nothing looked amiss. **Fixed** by
pinning both fields on the self-update branch. Requesting access still works;
the request is not the grant.

### S-11 · A joiner could choose an elevated role — MEDIUM

Self-registration required only `role != 'admin'`, so a stranger could join as
`manager`. Approval only flips `status` — nothing ever re-asserts the role — so
the admin clicking Approve on a routine-looking join request was granting the
role the joiner had picked. **Fixed** — self-join is `member`, full stop.
Promotion is the admin's to make, afterwards.

### S-12 · Audit log entries could be forged — MEDIUM

`auditLogs` create was unvalidated, so any approved member could write entries
attributing actions to an admin — in the one record that would otherwise show
them doing it. **Fixed** — `actorUid` is pinned to the caller's uid.

### S-13 · Stored XSS via attachment links — HIGH

`AttachmentField.jsx:132` bound a stored attachment URL straight to `href`. Both
the uploaded URL and the hand-typed reference link are attacker-controllable
text, so a colleague could store `javascript:` and wait for the next person to
click. **Fixed** — routed through the existing `safeHref`, which allows only
http(s); a rejected URL degrades to plain text.

### S-14 · Unbounded strings on the anonymous QR surface — LOW

Only `note` was capped; every other free string on the unauthenticated branch was
unlimited, making one scanned token a free megabyte-per-write channel into the
org's approval queue. **Fixed** — all of them capped.

### S-15 · CSV exports were formula-injection vectors — LOW

Exports never neutralised a leading `=`, `+`, `-` or `@`, which Excel,
LibreOffice and Sheets all evaluate as a formula. A trainee's own name typed as
`=WEBSERVICE(...)` runs on the safety manager's machine when they open the
register. **Fixed** — one shared serializer in `src/shared/lib/csv.js` quotes and
de-fangs, with numbers left alone so negatives survive.

### S-16 · CI deployed rules but never indexes — MEDIUM

Every composite index the app relies on existed only because someone had run a
deploy from a laptop; a fresh project would have had none. A missing index is a
hard runtime failure that never shows in the emulator. **Fixed** — indexes ship
with rules, and hosting is now a separate later step so the client cannot go live
ahead of what it depends on.

### S-17 · Site-scoped documents: the rule that looked enforced — HIGH

Documents filed at Site level are readable only by people whose access reaches
that site. The first implementation read the field defensively —
`resource.data.get('visibility', 'all')` — so that documents predating the field
would not break.

That silently disabled the boundary for list queries. `read` covers `get` and
`list`, and for a list Firestore must prove from the rule alone that the query
cannot return a refused document — which it can only do when the condition names
a field **directly**. Written defensively, the single-document `get` was still
refused but an unfiltered **list returned the whole collection, contents and
all**. The same is true of `!('visibility' in resource.data) || …` and of
`keys().hasAny([…])`; all three were checked against the emulator.

Every per-document test passed in all three forms. **Fixed** by reading the field
directly, which costs a mandatory backfill: direct access to a missing field
errors, and an erroring rule denies.

**Rule of thumb this leaves behind:** in any `allow read`, read the queried
document's fields directly. If you find yourself being defensive about a missing
field, you are turning the rule off for lists.

### S-18 · Earlier fixes

`orgIndex` tenant hijack at signup; the defect-lock denial-of-service on the
public QR surface; missing `keys().hasOnly()` on public `/reports` and
`/observations`; `/qr` and `/permitQr` being listable, which made the tokens
enumerable and turned the permit mirrors into a cross-tenant PII dump; and the
first round of URL-scheme validation before binding to `href`/`src`.

---

## Testing

`npm run test:rules` — **448 tests across 12 files** against the emulator. Needs
a JDK; the Firestore emulator is a JVM process.

A count in prose goes stale, and this one had: it read 149 for long enough to be
quoted as a fact in two other documents. Run the suite for the real number.

Two files matter most. `tests/hardening.rules.test.js` covers the write-boundary
fixes, and `tests/documents.rules.test.js` covers site scoping. Both **list as
well as get**, which is the specific thing the older tests did not do.

The lesson is worth stating plainly, because it is why several of these survived
a green suite for so long: *a rules test that only sends well-behaved payloads
tests the app, not the rule.* Send the payload an attacker would — the one that
sets `orgId` to itself, that claims a role, that asks for the whole collection.

One trap that has now bitten twice: a long-running emulator serves the rules it
started with. `npm run emulators:rules` reloads them. The unit tests never see
this because `initializeTestEnvironment` uploads the file per run — so a green
suite is not evidence that the emulator you are clicking around in agrees.

### S-18 · `xlsx` prototype pollution — CLOSED (residual risk accepted, narrowed)

`xlsx` (SheetJS) carries a prototype-pollution advisory with **no fixed version
on npm**, and it is a *runtime* dependency sitting directly on the untrusted-file
path — the Excel import in Fire (bulk asset upload) and Inspections (question
import).

**Why it is accepted rather than fixed today.** There is nothing to upgrade to:
SheetJS stopped publishing to npm, and the current build is distributed from
their own CDN. Swapping the dependency changes how every import and export in
the product parses files, which is not a change to make in the same commit as a
CI gate.

**What limits it meanwhile.** Both import paths are behind authentication — an
attacker needs an account in the tenant they are attacking. `shared/lib/
workbookGuard` caps file size and row count before parsing, so the classic
resource-exhaustion half is bounded. Prototype pollution remains possible for
someone who already has a login.

**How it is tracked.** `.github/workflows/ci.yml` blocks a merge on **critical**
advisories in the runtime tree, not high, precisely because of this one — a gate
that is red the day it ships teaches everyone to ignore it. The whole tree is
still reported on every run, so it cannot go quiet again.

**To close it:** migrate to the maintained SheetJS build, then raise the CI gate
from `critical` to `high` in the same change. The gate level is the tripwire that
says this is still open.

**Update — closed.** Every import now parses CSV through `shared/lib/parseTable`
(papaparse), so no untrusted file reaches SheetJS. `xlsx` remains a dependency
because the seven EXPORT paths still write real workbooks, and writing from data
we already hold is not a parsing surface — which is the whole of this advisory.

The CI gate was raised from `critical` to **high** at the same time, which was
the tripwire this entry set. It runs `scripts/audit-gate.mjs`: blocks on high and
above, allows a NAMED list, and each entry must state why it is tolerable and
what closes it. Lowering a threshold hides every other advisory at that level;
an allowlist hides exactly one, by name, and reports itself when stale.

To remove the last of it: drop `xlsx` entirely, or move exports to the
maintained SheetJS build, then delete the allowlist entry.
