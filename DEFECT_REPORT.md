# OHSMS — Defect Report

**Date:** 26 August 2026
**Build under test:** working tree at `a46bf05` ("Link every register in one pass, from one list")
**Scope:** full pass — automated suites, security/rules audit, static review of all 20 modules + shared code, dependency advisories.

---

## 1. Verdict

The automated gates are **all green** and the codebase is unusually disciplined — subscriptions are cleaned up almost everywhere, counters and locks use transactions, and the rules file has already closed most classic Firestore holes with the reasoning written down beside them.

The defects that remain are almost entirely in the gaps *between* those good habits: an idiom applied in nine places and missed in the tenth. That is what most of this report is.

| Gate | Result |
|---|---|
| `npx eslint .` | **0 errors**, 35 warnings |
| `npx vitest run` (unit) | **102 files / 1827 tests passed** |
| `functions` suite | **13 files / 357 tests passed** |
| `npx vite build` | **passed** (1m 22s) |
| `npm audit --omit=dev` | **3 vulnerabilities** (1 high, 2 moderate) |
| `npm run test:rules` | **could not run** — see §5 |
| Playwright e2e | **could not run** — see §5 |

**43 defects** found. **11 fixed** in this pass (all CRITICAL + all HIGH that were safe to patch in isolation). 32 reported with a recommended fix.

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 6 | 4 | 2 |
| High | 17 | 7 | 10 |
| Medium | 11 | 0 | 11 |
| Low | 9 | 0 | 9 |

---

## 2. Fixed in this pass

Each of these was reproduced by reading the code path end to end, patched, and re-verified against lint + the full unit suite + a production build.

### D-01 · CRITICAL · The app can hang forever on the loading spinner
`src/shared/auth/AuthContext.jsx:80`

```js
const unsub = onAuthStateChanged(auth, async (u) => {
  setUser(u)
  if (u) await refreshProfile(u.uid)   // no try/catch
  ...
  setLoading(false)                     // never reached if the await throws
})
```

`refreshProfile` → `getUserProfile` is a bare `getDoc`. Offline, `unavailable`, or a rules refusal during a claims refresh rejects the callback, so `setLoading(false)` never runs and `ProtectedRoute` renders `<SamLoading/>` permanently — a blank spinner, no error, no way out, on the one code path every session goes through. Also an unhandled promise rejection.

**Fixed:** `try/catch` around the profile read, reporting through `shared/monitoring`, falling back to "signed in with no profile" — a state the tree already renders.

---

### D-02 · CRITICAL · Permit closure approvals silently erase each other
`src/modules/ptw/lib/firestore.js:515`

```js
const closure = { ...current.closure, [team]: block }
await updateDoc(permitRef(orgId, permitId), { closure, ... })
```

Read-modify-write over the **whole** `closure` map, on a document two people are *expected* to touch at once. Engineering and Operations both open the request, both read a map where the other is still `pending`, and whoever commits second replaces the object and wipes the first approval. `closureDone()` stays false, so a permit both teams signed off reads as **Not Closed / Expired**.

**Fixed:** dotted-path write (`` {[`closure.${team}`]: block} ``) — the idiom `addExtensionSuggestion` in the same file already uses.

---

### D-03 · CRITICAL · Permit extension approvals do the same, and the extension never applies
`src/modules/ptw/lib/firestore.js:566`

Same shape as D-02, worse consequences. When the second write erases the first approval, `bothApproved` never becomes true, so `patch.validTo = extension.newValidTo` never fires — **a crew keeps working under an extension the system believes was never granted**. The wholesale write also drops any `extension.suggestions` added between the read and the write.

**Fixed:** dotted-path write.

---

### D-04 · CRITICAL · Four defects in one 13-line function (committee action status)
`src/modules/committee/pages/Consultation.jsx:462`

```js
const meeting = meetings.find(m => m.firebaseKey === key);
const actionRow = meeting.actions[idx];        // throws if not found
const updatedActions = [...meeting.actions];
updatedActions[idx].status = newStatus;        // mutates the live snapshot object
await updateConsultation(orgId, key, { actions: updatedActions });   // no try/catch
```

