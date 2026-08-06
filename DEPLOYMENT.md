# WEHS — Deployment Runbook

Target scale: **~5 000 users, 100–200 concurrent.**
Stack: Vite + React SPA on Firebase Hosting, Firestore + Auth + Storage.
File uploads go to Firebase Storage (enable it in console → Storage, then
`firebase deploy --only storage` publishes `storage.rules`); if the bucket is
unreachable the app degrades gracefully to inline data URLs in Firestore.
Storage and database backends are swappable via env — see
`src/shared/data/README.md`.

Deploy to **staging first, always.** Production only after staging passes §6.

---

## 1. Create the Firebase projects (once)

Two projects, so staging never touches live data:

| Alias | Project ID (suggested) |
|---|---|
| staging | `wehs-staging` |
| production | `wehs-prod` |

For **each** project:

1. Firebase console → **Add project**.
2. **Upgrade to the Blaze plan.** The free Spark tier will not carry 5 000 users,
   and Blaze is required for scheduled backups. Blaze still includes the free
   quota — you only pay above it.
3. **Firestore → Create database → Production mode.** Pick the region closest to
   your users (e.g. `asia-south1` for India).
   ⚠️ **The Firestore region is permanent.** Getting this wrong means recreating
   the project.
4. **Authentication → Sign-in method → enable Email/Password.**

## 2. Point the repo at them

Create `.firebaserc` in the repo root (git-ignored — it names your real projects):

```json
{
  "projects": {
    "staging": "wehs-staging",
    "production": "wehs-prod",
    "default": "wehs-staging"
  }
}
```

Then `firebase login` (once per machine).

## 3. Environment

Copy `.env.example` → `.env.production` (git-ignored) and fill in from
Firebase console → **Project settings → Your apps → Web app**:

```
VITE_USE_EMULATORS=false
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=wehs-prod.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=wehs-prod
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
```

These values are public by design (they ship in the JS bundle) — your data is
protected by Firestore rules, not by hiding them. Still keep the file out of git
and inject via CI secrets.

## 4. Deploy — rules and indexes first, then the app

```bash
npm ci
npm run lint          # must be 0 errors
npm test              # 108 tests must pass
npm run test:rules    # 14 security-rules tests (starts its own emulator)

# rules + indexes
firebase deploy --only firestore:rules,firestore:indexes -P staging

# build with production env, then host
npm run build
firebase deploy --only hosting -P staging
```

> **Indexes:** `firestore.indexes.json` defines one composite index
> (`users: orgId + createdAt`). The codebase has no `where + orderBy`
> combinations and no collection-group queries, so that should be all that's
> needed — **but emulators don't enforce composite indexes and production does.**
> Watch the browser console during §6; any missing index appears as an error
> containing a one-click "create index" link. Add it to `firestore.indexes.json`
> and redeploy so it's reproducible.

## 5. Seed the first organization

Seed scripts default to emulators. To target a real project, export the same
`VITE_*` values plus admin credentials, and confirm with `--prod`:

```bash
export VITE_USE_EMULATORS=false
export VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=wehs-staging
export VITE_FIREBASE_AUTH_DOMAIN=wehs-staging.firebaseapp.com
export SEED_ADMIN_EMAIL=you@yourco.com SEED_ADMIN_PASSWORD='…'

node scripts/seed-erp-baseline.mjs --prod
```

Without `--prod` the scripts refuse to run against a real project.

**Order of setup** (first admin is created by signing up in the app, then
promoted to `admin` in the `users` collection from the Firebase console):

1. Sign up in the app → creates `/users/{uid}`; set `role: "admin"`,
   `status: "approved"` and an `orgId` on that document, and create the matching
   `/organizations/{orgId}` doc with `name`.
2. **Org Settings → General:** departments, Safety & Security helpline.
3. **Org Settings → Scope & Granularity:** per-module levels and custom fields.
4. **Sites:** add sites (include latitude/longitude — the FERP "Map nearest"
   feature needs them).
5. **Employees:** add or bulk-upload people.
6. `node scripts/seed-erp-baseline.mjs --prod` → 19 baseline ERP procedures.
7. **Objectives → Targets → "Use recommended defaults"** to create the KPI targets.

> The other `scripts/seed-*.mjs` files are **demo-data generators** (fake
> incidents, 5 000 load-test employees). Never run them against production.

## 6. Verify after each deploy

- Sign in; provision an employee and confirm the forced password-change gate.
- Smoke-test each module; specifically: Objectives scorecard, Emergency Response
  site repository (contacts → FERP plan → rescue plans), Training LMS, Action
  Tracker.
- Open DevTools console and watch for **missing-index** and **permission-denied**
  errors — these are the two failures that appear only in production.
- Firebase console → Firestore → Usage: sanity-check reads after a short soak.

## 7. Running at scale

- **Budget alert** in Google Cloud Billing (start low, e.g. $50/month) — this is
  your safety net against a runaway query.
- **App Check** (reCAPTCHA Enterprise) so only your app can consume the quota.
- **Scheduled Firestore exports** to a GCS bucket for backups
  (`gcloud firestore export`, via Cloud Scheduler).
- Reads are already kept flat by shared ref-counted listeners
  (`subscribeOrgCollection` in `src/shared/org/orgData.js`), pagination and
  bounded live queries. Monitor before optimising further.

## 8. Rollback

Firebase Hosting keeps every release:
**Hosting → Release history → "..." → Rollback** (instant).
Rules and indexes are **not** rolled back with it — redeploy the previous
`firestore.rules` from git if a rules change is at fault.

## 9. CI/CD (optional)

GitHub Actions:
- **on pull request:** `npm ci && npm run lint && npm test && npm run build`
- **on merge to `main`:** the above, then deploy to **staging**
- **promotion to production:** manual approval step

Store the `VITE_FIREBASE_*` values and a `FIREBASE_TOKEN`
(`firebase login:ci`) as repository secrets.
