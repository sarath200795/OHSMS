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

## Open

### S-04 · Unbounded collection listeners — LOW

`subscribeCollection` (`src/shared/org/orgData.js:354`) reads whole collections
with no limit. Cost and browser memory grow with tenant size, and the analytics
page opens eleven of them at once. Fine at current scale; worth capping before a
tenant with tens of thousands of records arrives.

### S-05 · Console-only hardening not yet applied — MEDIUM

Tracked in `PRODUCTION.md`; listed here so the register is complete. App Check is
not enforced on the public write surfaces, admin accounts have no MFA, Firestore
backups are not configured, and the referrer restrictions on the Maps API key
that ships in the bundle are unverified.

### S-06 · Deferred dependency advisories — MEDIUM

`jspdf` 2.5.2 (rated critical) and `jspdf-autotable` — fixes are two major
versions up on each. The headline advisories are unreachable: the app never calls
`AcroForm` or `addJS`. What is reachable is `addImage`, which takes user-uploaded
LOTO photos, so a crafted BMP or GIF hangs the tab of whoever generates the PDF.
Client-side denial of service by an authenticated member.

`xlsx` 0.18.5 has no fix on npm — SheetJS publishes to its own CDN now. The
prototype-pollution sink was tested and is unreachable; the ReDoS is reachable
but only against a workbook the user chose to open in their own browser.

### S-07 · Encryption covers new writes only — MEDIUM

Application-layer encryption is in (`src/shared/crypto/`, docs/PRODUCTION.md §11)
and seals the fields named in `policy.js` before they reach Firestore. Three
things it does not yet reach, listed here so none of them becomes folklore:

**History in Firestore.** *Closed — needs running.* Turning `VITE_ENCRYPTION=on`
seals new writes only, so every incident, injury, illness, meeting and drill
already stored stayed readable in the database. Same shape as every other
finding closed here — `stripIncidentMedicalDetail`, `backfillDocumentVisibility`,
`confineMedicalRecords` — and the same reasoning: *closing the write path closes
nothing already stored, and what is already stored is the exposure.*

`src/shared/crypto/backfill.js` does it, from a card on the Maintenance page.
Nothing is written until the sealed copy has been decrypted again and compared
field by field against the plaintext it would replace — and that check runs
*before* the destructive write, not after, because this migration overwrites
rather than copies, so there is no moment afterwards where the plaintext still
exists to compare against.

It runs in the browser, not as a Cloud Function like its neighbours, and that is
the one decision worth knowing about. The AAD bound into every sealed value *is*
the policy path string, so a server-side copy of the policy table drifting by one
character would seal records that nothing could ever open again — silent,
permanent, and undetectable at both write and read time. Running it through the
app's own `sealDoc` means there is one implementation and it cannot disagree with
itself.

**It has not been run against production.** Encryption is still off there, and
the job refuses to start with sealing disabled.

**Bucket objects already stored are still plaintext.** *Closed for new uploads.*
Incident photos, drill evidence and illness attachments now encrypt their bytes
too, alongside medical records. The obstacle was that every gallery reads one
field — `.dataUrl`, normalised from `data.dataUrl || data.url` — and an
encrypted object breaks that: `.url` points at ciphertext, and an `<img>` given
it renders a broken picture. Rather than move a dozen renderers including the
three PDF paths, the decryption happens at the seam
(`src/shared/storage/resolveFiles.js`), so no renderer changed. Turning it on
was safe for history because an unsealed object carries no encryption metadata,
so nothing is fetched and it keeps the URL it always had.

The objects *already in the bucket* are handled by `sealStoredObjects`
(`functions/lib/objectSeal.js`), from a second card on the Maintenance page.
Write the sealed copy to a new path, download it back and decrypt it, re-point
the document, and only then delete the plaintext — the ordering
`confineMedicalRecords` uses, because sealing in place would overwrite the only
copy with bytes nobody has read back. One truncated upload and the photograph is
gone with the pointer still confidently naming it.

This is the **one** part of the encryption work that runs server-side, and it
therefore pays the duplication cost the Firestore backfill refused: the AAD
format string, the per-class file label, the two scheme tags and the pointer
field names all exist twice. That is four constants rather than a table of forty
field paths — and it is not left to a comment. `objectSeal.crossSeam.test.js` is
the only test in the project that imports across the package seam, deliberately:
it seals with the server code and opens with the client code, in both key
classes, both directions. If the two ever disagree about a byte it goes red
there instead of silently producing a bucket nothing can open.

**Neither backfill has been run against production.** Encryption is still off
there; the field job refuses to start with sealing disabled, and the object job
refuses an organization that has no keyset yet.

**`/users` is not sealed.** Names are personal data and they are in the clear
there. This is deliberate rather than missed: `firestore.rules` reads that
document on every evaluation and cannot decrypt, and a name is denormalised onto
dozens of records (`createdByName`, `personName`, `loggedBy`, `owner`,
`attendees[].name`). Those copies *are* sealed. Sealing the directory too is a
separate change that has to take email, sign-in and provisioning with it —
and sealing it while the copies stayed readable would be exactly the
"confine one copy and call it confined" mistake the injury/incident split was
made to correct.