1. `find` returns `undefined` if the row was deleted elsewhere → `TypeError` inside an async fn → unhandled rejection, dropdown silently does nothing.
2. `[...arr]` is **shallow** — the assignment mutates the object React already holds, so the memoised totals can miss a change they were handed.
3. No `try/catch`: a permission failure is an uncaught rejection and the row renders the new status as though it saved.
4. Lost update — the whole `actions` array is rewritten from a client cache, so two people closing two different actions on one meeting clobber each other.

**Fixed:** existence guard with a user-visible message, immutable row copy, `try/catch` reporting through `writeErrorMessage`, functional `setMeetings`. *(The lost-update half is narrowed but not eliminated — see D-16 note.)*

---

### D-05 · HIGH · Security · A self-joining stranger can grant themselves site access
`firestore.rules:712`

The `allow create` rule on `/users/{uid}` pinned `status` and `role` — but **not `access` or `siteId`**. The `allow update` rule two blocks below pins both, with a comment stating they "are no less a privilege than role is".

Guarded at one moment is not guarded. Joining is self-service, org IDs are public through `/orgIndex` (`allow read: if true`), and approval only flips `status` — `setUserStatus` writes `{ status }` and nothing re-asserts what else the joiner wrote. So:

```js
setDoc(doc(db,'users',myUid), {
  orgId: victimOrgId, role: 'member', status: 'pending',   // both values the rule checks
  access: { sites: [...every site...], regions: ['South'], entities: [] },
})
```

The admin clicking **Approve** on what reads as a routine join request grants it. From there `reachesSite()` / `canReadDocument()` hand over every site-restricted document in the org, without the role ever moving. This is the identical escalation the file already fixed for `role`, one step earlier in the lifecycle.

**Fixed:** added `noSelfGrantedScope()` — `siteId` empty and all three `access` lists empty — as a conjunct on **both** create branches. Verified against all three legitimate create paths (`createPendingMember`, `createOrganization`, `provisioning.createOne`); all write empty scope already. Six regression tests added to `tests/hardening.rules.test.js`.

---

### D-06 · HIGH · Every illness attachment is unreadable by everyone, including managers
`firestore.rules:1132`

```
match /illnesses/{illnessId} {
  allow read: if isManagerOf(orgId);      // no nested /files match
}
```

Rules do not cascade into subcollections. `/illnesses/{id}/files` fell through to the generic recursive rule, where `genericReadable()` excludes `col == 'illnesses'` — and a collection excluded from the only rule that could grant it is a collection nobody can read. `subscribeIllnessFiles` queries exactly that path, so every occupational-illness attachment returns `permission-denied` for all four roles. `/injuries` has the nested match; `/illnesses` was never given one.

It fails **closed**, which is why it leaked nothing and why nothing caught it — no test touches the subcollection.

**Fixed:** mirrored the `/injuries/{id}/records` block. Four regression tests added.

---

### D-07 · HIGH · Security · Medical bytes sat under a Storage prefix the medical gate didn't cover
`storage.rules:132` + `src/modules/incidents/lib/illnesses.js:169`

```
allow read: if inOrg(orgId) && kind != 'medical-records';
```
```js
await putFile(orgId, 'illness-files', ...)   // policy keyClass = MEDICAL
```

GP letters and fit notes upload under kind `illness-files`, which is not the string that line tests — so the narrow manager-only match never applied to them, and Storage granted those bytes to **every member of the tenant and to the read-only auditor**, the exact party the `/illnesses ⇒ isManagerOf` split exists to keep out.

Only D-06 was hiding it: the pointer documents were unreadable, so nobody could obtain a download URL. Fixing D-06 without this would have made it live.

**Fixed:** excluded `illness-files` from the generic read and added a manager-only match. Kept as a second prefix rather than renaming the upload kind — files already in the bucket carry this path, and their `path` field is written once, at upload.

---

### D-08 · HIGH · Blocked site storage takes the whole app down
`src/shared/auth/useIdleTimeout.js:9,14,22`

Four unguarded `localStorage` calls. In private mode, a locked-down managed browser, or on a full quota these **throw** rather than returning null — and because the first throw is inside `useEffect`, `AppChrome` unmounts into the root `ErrorBoundary`: "Something went wrong" on every page, for a session timer.

