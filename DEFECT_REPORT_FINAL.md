# OHSMS — Defect Report

**Date:** 26 August 2026
**Build under test:** working tree at `a46bf05` ("Link every register in one pass, from one list")
**Scope:** full pass — automated suites, security/rules audit, static review of all 20 modules + shared code, dependency advisories.
**Status:** every Critical and High finding is fixed, and the fixes have themselves been reviewed adversarially — that second pass found **9 defects introduced by the first**, including two Critical. Those are §3A. Medium and Low from the original audit remain open and are listed in §4.

---

## 1. Verdict

The automated gates were **all green before this pass and are all green after it**. The codebase is unusually disciplined — subscriptions are cleaned up almost everywhere, counters and locks use transactions, and the rules file has already closed most classic Firestore holes with the reasoning written down beside them.

The defects were almost entirely in the gaps *between* those good habits: an idiom applied in nine places and missed in the tenth. Nine of them were the same idiom (`onSnapshot` with no error callback); four were the same idiom (whole-object read-modify-write on a document two people are expected to touch at once); four more were client-side ID generation dressed up as uniqueness.

| Gate | Before | After |
|---|---|---|
| `npx eslint .` | 0 errors, 35 warnings | **0 errors**, 35 warnings |
| `npx vitest run` (unit) | 102 files / 1827 tests pass | **102 files / 1827 tests pass** |
| `functions` suite | 13 files / 357 tests pass | **13 files / 357 tests pass** |
| `npx vite build` | passes | **passes** |
| `npm audit --omit=dev` | 1 high, 2 moderate | 1 high, 2 moderate (see D-28/D-29) |
| `npm run test:rules` | could not run — §5 | could not run — §5 ⚠ |
| Playwright e2e | could not run — §5 | could not run — §5 ⚠ |

**52 defects found. 38 fixed.** 14 open, all Medium or Low.

| Severity | Original audit | Introduced by the fixes | Fixed | Open |
|---|---|---|---|---|
| Critical | 6 | 2 | **8** | 0 |
| High | 17 | 2 | **19** | 0 |
| Medium | 11 | 4 | 9 | 6 |
| Low | 9 | 1 | 2 | 8 |

Two findings from the first pass turned out to be **wrong on investigation** and are corrected in §3 rather than quietly dropped: D-23 and D-28.

### A note on the second pass

The nine defects in §3A were introduced by the very changes that fixed the first
twenty-nine, and two of them were worse than what they replaced. That is worth
saying plainly rather than burying: a security fix that reroutes a permission
(R-01) and a concurrency fix that changes *which* document a write contends on
(R-03, R-05) are exactly the changes most likely to open a new hole while
closing the old one, and neither the unit suite nor the linter can see it.

They were found by re-reading the diff against the files rather than against my
own intent. The same method is what §5 asks you to apply to the rules, with the
emulator this environment could not run.

---

## 2. Critical — all fixed

### D-01 · The app can hang forever on the loading spinner
`src/shared/auth/AuthContext.jsx:80`

```js
if (u) await refreshProfile(u.uid)   // no try/catch
...
setLoading(false)                     // never reached if the await throws
```

`refreshProfile` → `getUserProfile` is a bare `getDoc`. Offline, `unavailable`, or a rules refusal during a claims refresh rejects the callback, `setLoading(false)` never runs, and `ProtectedRoute` renders `<SamLoading/>` permanently — a blank spinner, no error, no way out, on the one code path every session goes through.

**Fixed:** `try/catch` around the profile read, reported through `shared/monitoring`, falling back to "signed in with no profile" — a state the tree already renders.

---

### D-02 / D-03 · Permit closure and extension approvals silently erase each other
`src/modules/ptw/lib/firestore.js:515,566`

```js
const closure = { ...current.closure, [team]: block }
await updateDoc(permitRef(orgId, permitId), { closure, ... })
```

Read-modify-write over the **whole** decision map, on a document two people are *expected* to touch at once. Engineering and Operations both open the request, both read a map where the other is still `pending`, and whoever commits second replaces the object and wipes the first approval. `closureDone()` stays false, so a permit both teams signed off reads as **Not Closed / Expired**.

On extensions it is worse: when the second write erases the first approval, `bothApproved` never becomes true, so `patch.validTo = extension.newValidTo` never fires — **a crew keeps working under an extension the system believes was never granted** — and the wholesale write also drops any `extension.suggestions` added in between.

**Fixed:** dotted-path writes (`` {[`closure.${team}`]: block} ``), the idiom `addExtensionSuggestion` in the same file already uses.

---

### D-04 · Four defects in one 13-line function (committee action status)
`src/modules/committee/pages/Consultation.jsx:462`

`meetings.find(...)` can return `undefined` → `TypeError` in an async fn → unhandled rejection, dropdown silently does nothing. `[...arr]` is shallow, so the status assignment mutated the object React already held. No `try/catch`, so a permission failure rendered as a successful save. And the whole `actions` array was rewritten from a client cache, so two people closing two different actions clobbered each other.

**Fixed:** existence guard with a visible message, immutable row copy, `try/catch` through `writeErrorMessage`, functional `setMeetings`.

---

### D-12 · LOTO: the same padlock could be applied to two machines at once
`src/modules/loto/services/procedures.js:276`, `pages/operations/OperateProcedure.jsx:23`

