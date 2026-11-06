# Custom stack (path 3)

Path 3 is a **deploy / onboard choice**: this environment runs its own
Postgres (Supabase or another Postgres), its own S3-compatible file store,
and its own replacements for Firebase Auth, `firestore.rules` /
`storage.rules`, and Cloud Functions.

The product as it is operated today stays on Firebase. This document does
not describe standing up another Firebase or Google Cloud project. That is
already how this system is deployed. `docs/PRODUCTION.md` is the pointer to
the private runbook for that deployment, and `DEPLOYMENT.md` is the
first-organization check, the post-deploy check, and rollback.

**Path 3 is not ready to boot.** `postgres` and `supabase` are reserved
`VITE_DATA_DRIVER` names. Selecting either one throws
`UnimplementedDataDriverError` at startup and does not open Firestore under
that name. An operator can choose path 3 today. They cannot flip the flag
and serve traffic on it.

The default build is unchanged: `VITE_DATA_DRIVER` unset or `firestore`,
`VITE_STORAGE_DRIVER` unset or `firebase`.

## The choice

|                      | Firebase deployment (current product)         | Path 3 — custom stack                                                                     |
| -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| When it applies      | The environment this repository already ships | A deploy that will not use Firestore, Firebase Auth, Firebase Storage, or Cloud Functions |
| Database             | Cloud Firestore                               | Postgres, Supabase or otherwise                                                           |
| Files                | Firebase Storage                              | S3-compatible (`s3` driver, already implemented)                                          |
| Auth                 | Firebase Auth, SAML/OIDC, TOTP                | A replacement session. No auth driver flag                                                |
| Enforcement          | `firestore.rules`, `storage.rules`            | RLS, bucket policy, presign checks                                                        |
| Background work      | `functions/`                                  | Operator-hosted workers                                                                   |
| Where it is recorded | The Firebase build env                        | Deploy config. Never the SPA                                                              |
| Serves traffic       | Yes                                           | Not until the gap list below is done                                                      |

Choosing path 3 means funding that list. It does not create a second way to
deploy Firebase.

## Non-goals

- **No in-app credential form.** A tenant admin does not paste a connection
  string, an S3 secret, a service-role key, or a database password into the
  SPA. The browser cannot be given a credential that bypasses RLS.
- **No runtime backend switch.** The driver is compiled into the bundle from
  the environment the build was given. Changing it means rebuilding. There
  is no per-tenant setting under `organizations/{orgId}`, and there must not
  be one: anything the SPA can read, the browser console can read.
- **No privileged database URL in a `VITE_` variable.** Vite inlines every
  `VITE_` value into the client bundle. That bundle is public to anyone who
  can load the app.
- **No new Express policy service.** `server/` was removed because a second
  hand-maintained copy of the role helpers drifted from `firestore.rules`.
  Path 3 does not revive that. RLS is the enforcement, the way the rules
  file is the enforcement on Firebase.
- **`memory` is not path 3.** `VITE_DATA_DRIVER=memory` is an in-process
  driver for tests and demos. It has no tenancy enforcement. Do not deploy
  it.
- **This change does not add a Postgres client, a SQL schema, or an RLS
  file.** A half-registered adapter would make the reserved name resolve
  and then fail on the first exclusive create. The names stay reserved
  until an adapter implements the whole contract in
  `src/shared/data/index.js`.
- **`firestore.rules`, `storage.rules`, and the CI gates stay as they are.**
  Path 3 does not weaken them so a future adapter can write.

## Where secrets live

Record the choice in the deploy config for that environment: CI variables
for the public flags, and a secret manager or a gitignored env file for
credentials. `.gitignore` already covers `.env`, `.env.production`, and
`.firebaserc`. `functions/.env` and `functions/.secret.local` are the
existing server-side slots on the Firebase path; a path 3 host uses its own
secret store with the same split.

Public by construction (they end up in the bundle):

- `VITE_DATA_DRIVER` — `firestore` (default), `memory` (not a production
  store), `postgres`, `supabase`. The last two throw until an adapter is
  registered.
