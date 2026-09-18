# OHS MS — Occupational Health & Safety Management System

A unified, multi-tenant OHS platform that brings seventeen health-&-safety
domains into one app with a single sign-on, one dashboard and one audit trail.

Built with **Vite + React + Tailwind CSS + Firebase (Auth + Firestore + Storage

- Cloud Functions)**. UI follows a **claymorphism** design language with
  **Emil Kowalski**-style motion and **skeleton loaders** throughout.

## Modules

`src/shared/modules/registry.js` is the single source of truth: it drives the
sidebar, the dashboard grid and route mounting in `App.jsx`. If this table and
that file disagree, the file is right.

| Module                                  | Key           | Directory      | What it does                                                                          |
| --------------------------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------- |
| Incidents & Investigation               | `incidents`   | `incidents/`   | Report incidents & near-misses, run 5-Why / Fishbone investigations, track CAPA       |
| Hazard Identification & Risk Assessment | `hira`        | `hira/`        | Hazard register with a likelihood × severity risk matrix and controls                 |
| Inspections                             | `inspections` | `inspections/` | Scheduled inspections and checklist walkthroughs with findings                        |
| Internal Audit                          | `audit`       | `audit/`       | ISO 45001 audit plans, findings and corrective actions                                |
| Permit to Work                          | `ptw`         | `ptw/`         | Raise, approve and close work permits with QR verification                            |
| Lockout / Tagout                        | `loto`        | `loto/`        | Hazardous energy control procedures and lock/tag records                              |
| Emergency Equipment Inventory           | `equipment`   | `fire/`        | Extinguishers, AEDs, fire-alarm systems and signages with full inspection lifecycle   |
| Mock Drills                             | `drills`      | `fire/`        | Fire drills and emergency scenarios with scored checklist reports                     |
| HSE Committee Meetings                  | `committee`   | `committee/`   | Schedule meetings, capture minutes, track actions                                     |
| Training & Certifications               | `training`    | `training/`    | Courses, certifications and expiry alerts                                             |
| Document Library & SDS                  | `documents`   | `documents/`   | Versioned policies, SOPs, forms and Safety Data Sheets                                |
| Emergency Response (FERP)               | `emergency`   | `emergency/`   | FERP contacts, evacuation plans, scenario rescue plans                                |
| Objectives & Targets                    | `objectives`  | `objectives/`  | OH&S KPI scorecard against target at org, region and site level                       |
| Site Weather Risk                       | `weather`     | `weather/`     | Conditions at every site read as occupational risk — heat stress, wind, lightning, UV |
| CCTV Inventory & Health                 | `cctv`        | `cctv/`        | Cameras, DVRs and network devices as one chain, so a dead switch reads as one fault   |
| Customer Escalations & Legal            | `stakeholder` | `stakeholder/` | Escalations and the legal matters they turn into                                      |
| Central Action Tracker                  | `actions`     | `actions/`     | Every CAPA and action item across all modules, updated in place                       |

Two registry keys — `equipment` and `drills` — are both served by
`src/modules/fire/`. That is the one place the registry and the filesystem do
not share a name.

## Architecture

Deployable frontends live under `apps/`: a **shell** (auth, org onboarding,
dashboard, admin, platform console, module launcher) and **one Vite app per
operating module**. They share `src/shared/` and the **same** Firebase project
/ Firestore database. See `docs/APPS.md`.

