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

### S-01 · Cloud Storage is not tenant-isolated — HIGH

`storage.rules` captures `{orgId}` in the path and never checks it. Any signed-in
user of any tenant can read and delete any other tenant's uploaded files if they
know the path — incident photos, permit documents, LOTO procedure photos,
training content.

Uploads are at least safe from being overwritten in place: `update` is denied
outright and every upload lands on a random path, so evidence cannot be swapped
under an existing record.

**Why it is still open.** Binding a caller to an org in Storage rules needs
either cross-service Firestore reads or an `orgId` custom claim on the token.
The claim needs the Admin SDK, which means the `functions/` tier, which is not
deployed. The stronger ruleset is already written and commented at the bottom of
`storage.rules`, ready to swap in.

**Until then:** treat file storage as org-scoped by convention only. Do not put
anything in it that would be materially worse in a competitor's hands than the
Firestore records already are.

### S-02 · Manager-only actions are enforced only in React — HIGH

Approving and closing permits, deciding defect reports, and managing sites are
gated by `can()` in the UI. The rules gate `delete` by role and nothing else, so
an ordinary member can perform any of these from the SDK.

Partially closed: `auditor` is now genuinely read-only in the rules (S-09). The
member-versus-manager half remains, and it is not a patch — it needs per-module
rules describing which status transitions each role may make. Doing it properly
means writing, for each module, what a legal state change looks like.

### S-03 · Duplicate reference numbers under concurrency — MEDIUM

`src/modules/incidents/lib/incidents.js:96` issues `refNo` with a
read-then-write rather than a transaction, so two reports filed at the same
moment get the same reference number. Illness records have the same shape.

Not a security hole, but a reference number that is not unique undermines the
record it identifies — and these are the records that get quoted to a regulator.
`src/shared/docId/reserve.js` already has the transactional pattern to copy.

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

---

## Closed

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