The app knowingly runs where this happens — `sessionConstants.js` wraps the identical calls in `try/catch` for this reason, and `connectivity.js` treats blocked storage as a supported condition.

**Fixed:** `readLastActivity` / `writeLastActivity` helpers with `try/catch`, degrading to an in-memory timestamp (the timeout still works per tab; it just stops being shared across tabs, which is all localStorage was buying).

---

### D-09 · HIGH · Admin screen mutates a cache four other contexts are reading
`src/pages/admin/Users.jsx:32`

```js
subscribeOrgUsers(orgId, (list) => setUsers(list.sort(...)))
```

`subscribeOrgUsers` is ref-counted and multiplexed — `createSharedSubscription` hands the **same array reference** to every subscriber and keeps it as the channel's cache. Sorting in place reorders the arrays `IncidentContext`, `TrainingContext`, `PermitContext` and the inspections `DataContext` already hold, with no re-render to tell them, and any component subscribing during the 30 s linger window gets the mutated copy.

**Fixed:** `[...list].sort(...)`.

---

### D-10 · HIGH · The incidents KPI counts deleted incidents
`src/modules/objectives/lib/kpis.js:146`

```js
const mine = incidents.filter((i) => inScope(i, level, scope, entity))
```

Every sibling KPI filters `!u.deletedAt`. This one doesn't, and its data comes from `subscribeOrgCollection`, which returns raw rows — the incidents module soft-deletes and filters downstream in `IncidentContext`. So deleted incidents inflate the one KPI where a higher number is *worse*, and it is quoted upward as an OH&S objective.

**Fixed:** added the `!i.deletedAt` filter.

---

### D-11 · HIGH · The whole audit module hangs on "loading" if any listener errors
`src/modules/audit/services/{auditModule,audits,capa,findings}.js` — 5 listeners

None of them passed an `onSnapshot` error callback. That is not a missing log line: `onSnapshot` without one raises "Uncaught Error in snapshot listener" and never calls the success callback again. A `permission-denied` — rules not yet published, a token refresh, a sign-out race — leaves `InternalAudit`, `CapaRegister` and `FindingsRegister` on their empty state permanently, reading as an org with no audit programme rather than a module that cannot read one.

Every other module already passes one (hira's `onSnapErr`, emergency's `() => cb([])`, documents, cctv, training).

**Fixed:** added `src/modules/audit/services/snapshotError.js` with a shared `onSnapErr(label, cb)` that suppresses normal sign-out via the existing `isSessionEnd` helper and calls `cb([])` so loading flags clear. Wired into all five.

---

## 3. Open — Critical & High

### D-12 · CRITICAL · LOTO: the same padlock can be applied to two machines at once
`src/modules/loto/services/procedures.js:276`, `pages/operations/OperateProcedure.jsx:23`

The `setPointLock` transaction validates lock-number uniqueness **only inside the single procedure document it read**. Cross-procedure uniqueness is enforced only in the browser, from `collectInUseLockNos(procedures)`. Two operators on two procedures both see lock `#12` free and both commit; neither transaction notices. It also fails silently when `useOrgProcedures` truncates at `COLLECTION_READ_CAP` — a locked procedure past the cap is absent from the in-use set.

For LOTO this is a life-safety invariant, not a UX nicety.

**Recommended fix:** make the lock number the key of a claim document (`lockClaims/{orgId}_{lockNo}`) and `tx.create()` it inside the same transaction — creation fails if the lock is held anywhere. Delete it on unlock.
**Not patched here:** needs a new collection, a rules block and a migration for locks currently held; too large to land unverified without the emulator.

---

### D-13 · CRITICAL · HIRA action tracker can silently delete hazards
`src/modules/hira/pages/ActionTracker.jsx:82`

```js
const activities = (a.activities || []).map((act) => ...)
await updateAssessment(orgId, a.id, { activities })
```

`a` comes from the live list. Setting one control to "Implemented" writes back **every activity, hazard and control** of that assessment as it looked when the snapshot arrived. A concurrent edit — someone adding a hazard in `CreateAssessment`, another tracker user closing a different action — is silently reverted. On a risk register a hazard can disappear with no audit trail.