- `VITE_STORAGE_DRIVER` — `firebase` (default) or `s3`. `s3` is implemented.
  It is a file-store swap, not a whole custom stack.
- `VITE_S3_PRESIGN_ENDPOINT` — a URL only. No access key in the URL, the
  query, or the path.

A Supabase **anon** key may be baked into the client, and only because RLS
is what makes that safe. The **service-role** key bypasses RLS. It stays on
the workers. It is never a `VITE_` variable and never a field in a document
the client can read.

Server-only. Names already used on the Firebase path, so a rehost keeps the
same split rather than inventing client copies:

- **Database URL for the bypass role, or the Supabase service-role key.**
  Held by migrations, key release, and retention. It is the credential
  that does not consult RLS.
- **S3 access key and secret.** The presign host only.
  `src/shared/storage/adapters/s3.js` does not hold them.
- **Session signing secret** for the auth replacement. The auth service
  holds it. A forged session is a forged org.
- **`DATA_KEY_MASTER`.** The key-release worker. Losing it destroys every
  sealed record in every tenant: the keys stored alongside the data are
  wrapped under it. The comment on `VITE_ENCRYPTION` in `.env.example` is
  the constraint. Do not keep a second copy of the encryption procedure.
- **`SMTP_PASS`.** The mail worker. `DEPLOYMENT.md` §6 and
  `functions/.env.example`.
- **`WA_APP_SECRET`, `WA_ACCESS_TOKEN`, `WA_VERIFY_TOKEN`.** The WhatsApp
  worker. `functions/.env.example`.

`AUTH_WEB_API_KEY` is the Firebase password-completion key used by Cloud
Functions. A path 3 auth provider updates the password on its own server.
That key is not reused, and it is not copied into the client.

## Adapter map

The contract for the database seam is the header of
`src/shared/data/index.js`. It is the specification. `adapters/memory.js` is
the second implementation and the one to read before writing a third.
`src/shared/data/README.md` is the short version that sits next to the code.
This file does not restate the contract. It says what path 3 has to attach
to it.

### Database — `VITE_DATA_DRIVER`

Registered today: `firestore`, `memory`.

Reserved, not registered: `postgres`, `supabase`.
`src/shared/data/resolveDriver.js` throws
`UnimplementedDataDriverError` when the build selects one and no adapter is
in the `DRIVERS` map. An unknown string still falls back to `firestore`, so
a typo cannot take down the Firebase deployment. A name this repository has
published is not treated as a typo.

`supabase` is the name when the project also uses Supabase Auth and
Supabase Realtime. `postgres` is the name when identity and realtime are
supplied beside a plain Postgres. They are one adapter family. Neither is
implemented.

The mapping, when the adapter is written:

- One table per collection path, or one documents table keyed by the full
  path. The seam addresses `(path, id)` and is deliberately not org-scoped
  by construction: public QR mirrors, `users`, `orgIndex`, and LOTO's
  top-level collections are written in the same batch as an org document.
- `org_id` plus `jsonb` is the natural row. Tenancy is RLS, not the path
  helper.
- `subscribe` / `subscribeDoc` return their unsubscribe function
  **synchronously** and deliver the first emission asynchronously. The
  registry is a static import for that reason. A dynamic `import()` of the
  Postgres SDK cannot meet the contract without changing every caller. The
  day the adapter is registered, its SDK is in the main bundle. That cost
  is accepted.
- `createExclusive` is `INSERT … ON CONFLICT DO NOTHING` with a rowcount
  check, or a primary-key violation. It is never `SELECT` then `INSERT`.
- `update` rejects when the row is absent. An upsert rewinds the incident
  reference-number counter. The contract header says how.
- `count` is a real aggregate, or it returns `null`. A count that reads the
  rows is not an implementation of it.
- A batch is one transaction across arbitrary collections.
- Stored values pass through unchanged. Do not normalise Firestore
  `Timestamp` values to ISO strings on read. Call sites read `.seconds` and
  `.toDate()`. An all-zero comparator leaves the original order, so the
  list looks fine and is wrong. `src/shared/data/README.md` has the detail.
