# WEHS — Deployment

**`docs/PRODUCTION.md` is the runbook.** Environment files, the order rules must
ship in relative to hosting, App Check, backups and the restore drill, staging,
custom domains and the four allowlists, bucket CORS, and the encryption
switch-on all live there. Read §0 before deploying anything.

This file covers only the parts that runbook does not: bringing up the **first
organization** in a fresh project, what to check **after each deploy**, and how
to **roll back**.

Everything about creating projects, `.firebaserc`, environment variables and the
deploy commands themselves has been removed rather than kept in step — it was a
second copy, and it had drifted into describing a two-project layout with a
`staging` alias that does not match the repository.

Deploys happen from CI, not a laptop: merge to `main` ships staging, a `v*` tag
ships production. `PRODUCTION.md` §5 and §5a.

---

## 1. Bring up the first organization

Seed scripts default to the emulators. To target a real project, export the same
`VITE_*` values plus admin credentials, and confirm with `--prod`:

```bash
export VITE_USE_EMULATORS=false
```

```bash
node scripts/seed-erp-baseline.mjs --prod
```

Without `--prod` the scripts refuse to run against a real project.

The first admin is created by signing up in the app and then promoted from the
Firebase console — there is no bootstrap script for it, deliberately, because a
script that can mint an approved admin is a script that can mint one later.

1. Sign up in the app. That creates `/users/{uid}`. In the console set
   `role: "admin"`, `status: "approved"` and an `orgId` on that document, and
   create the matching `/organizations/{orgId}` document with a `name`.
2. **Org Settings → General** — departments, Safety & Security helpline.
3. **Org Settings → Scope & Granularity** — per-module levels and custom fields.
4. **Sites** — add sites, **including latitude and longitude**. The FERP "Map
   nearest" feature has nothing to work with without them.
5. **Employees** — add or bulk-upload people.
6. `node scripts/seed-erp-baseline.mjs --prod` — 19 baseline ERP procedures.
7. **Objectives → Targets → "Use recommended defaults"** to create KPI targets.

> Every other `scripts/seed-*.mjs` file is a **demo-data generator** — fake
> incidents, 5 000 load-test employees. Never run one against production.

## 2. Verify after each deploy

- Sign in; provision an employee and confirm the forced password-change gate.
- Smoke-test each module, specifically: Objectives scorecard, Emergency Response
  site repository (contacts → FERP plan → rescue plans), Training, Action Tracker.
- Open DevTools and watch for **missing-index** and **permission-denied** errors.
  These are the two failures that appear only in production — the emulator has
  neither constraint in the same form.
- Firebase console → Firestore → Usage: sanity-check reads after a short soak.

## 3. Rollback

Firebase Hosting keeps every release:
**Hosting → Release history → "..." → Rollback** (instant).

**Rules and indexes do not roll back with it.** If a rules change is at fault,
redeploy the previous `firestore.rules` from git explicitly. This matters more
than it sounds, because the deploy order ships rules *before* hosting — so a bad
rules change is already live when the hosting rollback finishes, and the app
will look broken in a way the release history does not explain.

## 4. One thing to set up once, at scale

A **budget alert** in Google Cloud Billing — start low, e.g. $50/month. It is the
safety net against a runaway query, and it is the only item in this file that
protects you from your own code rather than from an attacker.

Reads are already kept flat by shared ref-counted listeners
(`subscribeOrgCollection` in `src/shared/org/orgData.js`), pagination and bounded
live queries. Monitor before optimising further — though note `SECURITY.md` S-04:
some collection listeners are still uncapped.

---

## 5. Staging functions deploy needs `iam.serviceAccounts.actAs`

This is the failure `.github/workflows/deploy-staging.yml` hits on the
**Deploy functions** step, and it is already named in two places in this
repository:

- `scripts/deploy-staging.mjs` (header): CI cannot deploy staging functions
  today because the staging service account is refused
  `iam.serviceAccounts.actAs` on the App Engine default / runtime service
  account, which blocks that step and therefore the whole workflow. The laptop
  script exists because of that, and it makes functions **opt-in**
  (`--functions`) so a hand deploy can still ship rules and hosting.
- `docs/ENTERPRISE-READINESS.md` scorecard: staging pipeline failing on
  functions deploy (IAM) since 2026-08-29.

Nothing in this repository can grant that IAM role. The GitHub secret
`STAGING_FIREBASE_SERVICE_ACCOUNT` is a JSON key; Cloud Functions deploy
impersonates the project's runtime service account, and that impersonation is
`iam.serviceAccounts.actAs` on the runtime account, in GCP, for the identity
in the secret. Until that grant exists, either:

1. **Grant `iam.serviceAccounts.actAs`** on the staging runtime service
   account to the CI deployer, then re-run the workflow, or
2. **Stop deploying functions from staging CI** until then — which is what
   `npm run deploy:staging` already does (functions are skipped unless
   `--functions` is passed).

This file does not claim either has been done. A functions deploy error that
names `iam.serviceAccounts.actAs` is this gap, not a new one.

## 6. Assignment email

Saving an incident CAPA, an illness corrective action, a mock-drill CAPA or a
training assignment emails the assignee from **info@weehs.org**. That mailbox
already exists (Private Email). The triggers do not use a second mail
service. They are `notifyIncidentAssignment`, `notifyIllnessAssignment`,
`notifyDrillAssignment` and `notifyTrainingAssignment`. The write does not
wait on the mail.

Defaults, already set in code:

- From: `WEEHS <info@weehs.org>`
- SMTP: `mail.privateemail.com` port 465, username `info@weehs.org`
- Links: `https://suite.weehs.org` plus the in-app path (`/incidents/{id}`,
  `/incidents/illness/{id}`, `/mock-drills`, `/training/my`)

The one value that is not in the repo is the mailbox password. It has to
exist as a secret before the triggers will deploy. A placeholder is enough
to deploy; nothing is sent until the value is the real password, and each
skipped assignment is logged as an error rather than recorded as delivered.

```bash
firebase functions:secrets:set SMTP_PASS
```

Use the password for info@weehs.org. Do not put it in `functions/.env`. A
mail credential in the Cloud Run environment in cleartext is the finding
recorded as LOW-13.

Production CI (`.github/workflows/deploy.yml`, and the staging workflow the
same way) writes the non-secret mail defaults into `functions/.env.<project>`
before it deploys functions. String params have defaults in code, but a
non-interactive deploy still stops until those values are in that file. CI
expects `DATA_KEY_MASTER` and `SMTP_PASS` in Secret Manager. If `SMTP_PASS`
is missing, CI creates it from the `SMTP_PASS` GitHub secret when that is
set, and otherwise as the placeholder `UNSET-PLACEHOLDER`. CI does not create
or replace `DATA_KEY_MASTER`. Repository variables `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `MAIL_FROM` and `APP_ORIGIN` override those CI defaults when set.

Local emulators read the password from `functions/.secret.local` (one line,
`SMTP_PASS=...`). Without that file the trigger logs the same configuration
error and returns.

`functions/.env` can override the defaults (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `MAIL_FROM`, `APP_ORIGIN`). Leaving them unset keeps
info@weehs.org. See `functions/.env.example`.
