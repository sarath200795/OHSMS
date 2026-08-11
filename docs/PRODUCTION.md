# Production runbook

## 0. Environment files — the footgun that bit us  ⚠️ read before deploying

Vite loads `.env` for **every** mode; `.env.<mode>` overrides only the keys it
names. Any key missing from `.env.production` therefore inherits the demo value
from `.env` — silently, and per-key.

That is how the live site shipped with
`storageBucket=ohsms-demo.appspot.com` while auth and Firestore pointed at the
real project: every upload failed and nothing in the UI said why.

`.env.production` is gitignored (it holds keys), so this list cannot be enforced
by the repo. **Every one of these must be defined explicitly there:**

```
VITE_USE_EMULATORS=false
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=      # firebase apps:sdkconfig web  →  storageBucket
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Verify after any build, before deploying:

```bash
grep -o "ohsms-demo[^\"]*" dist/assets/*.js   # must print nothing
```

The app also checks this itself at startup and logs an error listing any demo
values found in a non-emulator build.

What the code already does, and the console/CLI steps only a project owner can
perform. Work top to bottom; each section says how to verify it worked.

## 0b. Deploy order: rules BEFORE hosting  ⚠️ or public QR reporting breaks

The public write surfaces are validated by `firestore.rules` with `hasOnly()`,
so the rules enumerate the exact field set the client sends. That makes the two
artifacts a matched pair, and it makes the deploy order load-bearing:

- **A new client against old rules fails closed.** When the QR defect report
  started carrying a `token`, the old `hasOnly(['extId','defectType','createdAt'])`
  on `/defectLocks` rejected the extra key — every public defect report was
  refused, and because `createReport` maps `permission-denied` to the duplicate
  message, the reporter was told the fault was "already under progress". A
  silent break on the one surface where the reporter has no way to escalate.
- **An old client against new rules also fails**, for the mirror-image reason:
  the public branch now requires proof of scan and an already-loaded tab has no
  `token` to send. That window is small — a QR scan loads the page fresh — but
  it is real.

So: `firebase deploy --only firestore:rules` first, confirm, then
`--only hosting`. Never the single combined command for a release that changes
both, and never hosting first.

```bash
npx firebase deploy --only firestore:rules --project weehs-4eb28
```

Verify a denied write before shipping the client (this creates no data):

```bash
curl -s -X POST "https://firestore.googleapis.com/v1/projects/weehs-4eb28/databases/(default)/documents/organizations/ORGID/reports" -H "Content-Type: application/json" -d '{"fields":{"source":{"stringValue":"qr"},"kind":{"stringValue":"defect"},"extId":{"stringValue":"x"},"approvalStatus":{"stringValue":"pending"},"reportedBy":{"stringValue":"public"},"note":{"stringValue":""}}}'
```

It must return `PERMISSION_DENIED` — no token, no write.

## 0c. Site-scoped documents: BACKFILL BEFORE RULES  ⚠️ or the library goes dark

Site-level documents are restricted to people whose access reaches that site.
The rule reads `visibility` off each document **directly** — `resource.data.visibility`,
not `resource.data.get('visibility', 'all')` — and that is load-bearing rather
than stylistic.

`read` covers `get` and `list`. For a list, Firestore has to prove from the rule
alone that the query cannot return a document the rule would refuse, and it can
only do that when the condition names a field directly. Written defensively —
`.get(field, default)`, `!('visibility' in resource.data) || …`, or
`keys().hasAny([…])` — the condition stops constraining the query: the
single-document `get` is still refused, but an unfiltered **list returns the
whole collection, contents and all**. All three forms were checked against the
emulator. Per-document tests pass in every one of them, which is how this would
have shipped; `tests/documents.rules.test.js` lists as well as gets.

The price of direct access is that reading a field that is not there errors, and
an erroring rule denies. A document with no `visibility` is therefore readable by
nobody but admins, managers and auditors. So, in this order:

```bash
node scripts/backfill-document-visibility.mjs --dry-run
```

```bash
node scripts/backfill-document-visibility.mjs
```

Then, and only then:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project weehs-4eb28
```

The script is idempotent — it only touches documents with no `visibility` yet,
and stamps every one of them `all`, which is exactly the access they have today.
It narrows nothing; it records what is already true so the rule can read it. Run
it against **every** org in the project, not just the first: it reads the org off
the signed-in account, so one run covers one tenant.

The indexes ship with the rules because a member's library is fetched as
`visibility == 'all'` plus `siteId in (…)`, and both need a composite index with
`createdAt`. Without them a member sees an empty library and a console error.

## 1. App Check — protect the public write surfaces  ⚠️ console required

The app has three deliberately unauthenticated write surfaces (equipment defect
reports via QR, defect locks, permit observations via QR). The client is fully
wired; without the steps below it ships no tokens and nothing is enforced.

1. Firebase console → **App Check** → register the web app → provider
   **reCAPTCHA v3** → copy the site key.
2. Put the key in the production env: `VITE_APPCHECK_SITE_KEY=<key>` (locally in
   `.env.production`, in CI as a repo variable), redeploy.
3. Watch console → App Check → **Metrics** until verified-request share is ~100%
   (give real users a day or two).
4. Only then: App Check → APIs → **Cloud Firestore → Enforce**. Enforcing before
   the metric is clean logs out every stale client at once.
5. For local dev against the enforced project: console → App Check → your app →
   **Manage debug tokens** → create one → set `VITE_APPCHECK_DEBUG_TOKEN`.

Verify: with enforcement on, `curl` against the Firestore REST API without a
token gets `PERMISSION_DENIED`; the app keeps working.

## 1b. Single sign-on and two-factor  ⚠️ console + Identity Platform

The app code for both is in place. Both are off until the console side is done,
and **the order matters for MFA** — see the warning below.

### Two-factor (TOTP)

TOTP rather than SMS: codes work with no signal, which is the difference between
a second factor and a lockout on a plant floor, and SMS costs money per login
and falls to SIM swap.

1. Firebase console → **Authentication → Sign-in method → Advanced → SMS/TOTP
   multi-factor** → enable **TOTP**. This requires Identity Platform (the paid
   tier of Firebase Auth).
2. Users turn it on themselves at **/security**, reachable from the account menu.
   Enrolment is deliberately self-service: the secret must reach that person's
   authenticator and nobody else's, so a flow where an admin sees it defeats the
   point.