- Say so in the adapter's notes, rather than emulating them: a Firestore
  `where('x','==',null)` does not match a missing field, and `orderBy`
  drops documents that lack the ordered field. SQL returns those rows.
- `serverTimestamp`, `increment`, and `arrayUnion` resolve on the server,
  `increment` without a read.

A registered adapter wins over the reserved list, so adding the file to
`DRIVERS` makes the name selectable. Remove the name from
`RESERVED_DATA_DRIVERS` in that same change.

### Files — `VITE_STORAGE_DRIVER`

`s3` is the path 3 file driver. It is registered
(`src/shared/storage/adapters/s3.js`). The browser never holds the bucket
credential. It `POST`s to `VITE_S3_PRESIGN_ENDPOINT`:

- `{ op: 'put', path, contentType }` → `{ uploadUrl, publicUrl }`
- `{ op: 'delete', path }` → `{ deleteUrl }`

The endpoint checks the caller's session and that `path` starts with
`orgs/<orgId>/`, which is what `storage.rules` checks on Firebase. The path
layout comes from `storagePath()` and is backend-neutral on purpose.

What `s3` does not do:

- It still sends `Authorization: Bearer <Firebase ID token>`. Until Auth is
  replaced, an S3 bucket in front of a Firebase session is a file-store
  swap. Say that to the organization. Do not describe it as path 3.
- `removeFile` on the Firebase driver goes through the `deleteOrgFile`
  callable, because a Storage rule can only see the ID token and a token
  stays valid for up to an hour after the person is suspended, demoted, or
  moved (`storage/index.js`, the S-19 note). The S3 driver deletes through
  the presign endpoint. That endpoint has to re-read the live profile. A
  bucket policy that trusts the bearer token alone reopens the same hole.
- `putFile` returns null when the bucket is unreachable, and callers then
  write the bytes inline into the database document (under
  `MAX_INLINE_BYTES`). On a mixed deploy those bytes still land in
  Firestore. The magic-byte check and the sealing step run before the
  adapter and stay in `src/shared/storage/`.

`firebase/storage` is imported only by
`src/shared/storage/adapters/firebase.js`. Call sites already go through
`putFile` / `removeFile` / `fileUrl`. The file seam is the one that is
actually in use.

Setting `VITE_STORAGE_DRIVER=s3` while the database is still Firestore is
allowed. It is not a custom-stack cutover.

### Auth — no driver flag

There is no `VITE_AUTH_DRIVER`. Adding a facade that still calls Firebase
would claim a seam the call sites do not go through. Identity is created in
`src/shared/firebase.js` and consumed by:

- `src/shared/auth/AuthContext.jsx` — session, sign-up, sign-in, SSO
  popup/redirect
- `src/shared/auth/mfa.js` — TOTP
- `src/shared/auth/sso.js` — `VITE_SSO_PROVIDERS`
- `src/shared/auth/provisioning.js` — a secondary app, so creating a user
  does not replace the admin's session
- `src/pages/auth/ForcePasswordChange.jsx`
- `src/shared/auth/platformAdmin.js` — the operator grant, read from
  Firestore
- the S3 presign header
- every Cloud Function that reads `request.auth`

The session a replacement issues has to be able to prove the same facts the
rules use: `uid`, `orgId`, `role`, `status == approved`, and
`mustChangePassword`. Custom claims exist on Firebase because Storage rules
cannot query Firestore (`syncUserClaims`). RLS can query the profile table.
Use that live read for deletes and for presign. A claim mirror that is
trusted on its own for an irreversible delete is the S-19 failure again.

SAML/OIDC and TOTP are part of the current product
(`docs/ENTERPRISE-READINESS.md`). A path 3 provider that drops either is a
product cut. Record it. Do not let it fall out of a driver flag.

Anonymous routes (`/qr/:token`, `/permit/:token`, `/p/:id`, `/t/:id/:point`)
have no session. Their write is bound to a token that resolves to one org
and one asset. The replacement has to keep that binding in the database
policy, not in React.

App Check is what stops those public writes being scripted on Firebase
(`docs/ENTERPRISE-READINESS.md`). A path 3 host picks a replacement for that
control before those routes are exposed on the new stack. This document
does not specify the vendor.