The public marketing site is a separate repo,
[weehs-landing](https://github.com/sarath200795/weehs-landing). All six product
cards open **this origin** (`https://suite.weehs.org`). OHS Suite hits the
shell (`/login`, `/register-org`, `/signup`); Fire Marshal, HECP LOTO, Permit
to Work, Internal Audit and HIRA deep-link their module prefixes. The URL
contract is in `docs/APPS.md`.

- **Combined SPA** (`npm run dev`) — `src/main.jsx` still mounts every module
  in one process. Playwright and day-to-day work use this.
- **Cloud Functions** (`functions/`) — its own npm package. Custom-claim sync,
  the data-key service, subject-access export, the nightly retention sweep, and
  the one-time backfills the Maintenance page drives.
- **Security rules** (`firestore.rules`, `storage.rules`) — where tenant
  isolation and module entitlements are actually enforced.

There used to be a fourth, `server/` — an Express + firebase-admin service
intended to take over the write path. It served no traffic, nothing deployed it,
and it carried a hand-maintained second copy of eight `firestore.rules` role
helpers that could drift silently. It was removed rather than maintained; the
history has it if the write-path migration is ever revived.

Other cross-cutting pieces:

- **Data** — Cloud Firestore. Every tenant is an organization; module data lives
  under `/organizations/{orgId}/<collection>` for row-level isolation. The
  append-only audit trail is `/organizations/{orgId}/auditLogs`.
- **Auth & RBAC** — Firebase Auth with SAML/OIDC SSO and TOTP two-factor. Four
  roles — `admin`, `manager`, `member`, `auditor`
  (`src/shared/auth/permissions.js`) — plus site scoping. Self-service org
  onboarding with admin approval.
- **Application-layer encryption** (`src/shared/crypto/`) — envelope encryption
  over the fields named in `policy.js`, with an escrowed master key held in
  Secret Manager. Gated by `VITE_ENCRYPTION`; see `docs/PRODUCTION.md` §11.
- **Portability seams** — `src/shared/data/` (database) and
  `src/shared/storage/` (files) sit behind documented adapter contracts selected
  by `VITE_DATA_DRIVER` / `VITE_STORAGE_DRIVER`. See
  `src/shared/data/README.md`.
- **Platform console** — a separate application at `/platform` with its own
  sign-in, deciding which modules each organization may use. See
  `docs/PLATFORM-CONSOLE.md`.

```
apps/           shell + one Vite app per operating module (see docs/APPS.md)
src/
  shared/       firebase · auth · org · audit · crypto · data · storage · ui (clay kit)
                layout · module-kit · docId · modules registry · entitlements / placeholders
  pages/        auth/ · admin/ · analytics/ · platform/ · portal/ · Dashboard
  modules/      incidents hira inspections audit ptw loto fire committee training
                documents emergency objectives weather cctv stakeholder actions
  app/          bootstrap, AppLink, ModuleApp
functions/      Cloud Functions (own package)
tests/          Firestore + Storage rules suite (needs the emulator)
e2e/            Playwright smoke, accessibility (axe) + console sweep
scripts/        seed, app generation, and one-off ops scripts (.mjs, Node only)
docs/           production runbook, security register, compliance, apps
```

## Getting started (local, with emulators — no cloud project needed)

Copy the example environment file, which already points at the emulators:

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run dev:full
```

Open http://localhost:5173. The Firebase Emulator UI is at http://localhost:4000.
Prefer two terminals? Run `npm run emulators` and `npm run dev` separately.

**A JDK is required** for anything that starts the Firestore, Auth or Storage
emulator — they are JVM processes. That covers `npm run emulators`,
`npm run dev:full`, `npm run test:rules` and the Playwright suite. Java 17 is
what CI uses.

Seed a demo organization with `npm run seed`.

### One-command Docker (optional)

```bash
docker compose up
```

Runs the Vite app and the Firebase Emulator Suite in containers.

### First run

1. **Seed the demo org** (`npm run seed`) and sign in as `admin@acme.test` /
   `password123`. The seed does **not** write an entitlement document, so the
   demo tenant still has the full product — the same default every organization
   had before placeholders existed.
2. Or **Register organization** from the UI. That path writes a placeholder for
   every module (`inactive`). Nothing is usable until a platform operator
   assigns a suite or activates modules on `/platform`. See `docs/APPS.md`.
3. Teammates **Sign up** and pick your org, then appear as _pending_ on
   **Users**, where an admin approves them and assigns a role.
4. Create records in any **activated** module. Everything writes to the unified
   **Audit Log** and rolls up onto the **Dashboard**.

## Connecting a real Firebase project

`docs/PRODUCTION.md` is the maintained runbook and covers the parts that bite:
environment files, the order rules must ship in relative to hosting, App Check,
backups, custom domains and the four allowlists, bucket CORS, and the encryption
switch-on. Read §0 before deploying anything.

## Scripts

| Script                            | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `npm run dev`                     | Combined SPA (what e2e uses)                                |
| `npm run dev:apps`                | Shell + every module app, one origin (see `docs/APPS.md`)   |
| `npm run dev:module`              | One module app on :5174 (`npm run dev:module -- incidents`) |
| `npm run dev:full`                | Emulators + combined SPA together                           |
| `npm run emulators`               | Firebase Emulator Suite (needs a JDK)                       |
| `npm run build`                   | Shell + per-module production apps                          |
| `npm run build:combined`          | In-process SPA, for comparison                              |
| `npm run seed`                    | Seed a demo organization into the emulators                 |
| `npm test`                        | Unit tests (Vitest, `src/**` only)                          |
| `npm run test:rules`              | Firestore + Storage rules suite (needs a JDK)               |
| `npm run platform:grant`          | Grant a user platform-operator access                       |
| `npm run deploy:staging`          | Deploy to the staging project                               |
| `npm run lint` / `npm run format` | Lint / format                                               |

`functions/` has its own `npm test`; the root `npm test` does not reach it,
which is why CI runs both.

## Testing

- **Unit** — colocated `*.test.js(x)` beside the source, weighted towards pure
  logic: risk matrices, RBAC, crypto, the data/storage adapters, CSV and PDF
  export, scheduling, energy sources. They run in parallel and are stable there;
  DOM tests carry a `// @vitest-environment jsdom` docblock and the default is
  `node`.
- **Rules** — `npm run test:rules` spins up the emulator and asserts tenant
  isolation (org A cannot read org B), role-gated writes, medical-record
  confinement and the limits of the anonymous QR write surfaces. These send
  hostile payloads, not well-behaved ones.
- **Functions** — `cd functions && npm test`.
- **Accessibility** — `e2e/accessibility.spec.js` runs axe against the rendered
  DOM and fails on any serious or critical WCAG 2.1 AA violation. It is the half
  of the gate `eslint-plugin-jsx-a11y` cannot be: this app binds most labels to
  their controls at runtime, which a static rule cannot see.
- **Capped reads** — `e2e/capped-reads.spec.js`, run with `VITE_TEST_READ_CAP`
  set low, asserts that screens totalling a capped collection actually render
  the "these figures are incomplete" notice (portal home is the exception: it
  must not).
- **End-to-end** — `e2e/` under Playwright, against seeded emulators.