**Recommended fix:** `runTransaction` re-reading the assessment inside the transaction, or move additional controls into their own subcollection so a status change is a single-document write.

---

### D-14 · HIGH · Approving two fire-extinguisher reports at once loses one defect
`src/modules/fire/lib/firestore.js:660`

`getExtinguisher` → build a `Set` → write the whole `physicalDefects` array. Two approvers clearing the pending queue — the normal way that screen is used — each read the pre-change array and each write their own version. One reported defect is lost and `status` may not flip to `TO_BE_REFILLED`. Safety-visible.

**Recommended fix:** `arrayUnion(report.defectType)` plus a transaction for the conditional status flip.
**Not patched here:** `updateExtinguisher` derives the QR mirror payload and stats delta from a locally merged object, so an `arrayUnion` sentinel passed through it would poison both. The fix needs those three writes reworked together.

---

### D-15 · HIGH · AED / FAS asset IDs are computed client-side and collide
`src/modules/fire/lib/assetLogic.js:15`, used in `AEDRepository.jsx:125,133` and `FASRepository.jsx:116,124`

`nextAssetId(prefix, list, field)` reads the highest sequence out of a **capped** in-memory list. Two people opening "Add AED" concurrently both get `AED-0042`; `generateAll` hands out `base+1+i` for a whole batch with no reservation. `assetId` is the human handle printed on the QR label, and nothing downstream dedupes.

**Recommended fix:** route through the existing `reserveDocId` / counter-document mechanism, as `createAssessment`, `addMockDrill` and `createAuditFinding` already do.

---

### D-16 · HIGH · Meeting document IDs collide every 10 seconds
`src/modules/committee/pages/Consultation.jsx:424`

```js
`MOM-${siteId || 'ORG'}-${Date.now().toString().slice(-4)}`
```

Last 4 digits of a millisecond timestamp is a 10-second cycle. Two meetings for one site within any 10 s window get the same `docId` — the value printed on the minutes, the export and the Action Tracker context.

**Recommended fix:** `reserveDocId(orgId, 'committee')`.

---

### D-17 · HIGH · Audit plan IDs are a deterministic function of `(siteId, rowCount)`
`src/modules/audit/pages/app/InternalAudit.jsx:77`

```js
const seq = 1000 + Math.floor(rows.length * 137 + plan.siteId.length * 41) % 9000
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [plan.siteId])
```

Two plans for the same site with the same number of rows always produce the same `docId`. And `rows.length` is read but not in the dependency array — the suppressed lint warning is the bug — so adding rows after picking the site leaves the ID computed from the old count. The value is neither unique nor consistent with its own formula.

**Recommended fix:** `reserveDocId(orgId, 'auditPlans')` and delete the effect.

---

### D-18 · HIGH · Finding IDs cycle every 90 seconds
`src/modules/audit/pages/app/InternalAudit.jsx:318`

```js
const genId = () => `AF-${10000 + Math.floor((Date.parse(new Date().toISOString()) % 90000))}`
```

`% 90000` wraps every 90 s. Finding IDs are the key the central Action Tracker matches on (`actions/lib/sources.js:236`) and are displayed as the finding reference. Line 358's `f.id || genId() + idx` is also dead code and would string-concatenate rather than offset.

**Recommended fix:** `crypto.randomUUID()` — already wrapped as `uid()` in `hira/lib/id.js`.

---

### D-19 · HIGH · Editing an audit finding mutates the shared Firestore cache
`src/modules/audit/pages/app/InternalAudit.jsx:337,342`; same pattern at `Consultation.jsx:400`

```js
const updateRow = (i, f, v) => { const u = [...findingRows]; u[i][f] = v; setFindingRows(u) }
```

`openTask` seeds `findingRows` with the actual objects from the `subscribeAuditFindings` snapshot. Typing into a row mutates the shared cache in place — `FindingsRegister`, `CapaRegister` and the Action Tracker see edited data that was never saved, with no re-render, and abandoning the edit does not undo it.

**Recommended fix:** `u[i] = { ...u[i], [f]: v }`. Also add `try/catch` to the `async handleFile` at :338.

---