### Security — RLS and bucket policy

`firestore.rules` and `storage.rules` stay the enforcement for the Firebase
deployment. Path 3 translates them. It does not edit them to be weaker.

`can()` in `src/shared/auth/permissions.js` is a usability feature. The same
write succeeds from the browser console unless the database refuses it.
That sentence is the whole security model (`docs/SECURITY.md`, `AGENTS.md`).

A single `org_id = auth.uid()` policy is not a translation. The rules file
is large because the exceptions are the product. Top-level paths a policy
set has to cover, not only `organizations/{orgId}`:

- `users/{uid}` — profile, role, approval, the password-change gate
- `organizations/{orgId}` and everything under it, including append-only
  `auditLogs` and the manager-only medical collections
- `orgIndex/{key}`
- `qr/{token}`, `procedureQr/{procedureId}`, `permitQr/{token}` — anonymous,
  token-bound
- `lockClaims/{claimId}`, `lotoEvents/{eventId}`
- `platformAdmins/{uid}`, `moduleEntitlements/{orgId}`
- the legacy collection wildcard in `firestore.rules`

`storage.rules` matches `orgs/{orgId}/…` and a stricter match for
`medical-records`. The presign endpoint and the bucket policy are the
replacement. Medical objects are not a second public prefix.

Two bugs have each shipped three times on Firestore, and both exist in SQL.
`docs/SECURITY.md` and `AGENTS.md` name them. Write the policies so they
cannot come back:

1. **Permissive union.** Postgres ORs permissive policies for the same
   command. A narrow policy does not take away what a broad one grants.
   The strict case is a restrictive policy. Add a test where both match
   and the narrow one wins.
2. **Post-state check.** `WITH CHECK` sees the row after the write. `USING`
   sees the row before it. Authorise the writer from the existing row. A
   policy that reads the new `role` to decide whether this writer may set
   `role` is the bug.

The rules suite sends hostile payloads. A path 3 suite has to do the same:
org A cannot read org B, a member cannot perform a manager action, an
anonymous write without the token is refused, an auditor cannot delete a
file. A test that confirms the happy path is not that suite. After any
future edit to `firestore.rules`, the rules-test count must stay the same
unless the semantic change is intentional (`AGENTS.md`). Path 3 does not
touch that count.

Enable RLS on every table the browser role can see, including the tables
that are not org-scoped. A table with RLS off is world-readable to the
anon key.

### Cloud Functions equivalents

`functions/index.js` is the inventory. `src/shared/functions.js` is the
client that calls it, and it imports `firebase/functions`. Path 3 replaces
that client with whatever RPC the new host exposes. Do not point the
existing callable client at a non-Firebase URL and hope.

Triggers today are Firestore `onWrite`. On Postgres they are triggers or a
transactional outbox written in the same transaction as the row. A poller
that can miss a write will miss an assignment. The pure planning functions
under `functions/lib/` are what can move. The `onCall` wrappers are the
Firebase binding.

Before any tenant is served from path 3:

- **Stamp identity from the live profile** — `syncUserClaims`,
  `backfillClaims`. A pending member must not receive a tenant.
- **Password change** — `completePasswordChange`. Member checks fail while
  `mustChangePassword` is set (`passwordIsOwn` in `firestore.rules`). Only
  this path may clear it, and only after the password itself is replaced.
- **Release data keys** — `getDataKeys`. The master stays server-side. The
  caller receives only the classes their role allows. Read
  `docs/DATA-RIGHTS.md` §2 before porting any search for a person: with
  encryption on, that search reads ciphertext, and zero matches is
  indistinguishable from a person who is not mentioned.
- **Seal stored objects** — `sealStoredObjects`. Same master key.
- **Delete a file** — `deleteOrgFile`. The check reads the live profile.
- **Subject-access export** — `exportSubjectData`. Read
  `docs/DATA-RIGHTS.md` before porting the scan.
- **Retention purge** — `purgeSoftDeleted`. It destroys records.
  `functions/lib/retentionPolicy.js` marks personal-data rows
  `NEEDS_LEGAL_SIGN_OFF`. Do not start a new scheduler that deletes
  statutory records.
