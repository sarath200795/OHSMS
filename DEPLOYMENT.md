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