One thing no encryption can undo, recorded because it will be asked: any
`getDownloadURL` handed out before an object was sealed is a bearer link that
answers to no rule, and anything already downloaded is simply gone.

---

### S-19 · Storage honours a revoked token for up to an hour — MEDIUM

*Deletion: closed. Reading: bounded and accepted. Stays here until read is
closed too, or until someone decides it never will be.*

The two enforcement surfaces learn about a person differently, and that
difference is the whole finding.

`firestore.rules` re-reads `/users/{uid}` on **every** rule evaluation, so
suspending, moving or demoting someone bites the instant the document is
written. `storage.rules` cannot read Firestore, so it reads `orgId` and `role`
off the **presented ID token** — and an ID token stays valid, cryptographically,
until it expires. Up to an hour.

So a person who has just been suspended keeps whatever Storage access their
cached token still claims. If they were a manager, that includes deleting any
file in the tenant: incident photos, permit documents, isolation procedure
photos, drill evidence. Deletion is unrecoverable and leaves nothing in the
audit trail, which only records what the app chose to write.

**What already narrows it.** `syncUserClaims` strips the claims and, on a
*reduction*, calls `revokeRefreshTokens(uid)`. That does not shorten the window
— rules do not consult `tokensValidAfterTime`, so the current token remains
valid to its expiry either way — but it changes the ending: the session
terminates rather than quietly continuing in a downgraded state, and no new
token can be minted.

**One reduction it did not recognise, now fixed.** `revokesAccess` decided
"reduction" by asking whether the person had been `admin`/`manager` and no
longer was — which models the DELETE right and nothing else. `storage.rules`
gates two rights on role, and the second was invisible to it: a **member demoted
to auditor** loses the right to write (`canWriteTo` excludes auditors) while
never having been elevated, so no reduction was detected, no session was
revoked, and an outside party given a login to inspect the safety record could
keep uploading into the tenant for the rest of the hour. The rule itself was
correct and tested (`tests/storage.rules.test.js` refuses an auditor's upload);
only the revocation disagreed with it.

Fixed by deriving the decision from a single `storageRights(role)` mapping that
states what `storage.rules` grants, so the two files cannot drift again without
a test failing. `functions/lib/claims.test.js` covers every role transition in
both directions.

**The hour itself: CLOSED for deletion, by moving the check off the rules.**

`storage.rules` now refuses client deletes outright — `canDeleteFrom` is
`false`, for everyone, including a manager. Deletion goes through the
`deleteOrgFile` callable, which reads the caller's `/users` profile **live** on
every request and applies `mayDeleteFile` (`functions/lib/fileDelete.js`):
approved, not on a provisioning password, `admin`/`manager`, and the path inside
that org's own prefix. The database decides at the moment of the request, so a
token issued before the account changed carries no weight at all.

The client change was one file, because every delete in the app already funnels
through `removeFile` in `src/shared/storage/index.js`. Non-Firebase drivers keep
deleting directly — the callable is Firebase-specific, and an S3 deployment
authorises at its own presign endpoint.

This also closes a clause a custom claim could never carry: `isManagerOf` in
`firestore.rules` refuses an account still holding the password a provisioning
admin typed for it, so such an account reaches nothing in Firestore — while
Storage let it delete, because `mustChangePassword` is not on the token.

**Read this before ever moving the check back into the rules.** The obvious fix
— a cross-service `firestore.get()` inside `canDeleteFrom()` — was written in
full, with tests, and reverted. **The Storage emulator does not evaluate
cross-service calls**: it refuses `firestore.get()` / `firestore.exists()`
outright instead of resolving them. Confirmed with a minimal probe — a rule
reading nothing passed; the identical rule guarded by `firestore.exists()`
refused a caller whose document was definitely present.

The rule was probably *correct*; in production with the IAM grant it would
work. That is not the same as safe to ship. It would have gone into the only
enforcement boundary this app has, unverifiable, with a failure mode of every
manager silently losing the ability to delete.

**And how it failed is the lesson worth keeping.** With that rule in place every
*refusal* test still passed — because everything was refusing. Only the two
tests asserting a legitimate manager CAN delete went red. A suite of green
negatives is exactly how a rule that enforces nothing, or everything, reaches
production unnoticed; it is S-17 in a different file. The tempting repair —
delete the two failing positives to get green — would not have tested the
control, it would have removed the only thing that noticed.

**What is still bounded rather than closed:** READ. A stale token can still read
files of the org it names until it expires. That is deliberate: routing reads
through a callable would put a function invocation behind every photograph the
app renders, and an hour of continued read access to files the person could
already see is a far smaller thing than destroying the evidence. Claims are
stripped immediately and refresh tokens revoked, so it remains at most one token
lifetime.

Verified in `functions/lib/fileDelete.test.js` (every branch, including the
manager whose profile has since been suspended, demoted or moved) and in
`tests/storage.rules.test.js` / `tests/medicalRecords.rules.test.js`, which now
assert that **no** client may delete — if any of those starts passing, the
callable has been bypassed.

## Closed

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

`npm run test:rules` — 149 tests against the emulator.

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