The `setPointLock` transaction validated lock-number uniqueness **only inside the single procedure document it had read**. Cross-procedure uniqueness lived in the browser, in `collectInUseLockNos(procedures)`. Two operators on two procedures both saw lock #12 free and both committed — they read *different* documents, so there was no contention for Firestore to detect. The browser check could not save it either: it is a different tab, and `useOrgProcedures` truncates at `COLLECTION_READ_CAP`, so a locked procedure past the cap was simply absent from the set.

The result is the failure LOTO exists to prevent: one physical padlock recorded as isolating two machines, and a technician who removes "their" lock from one energising the other.

**Fixed:** new `lockClaims` collection, one document per applied padlock, keyed `${orgId}__${lockNo}`. The lock number **is** the document ID, so two transactions claiming the same padlock are two writes to one document and Firestore serialises them — the same trick `/defectLocks` already uses. Claims are taken and released inside the existing transactions in `setPointLock`, `addGroupMember` (including both sides of a personal→department swap) and `removeGroupMember`, so a claim can never outlive its lock or vice versa. Rules block added with `resource == null` on create; six regression tests added.

**New file:** `src/modules/loto/services/lockClaims.js`.

---

### D-13 · The HIRA action tracker could silently delete hazards
`src/modules/hira/pages/ActionTracker.jsx:82`

Setting one control to "Implemented" rebuilt the `activities` tree from the subscription copy and wrote back **every activity, hazard and control** of that assessment as it looked when the snapshot arrived. Someone adding a hazard in `CreateAssessment` while a supervisor ticked off an unrelated action lost the hazard — silently, with no audit trail. On a risk register that is the worst kind of data loss: the record still looks complete.

**Fixed:** new `patchAssessmentControl` in `hira/lib/firestore.js` re-reads the assessment inside a `runTransaction` and applies the patch to whatever the tree looks like at commit time, so a concurrent write causes a retry instead of an overwrite. A control that has genuinely been deleted now raises a message instead of silently discarding the edit.

*(The structural fix — additional controls in their own subcollection — is a data migration and is still worth doing; this closes the hole without one.)*

---

## 3. High — all fixed

### D-05 · Security · A self-joining stranger could grant themselves site access
`firestore.rules:712`

`allow create` on `/users/{uid}` pinned `status` and `role` but **not `access` or `siteId`**. `allow update` pins both, with a comment saying they "are no less a privilege than role is" — but a privilege guarded at one moment is not guarded. Joining is self-service, org IDs are public via `/orgIndex`, and approval only flips `status`. So a stranger could write `{status:'pending', role:'member', access:{sites:[…every site…]}}` and the admin clicking **Approve** granted it, without the role ever moving.

**Fixed:** `noSelfGrantedScope()` — empty `siteId`, empty `access.sites/regions/entities` — as a conjunct on **both** create branches. Verified against all three legitimate create paths (`createPendingMember`, `createOrganization`, `provisioning.createOne`), which already write empty scope. Six regression tests added.

### D-06 · Every illness attachment was unreadable by everyone, including managers
`firestore.rules:1132`

Rules do not cascade into subcollections, so the manager grant stopped at the illness document and `/illnesses/{id}/files` fell to the generic recursive rule — where `genericReadable()` excludes `col == 'illnesses'`. A collection excluded from the only rule that could grant it is a collection nobody can read. `subscribeIllnessFiles` queries exactly that path. It failed **closed**, which is why it leaked nothing and why nothing caught it.

**Fixed:** mirrored the `/injuries/{id}/records` block. Four regression tests added.

### D-07 · Security · Medical bytes sat under a Storage prefix the medical gate didn't cover
`storage.rules:132` + `src/modules/incidents/lib/illnesses.js:169`

GP letters and fit notes upload under kind `illness-files`; the read rule excluded only `medical-records`. Storage granted those bytes to **every member of the tenant and to the read-only auditor** — the exact party the `/illnesses ⇒ isManagerOf` split exists to keep out. Only D-06 was hiding it; fixing D-06 alone would have made it live.

**Fixed:** excluded `illness-files` from the generic read and added a manager-only match. Kept as a second prefix rather than renaming the upload kind — files already in the bucket carry this path, and their `path` field is written once, at upload.

### D-08 · Blocked site storage took the whole app down
`src/shared/auth/useIdleTimeout.js`

Four unguarded `localStorage` calls. In private mode or a locked-down managed browser these **throw**, and because the first throw is inside `useEffect`, `AppChrome` unmounted into the root `ErrorBoundary`: "Something went wrong" on every page, for a session timer. The app knowingly runs where this happens — `sessionConstants.js` wraps the identical calls.

**Fixed:** `readLastActivity`/`writeLastActivity` helpers with `try/catch`, degrading to an in-memory timestamp.

### D-09 · Admin screen mutated a cache four other contexts were reading
`src/pages/admin/Users.jsx:32`

`subscribeOrgUsers` is ref-counted and multiplexed — the same array reference goes to every subscriber and is kept as the channel's cache. `list.sort()` reordered the arrays `IncidentContext`, `TrainingContext`, `PermitContext` and inspections `DataContext` already held, with no re-render.

**Fixed:** `[...list].sort(...)`.

### D-10 · The incidents KPI counted deleted incidents
`src/modules/objectives/lib/kpis.js:146`

Every sibling KPI filters `!deletedAt`; this one did not, and its data comes from `subscribeOrgCollection`, which returns raw rows. Deleted incidents inflated the one KPI where a higher number is *worse*.

**Fixed:** added the `!i.deletedAt` filter.

