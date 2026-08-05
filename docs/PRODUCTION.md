# Production runbook

What the code already does, and the console/CLI steps only a project owner can
perform. Work top to bottom; each section says how to verify it worked.

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

The code now uploads new training-content files to Cloud Storage (org-scoped,
`storage.rules` enforces the same tenancy as Firestore) and falls back to the
old inline base64 if the bucket is unavailable — so nothing breaks before this
step, files just stay on the old path.

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