⚠️ **Do not enforce MFA before this code is deployed.** When a second factor is
required, Firebase does not return a user — it throws
`auth/multi-factor-auth-required` carrying a resolver, and sign-in only
completes by answering it. An app that does not catch that shows a generic
error and the account is unreachable. Enforcing MFA against a client without the
challenge handling locks people out rather than protecting them. That handling
now exists (`src/shared/auth/mfa.js`, wired through `AuthContext.login`), so as
long as the client is deployed first, enabling it is safe.

⚠️ **Enrolment requires a verified email.** Firebase refuses to add a factor to
an unverified address, and only says so when you try. This app never sent
verification emails before — accounts come from signup or admin provisioning —
so the security screen detects it and offers to send one. Expect the first
person to enrol to verify their address first.

### Single sign-on (SAML / OIDC)

1. Firebase console → **Authentication → Sign-in method → Add new provider** →
   SAML or OIDC. Also Identity Platform. Note the provider id it gives you: it
   always begins `saml.` or `oidc.`.
2. Add that id to the client build:

```bash
VITE_SSO_PROVIDERS="saml.acme:Acme SSO,oidc.okta:Okta"
```

   Comma-separated, each `providerId:Button label`; the label is optional. Set it
   as a repository variable so CI builds carry it (`.github/workflows/deploy.yml`
   passes `VITE_*` through).
3. Add the production domain to **Authorised domains** in the same console
   screen, or sign-in returns `auth/unauthorized-domain`.

With the variable unset there are no SSO buttons and the login page is exactly
what it was — nothing to undo for deployments that do not use it. A malformed
entry is dropped with a console error rather than throwing, because a bad value
here must not take down the login page: without the password form there is no
way back in.

Sign-in tries a popup first and falls back to a full redirect when the browser
blocks it — common on managed corporate devices, which is exactly the fleet most
likely to have SSO.

**What SSO does not do on its own:** a federated user still needs a `/users`
profile before they can see anything, and the rules still put a self-created one
in `pending` until an admin approves it. SSO replaces the password, not the
approval step.

## 2. Error monitoring  ⚠️ account required

The root ErrorBoundary and global handlers are live and log to the console
today. To ship errors somewhere useful:

1. Create a (free-tier) Sentry project → copy the DSN.
2. Set `VITE_SENTRY_DSN=<dsn>` in the production env, redeploy.

The SDK is dynamically imported — builds without the DSN carry zero Sentry
bytes. Verify in a deployed build by triggering any error and checking the
Sentry inbox. In dev, `?__crash=1` on any URL exercises the boundary itself.

## 3. Backups  ⚠️ CLI/console required — do this before real data exists

Firestore has no undo. Two layers, both needed:

**Point-in-time recovery** (7-day rewind for fat-fingered writes):