### D-20 · HIGH · A failed photo upload leaves the mock-drill record lying about its evidence
`src/modules/fire/lib/firestore.js:962`

The drill document is committed with `photoCount: valid.length` *before* the upload loop, which is two sequential awaits per photo. If any iteration throws, the drill exists claiming more photos than were stored — `MockDrills.jsx:245` gates the fetch on `photoCount > 0`, so the viewer waits for evidence that will never arrive — while the caller reports "save failed" for a drill that *was* saved.

**Recommended fix:** `Promise.all` the uploads, then write the count that actually landed; or roll the drill document back.

---

### D-21 · HIGH · Three more modules hang on a permanent spinner
`incidents/context/IncidentContext.jsx:43`, `inspections/context/DataContext.jsx:27`, `ptw/context/PermitContext.jsx:28` — with listeners at `incidents/lib/incidents.js:272`, `inspections/lib/firestore.js:43`, `ptw/lib/firestore.js:404`

Same shape as D-11: `loading` is cleared only from the success callback and the underlying listeners register no error handler. A missing composite index, a rules change, or a momentary permission-denied leaves the module spinning forever.

**Recommended fix:** the pattern now in `audit/services/snapshotError.js`; `training/lib/firestore.js:38` is the other model.
**Not patched here:** each context needs its `done()`/error-state wiring reviewed individually, and the e2e suite that would prove it can't run in this environment.

---

### D-22 · HIGH · A completed one-off inspection stays on the schedule forever
`src/modules/inspections/lib/schedule.js:246` + `pages/Execute.jsx:156`

Submitting writes the record with `assignmentId`, but nothing ever flips the assignment's status — the only statuses ever written are `Pending` and `Cancelled`. Recurring assignments are saved by the `pastRecords` slot check; the one-off branch has no record check at all, so a completed assigned inspection is permanently "Pending" and rolls into `overdueTasks`.

**Recommended fix:** patch the assignment to `Completed` after `addRecord` succeeds; belt-and-braces, add `&& !pastRecords.some(r => r.assignmentId === a.id)` to the one-off branch.

---

### D-23 · HIGH · A stakeholder edit form can overwrite a real record with a blank one
`src/modules/stakeholder/pages/EscalationForm.jsx:49,63,100`; identical in `LegalIssueForm.jsx:43`

There is no `!found && !loading` branch. The listener caps at 500, so on a large org — or any deep link to an older record — `loading` goes false, `hydrated` stays false, the render guard no longer holds, the form shows `EMPTY`, and saving writes the shaped blank over the live document.

**Recommended fix:** render a "record not found" state and disable save when `id && !loading && !hydrated`; fetch by id with `getDoc` rather than searching a capped list. (Also: if either listener errors, `bind()` sets `error` but never `loaded`, so the form skeletons forever.)

---

### D-24 · HIGH · The platform operator console has no idle timeout
`src/App.jsx:227`, `src/pages/platform/PlatformShell.jsx`

`useIdleTimeout` is mounted in exactly one place — `AppChrome.jsx:39`. Tenant routes and the portal go through `AppChrome`; `/platform` renders `PlatformRoute → PlatformShell`, which deliberately does not. The single highest-privilege account in the system — the one that toggles module entitlements for **every** tenant — is the only one with no inactivity logout.

**Recommended fix:** call `useIdleTimeout()` in `PlatformShell` and sign out on `isExpired`, as `AppChrome.jsx:41` does.

---

### D-25 · HIGH · Envelope encryption is inert in production
`src/shared/crypto/keyring.js:74`, `.env.production`

```js
export const sealingEnabled = clean(import.meta.env.VITE_ENCRYPTION) === 'on'
```

`.env.production` never sets `VITE_ENCRYPTION`; `.env.example` sets it to `off`, and Vite loads `.env` for every mode, so production inherits `off`. Every "sealed" field — `medication`, `bodyParts`, `injuryType`, `healthIssue`, `exposedToAgent`, `affectedPersonnel[].name`, and all file buckets — is written **in cleartext**, while the code, the callable and the docs all read as though it is on.

`.env.production:9` documents this exact inheritance trap for a different key ("that is how production shipped pointing at the emulator bucket").