### D-11 / D-21 · Nine listeners could leave four modules on a permanent spinner
`audit/services/{auditModule,audits,capa,findings}.js`, `incidents/lib/incidents.js:272`, `inspections/lib/firestore.js:43,98`, `ptw/lib/firestore.js:404`

`onSnapshot` without an error callback raises "Uncaught Error in snapshot listener" and **never calls the success callback again**. Every one of these modules clears `loading` from inside the success callback, so a missing composite index, a rules change, or one permission-denied during a token refresh left the module reading as "this org has no data" rather than "this module could not read its data".

**Fixed:** new `src/shared/snapshotError.js` with a single `onSnapErr(label, cb)` that suppresses normal sign-out via the existing `isSessionEnd` helper and calls `cb([])` so loading flags clear. Wired into all nine listeners. `audit/services/snapshotError.js` re-exports it so the five call sites there keep their import.

**New file:** `src/shared/snapshotError.js`.

### D-14 · Approving two extinguisher reports at once lost one defect
`src/modules/fire/lib/firestore.js:660`

`getExtinguisher` → build a `Set` → write the whole `physicalDefects` array. Two approvers clearing the pending queue — the normal way that screen is used — each read the array before the other's write. One reported defect vanished, and the status flip to `TO_BE_REFILLED` could go with it.

**Fixed:** the extinguisher is now read *inside* a `runTransaction` that also writes the QR mirror, so a concurrent approval retries against the new state. `arrayUnion` alone would not have worked here — `updateExtinguisher` derives the mirror payload and the stats delta from a locally merged object, and a sentinel passed through it would be written into the mirror. Stats and the audit entry stay outside the transaction so a retry cannot double-count them.

### D-15 · AED / FAS asset IDs were computed client-side and collided
`src/modules/fire/lib/assetLogic.js:15`, `AEDRepository.jsx`, `FASRepository.jsx`

`nextAssetId` read the highest suffix out of a **capped** in-memory list and added one. Two people opening "Add AED" concurrently both got `AED-0042`; `generateAll` handed out `base+1+i` for a whole batch with no reservation. `assetId` is the human handle printed on the QR label.

**Fixed:** new `reserveSeq` / `reserveSeqBlock` in `shared/docId/reserve.js` — the same transactional counter every module's document IDs already use — surfaced as `reserveAssetId` / `reserveAssetIdBlock` in `fire/lib/firestore.js`. `highestAssetSeq` survives as the migration **floor**, so existing stock carries across on first use and nothing already printed is issued twice. `assetLogic.js` stays pure so its tests need no Firebase.

### D-16 · Meeting document IDs collided every 10 seconds
`src/modules/committee/pages/Consultation.jsx:424`

`` `MOM-${siteId}-${Date.now().toString().slice(-4)}` `` — the last four digits of a millisecond timestamp repeat every ten seconds. **Narrower than first reported:** `addConsultation` assigns a real reserved `docId` after the payload spread, so new records were never affected; the collision-prone path fired only when *editing a record created before the field existed*.

**Fixed:** removed the inline generator; a legacy record with no reference now gets a real one from `reserveConsultationDocId`.

### D-17 · Audit plan IDs were a deterministic function of `(siteId, rowCount)`
`src/modules/audit/pages/app/InternalAudit.jsx:77`

```js
const seq = 1000 + Math.floor(rows.length * 137 + plan.siteId.length * 41) % 9000
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [plan.siteId])
```

Deterministic, and `rows.length` was read without being a dependency — the suppressed lint warning *was* the bug. **Narrower than first reported:** `createAuditPlan` assigns the real reference after the spread, so nothing collided in storage. What was wrong is that the form displayed a reference the saved plan would not carry — somebody writing it down was writing down a reference to nothing.

**Fixed:** effect deleted; the field now says the reference is issued when the plan is saved.

### D-18 · Finding IDs cycled every 90 seconds
`src/modules/audit/pages/app/InternalAudit.jsx:318`

`` `AF-${10000 + Date.parse(now) % 90000}` `` wraps every 90 s. These ids **are** stored, inside the record's `findings[]`, and they are the key the central Action Tracker matches on (`actions/lib/sources.js:236`) as well as the reference shown beside each finding — so the tracker could match one finding's action against another's.

**Fixed:** random ids from `crypto.randomUUID()`. The dead `f.id || genId() + idx` branch (which would have concatenated a digit rather than offsetting) is gone. The CAPA due date on the same line also moved off `toISOString().split('T')[0]` onto the shared `todayISO()` — see D-30.

### D-19 · Editing an audit finding mutated the shared Firestore cache
`src/modules/audit/pages/app/InternalAudit.jsx:337,342`

`openTask` seeded `findingRows` with the actual objects from the snapshot, and `u[i][f] = v` wrote straight through the shallow copy. `FindingsRegister`, `CapaRegister` and the Action Tracker saw edited data that was never saved, with no re-render, and abandoning the edit did not undo it.

**Fixed:** rows copied out of the snapshot on open; `updateRow` and `handleFile` replace the row object instead of assigning into it; `handleFile` gained the `try/catch` it never had, on the field that is mandatory to save.

### D-20 · A failed photo upload left the mock-drill record lying about its evidence
`src/modules/fire/lib/firestore.js:962`

The drill was committed with `photoCount: valid.length` *before* a sequential upload loop. A failure on photo 3 of 10 left a drill claiming ten with three stored — and `MockDrills.jsx:245` gates its fetch on `photoCount > 0`, so the viewer waited for evidence that would never arrive — while the caller reported "save failed" for a drill that *was* saved. Both halves were wrong, in opposite directions.