```bash
gcloud firestore databases update --database="(default)" \
  --enable-pitr --project=weehs-4eb28
```

**Scheduled exports** (survives project-level disasters; needs a bucket):

```bash
gsutil mb -l asia-south1 gs://weehs-4eb28-backups
gcloud firestore backups schedules create --database="(default)" \
  --recurrence=daily --retention=14d --project=weehs-4eb28
```

Verify: `gcloud firestore backups list --project=weehs-4eb28` shows entries
after the first cycle. Restore drill: restore one backup into a scratch
database once, so the first restore you ever do is not the one that matters.

## 4. Cloud Storage for files  ⚠️ one console click

The code now uploads new training-content files to Cloud Storage under an
org-scoped path, and falls back to the old inline base64 if the bucket is
unavailable — so nothing breaks before this step, files just stay on the old
path.

⚠️ **Storage does NOT enforce the same tenancy as Firestore.** This section used
to claim it did, which was wrong and is the more dangerous kind of wrong: it
told whoever read it that a boundary existed. `storage.rules` binds nothing to
an org — the `{orgId}` path segment is captured and never checked, because doing
so needs either cross-service Firestore reads or an `orgId` custom claim on the
token, and neither is in place yet. Concretely, any signed-in user of any
tenant can read and delete any other tenant's uploaded files if they know the
path. Uploads are at least safe from being overwritten in place (`update` is
denied outright and every upload lands on a random path).

Closing it needs the custom claim, which needs the Admin SDK — i.e. the
`functions/` tier. The stronger ruleset is already written at the bottom of
`storage.rules`, commented, ready to swap in once claims exist. Until then,
treat file storage as org-scoped by convention only, and do not put anything in
it that would be materially worse in a competitor's hands than the Firestore
records already are.

1. Firebase console → **Storage** → Get started (default bucket, production
   rules — the repo's `storage.rules` deploys over them).
2. `npx firebase deploy --only storage`.

Verify: add a file to a training course; the stored course document should gain
`content[].path` starting with `orgs/…` instead of a multi-hundred-KB `dataUrl`.

Remaining inline-file call sites to migrate onto `shared/storage` the same way
(each is the same ~20-line pattern as `Courses.jsx`): incident photos, illness
attachments, permit documents, drill evidence, LOTO procedure photos, course
thumbnails, quotation uploads.

## 5. Deploys from CI, and staging  ⚠️ secrets required

`.github/workflows/deploy.yml` deploys hosting + Firestore rules + storage
rules on version tags (`v1.0.0`) after re-running lint and tests. It skips
politely until credentials exist:

1. Console → Project settings → Service accounts → **Generate new private
   key** → GitHub repo → Settings → Secrets → `FIREBASE_SERVICE_ACCOUNT`.
2. Repo → Settings → Variables: the `VITE_FIREBASE_*` values (plus
   `VITE_APPCHECK_SITE_KEY` / `VITE_SENTRY_DSN` once you have them).
3. Release: `git tag v1.0.0 && git push --tags`.

Staging: create a second Firebase project (`weehs-staging`), repeat the above
in a `deploy-staging.yml` copy triggered on pushes to `main`, and stop using
`firebase deploy` from a laptop for anything but emergencies.

## Known gaps this runbook does not cover

- Composite Firestore indexes are unaudited beyond the one defined; test each
  module against production-sized data and capture the index-creation links.
- Admin accounts have no MFA (email/password only).
- LOTO's collections live outside the org tenancy model.
- Three dependency advisories are knowingly open, so `npm audit` is not expected
  to come back clean. Check new findings against this list rather than assuming
  the noise is the usual noise:
  - **jspdf 2.5.2** (rated critical) and **jspdf-autotable 3.8.4**. The fixes are
    two major versions up on each and need a migration. Most of the advisories —
    `AcroForm`/`addJS` arbitrary JS execution, HTML injection, path traversal —
    are unreachable because the app never calls those APIs. What is reachable is
    `addImage` in `src/modules/loto/utils/pdf.js`, which takes user-uploaded
    procedure photos: a crafted BMP/GIF hangs the tab of whoever generates the
    PDF. Client-side DoS by an authenticated member, not disclosure.
  - **xlsx 0.18.5**, no fix on npm — SheetJS publishes to its own CDN now. The
    prototype-pollution sink was tested and is unreachable; the ReDoS is, but
    only against a workbook the user chose to open in their own browser.
  - `undici` is pinned in `overrides` because Firebase holds it at a vulnerable
    version. It never reaches the browser bundle, so the pin keeps `npm audit`
    readable rather than closing a hole in the shipped app.