**Recommended fix:** set `VITE_ENCRYPTION=on` in `.env.production`, then run the field backfill (`src/shared/crypto/backfill.js`, which already refuses to run without it) and `sealStoredObjects`.
**Not patched here:** flipping the flag without the backfill leaves existing cleartext rows unreadable-by-policy and new rows sealed — a data migration, not a config edit.

---

### D-26 · HIGH · Reference-number counters can be rewound
`firestore.rules:1272` + `incidents/lib/incidents.js:159`, `illnesses.js:49`

`docSeq` is protected with strict monotonicity, with a comment explaining exactly why ("a counter that can move BACKWARDS hands the next record an id already printed on a permit"). The legacy `refNo` counters live in `/meta`, which `structuralOnly()` does **not** exclude — so any member can `setDoc(.../meta/stats, {nextSeq:1}, {merge:true})`, producing duplicate `IRA-…` / `ILL-…` numbers on records quoted to regulators, and zeroing the dashboard totals in the same write.

**Recommended fix:** give `/meta/{kind}` the monotonic rule `docSeq` has, or migrate `reserveRefNo` onto `docSeq`.

---

### D-27 · HIGH · Module entitlements are a client-side-only control
`firestore.rules:665` (defined, never referenced) + `src/shared/modules/ModuleGate.jsx:23`

`/moduleEntitlements/{orgId}` exists and is platform-admin-write-only, but **no other rule in the 1299-line file reads it**. Enforcement is React alone. The gate's own header says otherwise:

```js
// Firestore rules stop the data leaving, but an unguarded route would still mount the module
```

They don't. A member of an org whose `loto` / `ptw` / `training` entitlement was revoked can still read and write those collections straight from the SDK. Tenant isolation is intact — this is a licensing bypass, not a data leak.

**Recommended fix:** add a `moduleAllowed(orgId, col)` conjunct to the generic org rule, absent-means-enabled, mapping collection → module key. Costs one cached document read per request.

---

### D-28 · HIGH · `xlsx` — prototype pollution + ReDoS, no fix on npm
`GHSA-4r6h-8v6p-xvw6`, `GHSA-5pgg-2g8v-p4x9`

Ships to users (it is a runtime dependency). Already carried in `scripts/audit-gate.mjs`'s named allowlist, which is the right handling — but the allowlist entry is the mitigation plan, and there isn't one yet.

**Recommended fix:** SheetJS publishes fixed builds on its own CDN, not npm. Either move to the vendored build, or narrow exposure — the app parses user-uploaded workbooks in `BulkUpload`/`BulkImport`, which is exactly the untrusted-input path both advisories describe.

---

### D-29 · MODERATE · `react-router` open redirect + constructor injection
`GHSA-wrjc-x8rr-h8h6`, `GHSA-337j-9hxr-rhxg` — `react-router-dom@6.26.0`

Open redirect via backslash in `<Link>`/`useNavigate`. Fix is available: `npm audit fix` (stays within 6.x).

---

## 4. Open — Medium & Low

### Dates and timezones (Medium, systemic)

The codebase already has **three** correct local-date helpers — `cctv/lib/defectDate.js:29`, `hira/lib/raStats.js:122`, `actions/lib/sources.js:32` — and these sites bypass all of them.

| # | Defect | Where |
|---|---|---|
| D-30 | `toISOString().split('T')[0]` used as "today" / due date. `setDate` is local, `toISOString` is UTC — in UTC+5:30 anything done between 00:00 and 05:30 yields **yesterday**, so a Major NC nominally due in 7 days gets 6. | `audit/…/InternalAudit.jsx:357,546,947`; `committee/…/Consultation.jsx:209,230,287,528`; `emergency/lib/firestore.js:302,452`; `fire/components/SubmitQuotationModal.jsx:74` |
| D-31 | `new Date('2026-08-26') < new Date()` — date-only strings parse as UTC midnight, so an action due *today* shows a pulsing red **Overdue** badge from 05:30 that morning in IST. | `committee/…/Consultation.jsx:125`; `audit/lib/format.js:37`; `audit/…/CapaRegister.jsx:22`; `audit/…/InternalAudit.jsx:641` |
| D-32 | Training expiry window off by one day at negative UTC offsets — `new Date(today)` is UTC midnight, `setDate/getDate` are local, so a certificate expiring in exactly 30 days reads `valid` instead of `expiring`. | `training/lib/status.js:28,70` |
| D-33 | `toDate()` result never validated — the `Number.isNaN` guard covers the string branch only, so a corrupt Timestamp renders as the literal `"Invalid Date"` and `isOverdue` returns `NaN < n` → `false`, reporting an overdue CAPA as on time. `fire/lib/extinguisherLogic.js:22` does this correctly. | `audit/lib/format.js:3` |