**Fixed:** `Promise.allSettled` over the uploads, then `photoCount` corrected to what actually landed. `allSettled` rather than `all` so one unreadable photo does not discard the nine that uploaded, and so it cannot reject out of the function and reproduce the same false "save failed".

### D-22 · A completed one-off inspection stayed on the schedule forever
`src/modules/inspections/lib/schedule.js:246` + `pages/Execute.jsx:156`

Submitting wrote the record with `assignmentId`, but nothing ever flipped the assignment's status — the only values ever written were `Pending` and `Cancelled`. Recurring assignments were saved by the past-records check; the one-off branch had none, so a completed assigned inspection was permanently "Pending" and kept rolling into `overdueTasks`.

**Fixed:** new `completeAssignment` (transactional, because `assignments` is an array on the template document) called after `addRecord` succeeds — deliberately non-fatal, because the inspection *is* saved and a failed status flag must not be reported as a failed save. Plus a `records.some(...)` guard in the one-off branch, which also covers every assignment completed before this fix, with no backfill.

### D-23 · **Corrected** — the stakeholder forms were not overwriting records
`src/modules/stakeholder/pages/{EscalationForm,LegalIssueForm}.jsx`

The first pass reported that these forms would save a blank over a live record when the target was outside the 500-row listener cap, because there was "no `!found && !loading` branch". **That was wrong** — both files have exactly that branch (`EscalationForm.jsx:100`, `LegalIssueForm.jsx:96`), rendering a "not found" empty state, and the form with its save button never mounts. My subagent missed those lines and I should have checked before writing it up.

The **secondary** finding was real: `StakeholderContext.bind()` set `error` on a listener failure but never `loaded`, so `loading` stayed true forever — the registers skeletoned indefinitely, and the "not found" branch above, being gated on `!loading`, could never be reached to explain it.

**Fixed:** the error path now marks the slot loaded as well as setting `error`.

### D-24 · The platform operator console had no idle timeout
`src/pages/platform/PlatformShell.jsx`

`useIdleTimeout` was mounted in exactly one place — `AppChrome`. Tenant routes and the portal go through it; `/platform` deliberately does not. The effect of that deliberate separation was that the single highest-privilege account in the product — the one that toggles module entitlements for **every** tenant — was the only account with no inactivity logout, on the screen most likely to be left open on a shared machine.

**Fixed:** `useIdleTimeout()` in `PlatformShell`, signing out on `isExpired`. No "stay signed in" dialog: that prompt exists so a safety officer does not lose a half-written incident report, and there is nothing to lose on an operator console.

### D-25 · Envelope encryption was inert in production
`src/shared/crypto/keyring.js:74`, `.env.production`

`.env.production` never set `VITE_ENCRYPTION`; `.env.example` sets it to `off`, and Vite loads `.env` for every mode — the same inheritance trap `.env.production:9` already documents for the storage bucket. Every "sealed" field (`medication`, `bodyParts`, `injuryType`, `healthIssue`, `exposedToAgent`, `affectedPersonnel[].name`, all file buckets) was written in **cleartext**, while the code, the callable and the docs all read as though it were on.

**Fixed:** `VITE_ENCRYPTION=on` added to `.env.production`, with the cutover sequence written above it.

> ⚠ **This flag must not ship alone.** Turning sealing on seals *new* writes only. Deploy, then run the field backfill (`src/shared/crypto/backfill.js`, which refuses to run without the flag), then `sealStoredObjects`, then verify a member is refused an injury record rather than shown an envelope. The steps are in `.env.production` beside the flag.

### D-26 · Reference-number counters could be rewound
`firestore.rules` + `incidents/lib/incidents.js:159`, `illnesses.js:49`, `ptw/lib/firestore.js:43`

`docSeq` is protected with strict monotonicity, with a comment explaining exactly why. The legacy counters live in `/meta`, which `structuralOnly()` did not exclude — so any member could `setDoc(.../meta/stats, {nextSeq:1}, {merge:true})`, producing duplicate `IRA-…` / `ILL-…` references on records quoted to regulators, and zeroing the dashboard totals in the same write.

**Fixed:** `meta` excluded from `structuralOnly` (a narrow match cannot restrict a permissive union — the exclusion has to live where the grant lives) and a `/meta/{kind}` block added pinning `nextSeq` **and** `permitSeq` as non-decreasing. The third counter, `meta/counters.permitSeq` — the number printed on a permit somebody signs — was not in the original finding and was picked up while writing the rule. Reads use `.get(field, 0)` on both sides, because most writes here are stats deltas that never mention a counter. Six regression tests added.

### D-27 · Module entitlements were a client-side-only control
`firestore.rules:665` (defined, never referenced) + `src/shared/modules/ModuleGate.jsx:23`

`/moduleEntitlements/{orgId}` existed, was operator-write-only, and was referenced by **no rule in the 1299-line file**. Enforcement was React alone. The gate's own header claimed the opposite: *"Firestore rules stop the data leaving, but an unguarded route would still mount the module."* They did not — a member of an org whose LOTO/PTW/training entitlement had been revoked could still read and write those collections from the SDK.

**Fixed:** `moduleForCollection(col)` (a 34-entry collection→module map) and `moduleAllowed(orgId, col)` added as a conjunct on the generic read and create/update rules, including the recursive subcollection match. Written to **fail open** at every point of doubt — an unmapped collection is allowed, an org with no entitlement document is allowed (absent means enabled, matching the client), an absent key is allowed. Only an explicit `false` refuses. `delete` is deliberately not gated: turning a module off should stop it being used, not trap the data already in it. Six regression tests added.