- **Stale permit mirrors** — `withdrawStalePermitMirrors`. A stale mirror
  is a safety lie.
- **LOTO permit sweep and purge** — `sweepLotoPermits`,
  `purgeClosedLotoPermits`.
- **Mail the product already sends**, if that deployment sends mail. The
  secret stays `SMTP_PASS`. The exports are `notifyIncidentAssignment`,
  `notifyIllnessAssignment`, `notifyDrillAssignment`,
  `notifyTrainingAssignment`, `notifyIncidentReported`,
  `notifyPermitLifecycle`, `notifyLotoPermitLifecycle`,
  `notifyDefectReported`, `notifyExtinguisherDefect`, `notifyAedDefect`,
  `notifyFasDefect`, `notifyDrillReport`, `notifyCommitteeMeeting`.

Can follow the cutover. They are maintenance, analytics, or a channel:

- One-time backfills: `backfillDocumentVisibility`, `backfillQrMirrors`,
  `linkEquipmentSites`, `seedInjuryRecords`, `stripIncidentMedicalDetail`,
  `confineMedicalRecords`, `clearOrphanedDefectLocks`
- Metabase: `metabaseConfig`, `metabaseTest`, `metabaseQuery`. The URL
  check in `functions/lib/metabase.js` exists so an admin setting cannot
  become a request to a private network. A rehost keeps that check.
- Weather: `fetchSiteWeather`, `sendWeatherRiskDigest`,
  `retryWeatherRiskDigest`
- WhatsApp: `waWebhook`, the link and org callables, `notifyWhatsAppLinked`,
  `buildWhatsAppSnapshots`, `purgeWhatsAppLedgers`
- `refreshSiteAuditCache`, `listPlatformOrganizations`

`scripts/_firebase.mjs` and the scripts that import Firebase
(`seed*.mjs`, `seed-erp-baseline.mjs`, `seed-baseline.mjs`,
`seed-illness.mjs`, `seed-injury.mjs`, `seed-load.mjs`,
`seed-orgsettings.mjs`, `seed-sites.mjs`, `add-illness-action.mjs`,
`backfill-document-visibility.mjs`, `dedupe-cctv-merakis.mjs`,
`inventory-download-tokens.mjs`) are tools for the Firebase path. Setting
`VITE_DATA_DRIVER` does not retarget them. Demo seeds stay off a real
project; `DEPLOYMENT.md` already says so.

## What already goes through a seam

Data, three call sites:

- `src/shared/module-kit/service.js` — generic org-scoped CRUD
- `src/modules/documents/lib/folderService.js`
- `src/pages/Dashboard.jsx` — streams `incidents` and `assessments` through
  `createModuleService`, and counts live permits and expiring training
  records through `dataProvider.count`. The audit-log strip still comes
  from `subscribeAuditLogs` in `orgData.js`, which is Firestore.

`src/modules/documents/lib/service.js` writes through `createModuleService`
and **subscribes with `firebase/firestore` directly**, because a
site-scoped library cannot read the whole collection. Moving documents
means moving that subscribe in the same change as the writes.

Files: every upload goes through `putFile`. See the file section above.

That is not most of the app. `createModuleService` also calls
`reserveDocId` (`src/shared/docId/reserve.js`) on every create, and that
reservation is a Firestore transaction. A seam-backed create still takes
its reference number from Firestore until `docId/` moves. Splitting those
two is how two incidents receive the same printed number.

`module-kit`'s `subscribe` passes an error callback that renders an empty
list. The contract says a refused read must not look like "there is nothing
here". On path 3 an RLS denial, or an `orderBy` the new store rejects,
would show an empty module. Fix that callback when the first real module
moves, not by teaching the adapter to swallow errors.

## Gap list

Regenerate with:

```bash
grep -rl "firebase/firestore\|firebase/storage" src --include="*.js*" | grep -v shared/data/adapters | grep -v shared/storage/adapters
```

That command does not see `firebase/auth` or `firebase/functions`. Those
are listed here as well. Counts below are the tree this document was
written against. When the list and the tree disagree, re-run the grep and
fix this file. Do not keep a second inventory in `src/shared/data/README.md`.