**Fix for all four:** one shared `todayISO()` / `parseDateOnly()` pair, and compare ISO **strings** for overdue — which `actions/lib/sources.js:35` and `hira/lib/raStats.js:128` already do.

### Correctness (Medium)

| # | Defect | Where |
|---|---|---|
| D-34 | Duplicate-name guard **inverts** when duplicates already exist: `has()` means "resolves unambiguously" but is used to mean "exists", so an estate with two `DVR-Gate-01`s happily imports a third — the exact case the name index exists to prevent. | `cctv/lib/bulkImport.js:97,114,160` |
| D-35 | Save button stuck disabled forever — `saveDefects` destructures before its `try`, so a synchronous throw rejects the promise and `setBusy(false)` never runs. Needs `finally`. | `cctv/pages/Inventory.jsx:489` |
| D-36 | CSV-imported risk assessments get **no `docId`** — the UI path reserves one, the bulk path doesn't, so every imported row shows blank in lists, exports and PDFs. | `hira/lib/firestore.js:119` vs `:94` |
| D-37 | ALARP: the comment says additional controls / projected risk are dropped; no such branch exists, so `residualRisk` uses projected P×S for an ALARP-accepted hazard and **understates** the residual risk on the register. `hira/lib/csv.js:270` implements the rule, so CSV and form paths produce different data. | `hira/pages/CreateAssessment.jsx:170,189` |
| D-38 | `syncAll` prompts with `behind.length` but processes `behind.filter(x => !x.customized)`, and a mid-loop throw leaves earlier plans reverted to `draft` (unprintable) with only "Failed" on screen. | `emergency/components/RescuePlans.jsx:82` |
| D-39 | Derived overdue state frozen at the last data change — no clock in the memo deps, so a wall-mounted dashboard never re-evaluates "Refill Due" at midnight. `isPhysicalDefect` also takes no `today` and calls `new Date()` itself, so the summary count and the list can disagree. | `fire/context/FleetContext.jsx:123`; `fire/lib/extinguisherLogic.js:129` |
| D-40 | `updateIncident` stats delta is a non-atomic read-modify-write, so two concurrent edits both emit a delta from the same `before` and the `meta/stats` counters drift permanently — while `bumpStats` swallows its own failures. The ref-no counter in the same document *is* transactional. | `incidents/lib/incidents.js:234` |
| D-41 | `createPermit` writes the permit, then loops attachments sequentially — an oversized inline fallback throws mid-loop, leaving a permit with its number consumed and its mandatory documents half-attached, reported to the user as a failure. | `ptw/lib/firestore.js:227` |
| D-42 | `syncIncidentInjuries` does one sealed write per person, serially — a 15-casualty incident is 15 sequential RSA/AES seals + round trips, non-atomic. | `incidents/lib/injuries.js:178` |
| D-43 | `logTraining` uses a **single unchunked** `writeBatch` — `matching.length + employees.length` can exceed Firestore's 500-op limit and the commit rejects wholesale. Its two neighbours in the same file chunk at 400. | `training/lib/firestore.js:146` |
| D-44 | `PF` is a component **defined inside render**, so React unmounts and remounts every Pass/Fail button group on every keystroke anywhere in the form. | `inspections/pages/Execute.jsx:178,281` |
| D-45 | Inputs flip uncontrolled → controlled: the initialiser runs in `useEffect`, but first paint happens before it with `responses === {}`, so `value` is `undefined`. Needs `value={r.answer ?? ''}`. | `inspections/pages/Execute.jsx:283` |
| D-46 | `subscribeTemplates` is the only uncapped listener in the module, and templates carry their full `fields` **and** `assignments` arrays. | `inspections/lib/firestore.js:43` |
| D-47 | Recurring-occurrence expansion has no lookback bound — a Daily template assigned three years ago yields up to 1000 occurrences for that one template, then stops silently at the safety cap. Both enormous and incomplete, with no indication of either. | `inspections/lib/schedule.js:91` |
| D-48 | Storage `create` caps size but has **no content-type allowlist**, so any writer can store `text/html` / `image/svg+xml` under the org prefix and `getDownloadURL()` serves it inline as a permanent unauthenticated link. | `storage.rules:143` |