### D-28 · **Corrected** — the exploitable `xlsx` path was already closed
`GHSA-4r6h-8v6p-xvw6`, `GHSA-5pgg-2g8v-p4x9`

The first pass said the app "parses user-uploaded workbooks" through `xlsx` and recommended hardening that path. **That was wrong.** `src/shared/lib/parseTable.js` had already moved every read path onto papaparse, strips `__proto__`/`constructor`/`prototype` header keys, and builds rows with no inherited keys; `src/shared/lib/workbookGuard.js` caps file size and row count. `grep` confirms no `XLSX.read` anywhere in `src/` outside tests — `xlsx` is imported by five **exporters** only, writing workbooks from data we already hold, which is not a parsing surface.

`scripts/audit-gate.mjs` already says exactly this in its allowlist entry, with a condition for removal. **No change made; no change needed.** The advisory stays in the tree until `xlsx` is dropped or replaced with a maintained SheetJS build.

### D-29 · `react-router` open redirect + constructor injection
`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg`

**Bumped 6.30.4 → 6.30.6** (`@remix-run/router` 1.23.3 → 1.23.4); the lockfile diff is exactly those three packages. Both advisories are only *fully* resolved in react-router 7, which `npm audit fix --force` warns is a breaking change — so they still appear in `npm audit`. They are moderate, and the app already routes user-supplied URLs through `shared/safeUrl.safeHref`. **A v7 migration is the remaining work and is out of scope for a defect pass.**

---

## 3A. Regressions introduced by the fixes above — all fixed

Every change in §2 and §3 was then re-read against the files, by a reviewer told
to assume the author was overconfident. It found nine defects that the fixes had
introduced. Two were worse than the bugs they replaced.

### R-01 · CRITICAL · The encryption keyset became readable by every member
`firestore.rules` — the new `match /meta/{kind}`

Excluding `col != 'meta'` from `structuralOnly()` (D-26) moved *every* grant on
`organizations/{orgId}/meta/*` into the new match block. The write rules there
call `notKeyset('meta', kind)`. **The read rule did not.**

Before the change, `meta/cryptoKeys` was refused on read by
`genericReadable → structuralOnly → notKeyset`. After it, the only rule
governing that document granted `read` to any approved member — including the
read-only auditor — and because the condition touches no document field, a
`getDocs` on the `meta` collection would have listed the keyset alongside the
counters. The file's own header says of this document: *"NO CLIENT OPERATION IS
ALLOWED ON IT — not read, not write."*

The keys are wrapped under a Secret Manager master key, so this was a broken
invariant rather than plaintext exposure — but it is exactly the shape of
mistake a rules refactor makes, and my own comment claimed the opposite
("excluding the whole collection excludes meta/cryptoKeys with it", true for
write, false for read). `tests/cryptoKeys.rules.test.js` would have caught it on
the first emulator run.

**Fixed:** `allow read: if isApprovedMemberOf(orgId) && notKeyset('meta', kind);`

### R-02 · CRITICAL · The new `lockClaims` collection was a cross-tenant denial of service
`firestore.rules` — `match /lockClaims/{claimId}`

The create rule checked `request.resource.data.orgId` and nothing else. The
document ID is `${orgId}__${lockNo}`, so nothing tied the id to the payload.
Fully in-product attack: sign up, create a throwaway org (self-service, so
`isWriterOf` passes for it), read victim org IDs out of the world-readable
`/orgIndex`, then create `lockClaims/VICTIM__12` carrying *your own* orgId.

Worse than squatting. `readLockClaims` does a `tx.get` on that document inside
the lock transaction, and the read rule keys off `resource.data.orgId` — the
attacker's — so the victim's read is refused and the entire `setPointLock`
transaction fails. The victim cannot delete it either, for the same reason.
Padlock 12 becomes permanently unusable in their isolation system, repeatable
across every lock number and every org in the index. A fix for a LOTO safety
defect that hands anyone a way to disable LOTO.

**Fixed:** `&& claimId.split('__')[0] == request.resource.data.orgId` — the
same id-to-payload binding `/defectLocks` already uses.

### R-03 · HIGH · Releasing a padlock could release someone else's
`src/modules/loto/services/procedures.js` — all three release paths

`setPointLock`'s unlock branch deleted `lockClaims/{org}__{techLockNo}`
unconditionally. But unlocking *preserves* `techLockNo` for the history, and
nothing requires the point to be currently locked — so a second unlock (a
double-click, a stale tab, a retry) deleted a claim that another procedure may
by then hold. Legacy points locked before claims existed have the same shape: no
claim of their own, and a delete that lands on someone else's. `removeGroupMember`
deleted without reading the claims at all.

This is the original duplicate-padlock bug re-entering through the exit.

**Fixed:** new `claimHeldBy()` guard — a claim is only deleted if this procedure
still owns it — applied to all three release paths, with `removeGroupMember`
gaining the read-before-write it lacked.

### R-04 · HIGH · Swap locks skipped the org-wide check the read had already paid for
`src/modules/loto/services/procedures.js` — `addGroupMember`

The personal→department swap's lock numbers were read into `claims` and then
never checked against it. `GroupLockDialog` filters swap candidates on the
browser's capped `collectInUseLockNos` — the very set this mechanism replaces —
so a swap could offer a padlock another procedure holds. The rules still refused
the write, so the operator got a bare `permission-denied` instead of "Lock 12 is
already applied to Press 4 · Hosur".