### Move first — shared data

These are on the path of every module, including the ones that already use
`dataProvider`:

- `src/shared/org/orgData.js` — orgs, users, sites, the audit log, batched
  writes. `logAudit` lives here and is the only writer of `auditLogs`.
- `src/shared/docId/reserve.js` — transactional reference numbers
- `src/shared/docId/backfill.js`
- `src/shared/org/integrations.js`
- `src/shared/modules/entitlements.js`
- `src/shared/auth/platformAdmin.js`
- `src/shared/auth/provisioning.js` — `firebase/app`, `firebase/auth`, and
  `firebase/firestore`
- `src/shared/crypto/backfill.js`
- `src/shared/sam/liveStats.js`
- `src/shared/mobile/useAlertFeed.jsx`
- `src/shared/firebase.js` — client bootstrap. The Firebase deployment keeps
  it. Path 3 replaces its role. It is not wrapped.

### Auth, no Firestore import

- `src/shared/auth/AuthContext.jsx`
- `src/shared/auth/mfa.js`
- `src/pages/auth/ForcePasswordChange.jsx`
- `src/shared/auth/sso.js` reads `VITE_SSO_PROVIDERS` and does not itself
  import the SDK. The popup it describes is performed by `AuthContext.jsx`.
  The values are Firebase Identity Platform provider ids (`saml.` / `oidc.`).
  A path 3 auth provider will not accept those ids unchanged.

### Callable client

- `src/shared/functions.js` — dynamic `import('firebase/functions')`. Every
  maintenance, key, export, Metabase, weather, and WhatsApp screen that
  calls a function comes through here.

### Modules that import `firebase/firestore`

Incidents, fire, LOTO, and permit-to-work first. Each module's own library
moves in the same change as any dashboard path that already touches that
collection. The dashboard streams incidents and HIRA assessments through
the seam while these libraries still talk to Firestore. Moving one side
only splits the module across two databases.

- Incidents: `src/modules/incidents/lib/firestore.js`, `incidents.js`,
  `illnesses.js`, `injuries.js`
- Fire: `src/modules/fire/lib/firestore.js`,
  `src/modules/fire/pages/QrLanding.jsx`
- LOTO: `src/modules/loto/services/groupNumbers.js`, `lockClaims.js`,
  `lockPhoto.js`, `locks.js`, `permitActions.js`, `permits.js`,
  `procedures.js`, `shiftSettings.js`, `technicians.js`, and
  `src/modules/loto/pages/PublicProcedure.jsx`
- Permit to work: `src/modules/ptw/lib/firestore.js`
- HIRA: `src/modules/hira/lib/firestore.js`
- The rest: `src/modules/actions/lib/sources.js`,
  `src/modules/audit/services/auditModule.js`, `audits.js`, `capa.js`,
  `findings.js`, `src/modules/cctv/lib/firestore.js`,
  `src/modules/committee/lib/firestore.js`,
  `src/modules/documents/lib/service.js`,
  `src/modules/emergency/lib/firestore.js`,
  `src/modules/inspections/lib/firestore.js`,
  `src/modules/objectives/lib/firestore.js`,
  `src/modules/stakeholder/lib/firestore.js`,
  `src/modules/training/lib/firestore.js`

### Public and field reads

- `src/pages/field/Asset.jsx`
- `src/pages/field/loadAsset.js`
- `src/pages/platform/PlatformLogin.jsx`
- `src/pages/portal/widgets/useWidgetPrefs.js`

Open the anonymous routes only after the token-bound policies exist.

### Call-site traps the contract already names

From `src/shared/data/README.md`, still in force:

- `deleteDoc(d.ref)` becomes `remove(path, row.id)`. The provider returns a
  plain row and no ref.
- Fire's read-only demo guard wraps the raw write primitives at the import
  site. Moving the calls and leaving the guard behind drops the guard.
- Do not normalise timestamps inside the adapter.

## Migration order

1. Keep serving users from the Firebase deployment. Do the path 3 work in
   another environment. Do not move a `v*` tag.