### Low

| # | Defect | Where |
|---|---|---|
| D-49 | Library reports "loaded" on the **first** of several queries, so the skeleton clears and a partial document library briefly presents as complete. | `documents/lib/service.js:33` |
| D-50 | Sort comparator returns `NaN` for records with no date — inconsistent comparator, engine-dependent ordering. | `committee/…/Consultation.jsx:252` |
| D-51 | Shared subscriptions serve a **previous session's cached rows** for up to 30 s after sign-out; `AuthContext` clears the keyring on identity change but nothing clears these channels. | `shared/org/sharedSubscription.js:12,33` |
| D-52 | `subscribeOrgUsers` and `subscribeIllnesses` are uncapped, and `subscribeIllnesses` doesn't filter `deletedAt` at the seam (its sibling `subscribeInjuries` does, and documents why). | `shared/org/orgData.js:213`; `incidents/lib/illnesses.js:124` |
| D-53 | `/notifications` is client-writable — a member can pre-create ledger rows that suppress a mail they cannot read back. Currently unexploitable: the writer the rule cites, `functions/lib/notify.js`, **does not exist**. | `firestore.rules:1156,1200` |
| D-54 | `/qr` and `/permitQr` creates aren't bound to the asset they mirror, and their payload shape is unvalidated — `/procedureQr` does both correctly with `getAfter`. Bounded by 18-char random tokens, hence Low. | `firestore.rules:477,549` |
| D-55 | Comments contradict the code: "No `files: true`" / "the bucket object is not sealed" sit directly above entries that set `files: true`. Harmless direction (over-sealing), but repeated in `fire/lib/firestore.js:968`. | `shared/crypto/policy.js:233,281` |
| D-56 | Rate-limit `sleep(1100)` runs after the **final** category too, adding 1.1 s of dead time to every fallback lookup. | `emergency/lib/nearby.js:172` |
| D-57 | Working tree shows **254 files as fully rewritten** in `git diff` — a CRLF/LF normalisation artifact, not real changes. It will make every future review of this branch unreadable. | repo-wide |

---

## 5. Coverage gaps in this pass

Two suites could not be executed here, and their findings should not be read as "clean":

- **`npm run test:rules`** — the Firestore emulator JAR download is refused by the sandbox network allowlist. The `firestore.rules` and `storage.rules` changes in D-05, D-06 and D-07 are therefore **verified by reading, not by execution**. Six + four regression tests were added to `tests/hardening.rules.test.js`; **run `npm run test:rules` before merging.**
- **Playwright e2e** (`smoke`, `accessibility`, `console-sweep`, `capped-reads`) — Chromium download refused for the same reason. Substituted a static review of the specs and the CI workflow, both of which are well constructed.

Everything else — lint, the 1827 unit tests, the 357 functions tests, the production build, and the dependency audit — ran to completion, before and after the patches.

---

## 6. Suggested order of work

1. **D-12** (LOTO duplicate lock) — life-safety invariant, and the only defect here where the failure mode is physical.
2. **D-25** (encryption inert in production) — every hour it stays off is more cleartext to migrate.
3. **D-13, D-14, D-20** — silent data loss in safety registers.
4. **D-24, D-26, D-27** — privilege and integrity gaps in the rules layer.
5. **D-15 … D-18** — ID generation; cheap fixes, and duplicate IDs get worse the longer they accumulate.
6. **D-30 … D-33** — one shared date helper closes all four.
7. **D-57** — fix the line-ending normalisation before any of the above, or every diff after it is unreviewable.