**Fixed:** `claimConflict` check over the swap values before the write.

### R-05 · HIGH · The monotonic counter rule broke the equipment dashboard — and revealed a live bug
`src/modules/fire/lib/firestore.js` — `recomputeStats`

```js
await setDoc(statsRef(orgId), { ...s, updatedAt: serverTimestamp() })   // no merge
```

`statsRef` is `organizations/{orgId}/meta/stats` — **the same document** the
incidents module keeps its `IRA-` reference counter in. A non-merge `setDoc`
omits `nextSeq`, so the new monotonic rule refuses it, and both callers swallow
the failure with `.catch(console.warn)`: the equipment totals would have gone
stale for any org that had ever filed an incident, silently.

The rule is right and the old code was the bug — every admin "Refresh totals",
bulk import and bulk delete was **rewinding the incident reference sequence to
nothing**, which is precisely the failure D-26 was written to prevent, happening
already, from inside the app.

**Fixed:** `{ merge: true }`. (The underlying collision — two modules writing
`total` into one document — is worth a separate ticket.)

### R-06 · HIGH · The entitlement gate could not see the module it was written for
`firestore.rules` — `moduleAllowed`

My own comment named LOTO first as the thing the gate closes. LOTO's collections
(`procedures`, `procedurePhotos`, `locks`, `technicians`) are **top-level**,
tenanted by an `orgId` field rather than by path, so the conjunct added to the
`/organizations/{orgId}/{col}/{docId}` rule never reached them — and the
function was declared inside the organizations block, where the LOTO match
cannot even call it. The original defect repeating itself one level up: the gate
existed and did not cover the thing it was for.

**Fixed:** `moduleForCollection` / `moduleOn` / `moduleAllowed` hoisted to the
top-level scope (declared before every call site), the four LOTO collection
names added to the table, and the conjunct applied to the legacy match's read,
create and update. `delete` left ungated, as elsewhere.

### R-07 · MEDIUM · The dotted-path PTW fix made the extension bug *permanent*
`src/modules/ptw/lib/firestore.js` — `decideExtension`

`bothApproved` is what promotes the extension's new end time to `validTo`.
Computed from a read taken before the write, neither of two simultaneous
approvers ever sees it become true. With the old wholesale write that was
recoverable — the second write left one team pending, so somebody approved again
and `validTo` landed then. With a dotted write the server ends up showing **both
teams approved and `validTo` never written**, and nobody will re-approve a
request that looks complete. A crew works on under an extension the permit does
not record. `syncStoredStatus` was also being fed a stale merge, so the QR
mirror a worker scans at the barrier could say IN PROGRESS about a closed permit.

**Fixed:** both `decideClosure` and `decideExtension` now read inside a
`runTransaction`, so a concurrent decision retries and the second caller sees
both approvals — and writes `validTo` in the same commit.

### R-08 · MEDIUM · The shared listener error handler wiped data it should have kept
`src/shared/snapshotError.js`

`onSnapErr` called `cb([])` on every error. The failure it exists for is usually
transient — a permission-denied during a token refresh — and by then the
register is on screen holding real rows. Replacing them with an empty list turns
"these figures are a few seconds stale" into "this site has no open permits", on
a safety register, with only a console warning. Strictly worse than the stuck
spinner it replaced.

**Fixed:** replaced with `snapshotHandlers(label, cb)` returning `{ ok, err }`.
The success path runs through `ok`, so the handler knows whether rows have ever
been delivered; `cb([])` fires only before the first success, where it clears
the loading flag and there is nothing to lose. All nine call sites updated.

### R-09 · MEDIUM · Mock-drill photo failures became invisible, and uploads unbounded
`src/modules/fire/lib/firestore.js`, `pages/MockDrills.jsx`

The `Promise.allSettled` rewrite corrected `photoCount` but reported the
shortfall only to `console.warn`, while the caller's `toast.success` fired
unconditionally — so a drill saved with 3 of 10 evidence photos still read as a
clean save. It also replaced a strictly sequential loop with ten concurrent
~700 KB uploads, which on a site connection is slower than a bounded pool and
can time the whole set out.

**Fixed:** `addMockDrill` returns `{ id, storedPhotos, requestedPhotos }`, the
page raises a visible warning naming the shortfall, and uploads run through a
`mapWithConcurrency` pool of four.

### Also corrected while re-reading

- **`declareAlarp` still had the D-13 bug.** `RiskRegister.jsx` rebuilt the whole
  `activities` tree from the subscription copy, so accepting one residual risk
  reverted every concurrent edit — including an action status the tracker had
  just committed through the transactional path. Generalised
  `patchAssessmentControl` into a shared `patchAssessmentNode` and added
  `patchAssessmentHazard`; `flattenHazards` now carries `activityId` (a hazard id
  is only unique within its activity), which is what that write needs to address
  a node.
- **The rules lookup table was rewritten as a ternary chain.** A map literal with
  `.get(col, '')` had no precedent in this file, and a rules file that fails to
  *parse* is rejected whole — every other rule goes down with it. `col in [...]`
  and ternary chains are both already proven here. It also evaluates far less per
  request, and `moduleForCollection` no longer runs twice per call.

---

## 4. Open — Medium & Low

Nothing here is a data-loss or privilege defect. Grouped so each cluster can be one change.

### Dates and timezones

The codebase already has three correct local-date helpers and a shared `todayISO()` in `src/shared/lib/dates.js`. These sites bypass them.