2. Design the auth session so RLS and the presign endpoint can prove `uid`,
   org, role, approval, and the password-change gate. Decide explicitly
   whether SAML/OIDC and TOTP carry over.
3. Translate `firestore.rules` and `storage.rules` into RLS, bucket policy,
   and presign checks. Land the hostile tests before any adapter writes
   real data.
4. Move `orgData.js` and `src/shared/docId/` . The audit log and the
   reference numbers are safety properties, and `createModuleService`
   already depends on the second.
5. Move the module libraries, incidents / fire / LOTO / permit to work
   first, each library together with the dashboard path for that
   collection. Fix `module-kit`'s empty-on-error subscribe in that change.
6. Move `documents/lib/service.js`'s subscribe. The writes are already on
   the seam.
7. Move the public and field routes together with the policies that bind
   an anonymous write to its token.
8. Move the remaining shared readers: entitlements, platform admin,
   integrations, the alert feed, live stats, the crypto backfill,
   provisioning.
9. Rehost the "before cutover" jobs, especially `getDataKeys`,
   `deleteOrgFile`, subject export, retention, and the jobs that withdraw
   stale permit and LOTO mirrors.
10. Register the adapter in `DRIVERS`, point the contract assertions in
    `adapters/memory.test.js` at it (that file says they should hold for
    any other adapter), and remove the name from `RESERVED_DATA_DRIVERS`.
    Then set `VITE_DATA_DRIVER` in that environment's build.
11. Migrate data, sealed fields included, without changing the timestamp
    shape. Read `docs/DATA-RIGHTS.md` §2 before any search for a person.

`VITE_STORAGE_DRIVER=s3` may land earlier, as a file-store swap, under the
constraints in the file section. It does not unblock the data driver.

## Onboarding an external organization

This is the procedure for the person deploying that organization's
environment. A tenant admin inside the app cannot make this choice, and
the product must not grow a screen that looks like they can.

1. Confirm the environment is leaving Firebase. If it is staying on
   Firebase, stop. Use the private production runbook
   (`docs/PRODUCTION.md`) and `DEPLOYMENT.md`.
2. Write "path 3" into that environment's deploy config. Public flags in
   CI. Credentials in the secret manager or a gitignored env file. Do not
   write a connection string into Firestore or any other client-readable
   store.
3. Provision Postgres and an S3-compatible bucket in the organization's own
   account.
4. Create two database roles. The browser role is the one the future
   adapter will use, and RLS applies to it. The bypass role is for
   migrations and the workers (key release, retention). Its URL is a
   secret. If the host is Supabase, the anon key may ship in the client
   and the service-role key may not. Turn RLS on for every table that
   anon key can see.
5. Host the presign endpoint specified in `adapters/s3.js`. It checks the
   session and the `orgs/<orgId>/` prefix, it holds the S3 secret, and a
   delete re-reads the member's profile.
6. Leave `VITE_DATA_DRIVER` unset or `firestore` until step 10 of the
   migration order. Setting `postgres` or `supabase` now fails the app at
   startup with `UnimplementedDataDriverError`. That failure is the
   control that stops a build writing into Firestore while labelled as
   something else. The error is in the browser console, and the value was
   compiled in, so clearing it means rebuilding.
7. If you set `VITE_STORAGE_DRIVER=s3` before the database has moved, tell
   the organization the files are in their bucket and the records are
   still in Firestore. The presign call still presents a Firebase ID
   token until Auth is replaced. A failed presign still inlines the file
   into the Firestore document.
8. Commission the auth provider. Map its session onto `uid`, org, role,
   and approval. Keep TOTP and SAML/OIDC unless the cut has been written
   down.
9. Do not load production data, and do not point the Firebase seed scripts
   at the new database. They do not speak Postgres.
10. When the remaining-work list is empty and the hostile policy tests
    exist, build that environment with the driver flags and deploy it as
    its own target. Leave the Firebase production tags where they are.

An operator following this today can do steps 1 through 5 and 8 as
infrastructure, and stops at step 6 for the data driver. That is the
correct outcome until the gap list is done.