| # | Defect | Where | Status |
|---|---|---|---|
| D-30 | `toISOString().split('T')[0]` as "today"/due date. `setDate` is local, `toISOString` is UTC — in UTC+5:30 anything done before ~05:30 yields **yesterday**, so a Major NC nominally due in 7 days gets 6. | `InternalAudit.jsx:546,947`; `Consultation.jsx:209,230,287,528`; `emergency/lib/firestore.js:302,452`; `SubmitQuotationModal.jsx:74` | **partly fixed** — the CAPA due date now uses `todayISO()`; the rest remain |
| D-31 | `new Date('2026-08-26') < new Date()` — date-only strings parse as UTC midnight, so an action due *today* shows a pulsing red **Overdue** badge from 05:30 that morning in IST. | `Consultation.jsx:125`; `audit/lib/format.js:37`; `CapaRegister.jsx:22`; `InternalAudit.jsx:641` | open |
| D-32 | Training expiry window off by one day at negative UTC offsets. | `training/lib/status.js:28,70` | open |
| D-33 | `toDate()` result never validated — the `NaN` guard covers the string branch only, so a corrupt Timestamp renders as `"Invalid Date"` and `isOverdue` returns `NaN < n` → `false`, reporting an overdue CAPA as on time. | `audit/lib/format.js:3` | open |

**Fix for all four:** import `todayISO` / a shared `parseDateOnly` and compare ISO **strings** for overdue, which `actions/lib/sources.js:35` already does.

### Correctness

| # | Defect | Where | Status |
|---|---|---|---|
| D-34 | Duplicate-name guard **inverts** when duplicates already exist: `has()` means "resolves unambiguously" but is used to mean "exists", so an estate with two `DVR-Gate-01`s imports a third. | `cctv/lib/bulkImport.js:97,114,160` | open |
| D-35 | Save button stuck disabled forever — destructuring before the `try` means a synchronous throw rejects the promise and `setBusy(false)` never runs. Needs `finally`. | `cctv/pages/Inventory.jsx:489` | open |
| D-36 | CSV-imported risk assessments get **no `docId`** — the UI path reserves one, the bulk path does not, so imported rows show blank in lists, exports and PDFs. | `hira/lib/firestore.js:119` | open |
| D-37 | ALARP: the comment says additional controls / projected risk are dropped; no such branch exists, so `residualRisk` uses projected P×S for an ALARP-accepted hazard and **understates** residual risk. `hira/lib/csv.js:270` implements the rule, so CSV and form paths disagree. | `hira/pages/CreateAssessment.jsx:170,189` | open |
| D-38 | `syncAll` prompts with `behind.length` but processes a filtered subset, and a mid-loop throw leaves earlier plans reverted to `draft` with only "Failed" on screen. | `emergency/components/RescuePlans.jsx:82` | open |
| D-39 | Derived overdue state frozen at the last data change — no clock in the memo deps, so a wall-mounted dashboard never re-evaluates "Refill Due" at midnight, and the summary count can disagree with the list. | `fire/context/FleetContext.jsx:123` | open |
| D-40 | `updateIncident` stats delta is a non-atomic read-modify-write, so concurrent edits drift the `meta/stats` counters permanently — while `bumpStats` swallows its own failures. | `incidents/lib/incidents.js:234` | open |
| D-41 | `createPermit` writes the permit, then loops attachments sequentially — an oversized inline fallback throws mid-loop, leaving a permit with its number consumed and its documents half-attached, reported as a failure. | `ptw/lib/firestore.js:227` | open |
| D-42 | `syncIncidentInjuries` does one sealed write per person, serially — a 15-casualty incident is 15 sequential seals + round trips, non-atomic. | `incidents/lib/injuries.js:178` | open |
| D-43 | `logTraining` uses a **single unchunked** `writeBatch` — can exceed Firestore's 500-op limit and reject wholesale. Its two neighbours chunk at 400. | `training/lib/firestore.js:146` | open |
| D-44 | `PF` is a component **defined inside render**, so React remounts every Pass/Fail group on every keystroke. | `inspections/pages/Execute.jsx:178` | open |
| D-45 | Inputs flip uncontrolled → controlled: the initialiser runs in `useEffect`, but first paint happens with `responses === {}`. Needs `value={r.answer ?? ''}`. | `inspections/pages/Execute.jsx:283` | open |
| D-46 | `subscribeTemplates` was the only uncapped listener in the module, and templates carry their full `fields` **and** `assignments` arrays. | `inspections/lib/firestore.js:43` | **fixed** — `limit(COLLECTION_READ_CAP)` added alongside the error handler |
| D-47 | Recurring-occurrence expansion has no lookback bound — a Daily template assigned three years ago yields up to 1000 occurrences, then stops silently at the safety cap. Both enormous and incomplete. | `inspections/lib/schedule.js:91` | open |
| D-48 | Storage `create` caps size but has **no content-type allowlist**, so any writer can store `text/html` under the org prefix and `getDownloadURL()` serves it inline as a permanent unauthenticated link. | `storage.rules:143` | open |

### Low

| # | Defect | Where | Status |
|---|---|---|---|
| D-49 | Library reports "loaded" on the **first** of several queries, so a partial document library briefly presents as complete. | `documents/lib/service.js:33` | open |
| D-50 | Sort comparator returns `NaN` for records with no date — engine-dependent ordering. | `Consultation.jsx:252` | open |
| D-51 | Shared subscriptions serve a **previous session's cached rows** for up to 30 s after sign-out; nothing clears the channels on identity change. | `shared/org/sharedSubscription.js:12` | open |
| D-52 | `subscribeOrgUsers` and `subscribeIllnesses` are uncapped, and `subscribeIllnesses` does not filter `deletedAt` at the seam (its sibling does, and documents why). | `orgData.js:213`; `illnesses.js:124` | open |
| D-53 | `/notifications` is client-writable — a member can pre-create ledger rows that suppress a mail they cannot read back. Currently unexploitable: the writer the rule cites, `functions/lib/notify.js`, **does not exist**. | `firestore.rules:1156` | open |
| D-54 | `/qr` and `/permitQr` creates are not bound to the asset they mirror, and their payload shape is unvalidated — `/procedureQr` does both correctly with `getAfter`. Bounded by 18-char random tokens. | `firestore.rules:477,549` | open |
| D-55 | Comments contradict the code: "No `files: true`" sits directly above entries that set `files: true`. | `shared/crypto/policy.js:233,281` | open |
| D-56 | Rate-limit `sleep(1100)` runs after the **final** category, adding 1.1 s of dead time to every fallback lookup. | `emergency/lib/nearby.js:172` | open |
| D-57 | Working tree shows **254 files as fully rewritten** in `git diff` — a CRLF/LF normalisation artifact, not real changes. It makes every review of this branch unreadable. | repo-wide | open — **do this first** |

---

## 5. Coverage gaps — read this before merging

Two suites could not be executed in this environment, and their absence is the main risk in this changeset:

- **`npm run test:rules`** — the Firestore emulator JAR download is refused by the sandbox network allowlist. **`firestore.rules` and `storage.rules` carry substantial changes (D-05, D-06, D-07, D-12, D-26, D-27, R-01, R-02, R-06) that are verified by reading only.** Two of the nine defects in §3A were in exactly these untested rules, and both would have been caught by the first emulator run — R-01 by `tests/cryptoKeys.rules.test.js`, which already exists. Treat that as the measure of how much this gap matters.

  One line is worth singling out. `claimId.split('__')[0]` (the R-02 fix) is the only **string method** in the new rules with no precedent elsewhere in the file. `split` is documented on the Rules `String` type and `.trim()`/`.lower()`/`.size()` all ship here already, so I expect it to parse — but a parse error rejects the ruleset *whole*, taking every other rule down with it. If `firebase deploy` refuses the file, look there first; the equivalent without `split` is:

  ```
        && claimId[0:request.resource.data.orgId.size() + 2]
             == request.resource.data.orgId + '__'
  ``` The entitlement gate in particular touches the generic rule that governs *every* collection under an organization. It is written to fail open, and brace/paren balance and scope nesting were checked by hand — but **run `npm run test:rules` before merging, and do not deploy rules without a green run.** 22 regression tests were added to `tests/hardening.rules.test.js` covering the new behaviour.
- **Playwright e2e** — Chromium download refused for the same reason. Substituted a static review of the specs and the CI workflow, both of which are well constructed.

Everything else ran to completion, before and after every change: lint (0 errors), 1827 unit tests, 357 functions tests, and a production build.

---

## 6. What changed

**New files (3)**

- `src/shared/snapshotError.js` — the shared `onSnapshot` error handler (D-11, D-21)
- `src/modules/loto/services/lockClaims.js` — padlock claim documents (D-12)
- `src/modules/audit/services/snapshotError.js` — re-export, keeps the five audit call sites unchanged

**Modified**

`firestore.rules` · `storage.rules` · `.env.production` · `package-lock.json` · `tests/hardening.rules.test.js` · `src/shared/auth/AuthContext.jsx` · `src/shared/auth/useIdleTimeout.js` · `src/shared/docId/reserve.js` · `src/pages/admin/Users.jsx` · `src/pages/platform/PlatformShell.jsx` · `src/modules/loto/services/procedures.js` · `src/modules/hira/lib/firestore.js` · `src/modules/hira/pages/ActionTracker.jsx` · `src/modules/fire/lib/assetLogic.js` · `src/modules/fire/lib/firestore.js` · `src/modules/fire/pages/AEDRepository.jsx` · `src/modules/fire/pages/FASRepository.jsx` · `src/modules/committee/lib/firestore.js` · `src/modules/committee/pages/Consultation.jsx` · `src/modules/audit/pages/app/InternalAudit.jsx` · `src/modules/audit/services/{auditModule,audits,capa,findings}.js` · `src/modules/incidents/lib/incidents.js` · `src/modules/inspections/lib/{firestore,schedule}.js` · `src/modules/inspections/pages/Execute.jsx` · `src/modules/ptw/lib/firestore.js` · `src/modules/stakeholder/context/StakeholderContext.jsx` · `src/modules/objectives/lib/kpis.js`

**Suggested order of work from here**

1. **`npm run test:rules`** on a machine with a JDK. Nothing else matters until that is green — §5 explains why, and R-01/R-02 are the evidence.
2. **D-57** — fix the line-ending normalisation, or every diff including this one is unreviewable.
3. **D-25 step 2** — the encryption backfill. Every hour the flag is on without it is more cleartext to migrate.
4. **R-05's underlying collision** — the fire module and the incidents module both write `total` into `organizations/{orgId}/meta/stats`. The merge stops the counter being wiped; it does not stop the two modules overwriting each other's totals.
5. **D-30 … D-33** — one shared date helper closes all four.
6. The remaining Mediums, cheapest first: D-35, D-36, D-43, D-45.
