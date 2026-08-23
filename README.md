# OHS MS — Occupational Health & Safety Management System

A unified, multi-tenant OHS platform that brings seventeen health-&-safety
domains into one app with a single sign-on, one dashboard and one audit trail.

Built with **Vite + React + Tailwind CSS + Firebase (Auth + Firestore + Storage
+ Cloud Functions)**. UI follows a **claymorphism** design language with
**Emil Kowalski**-style motion and **skeleton loaders** throughout.

## Modules

`src/shared/modules/registry.js` is the single source of truth: it drives the
sidebar, the dashboard grid and route mounting in `App.jsx`. If this table and
that file disagree, the file is right.

| Module | Key | Directory | What it does |
|--------|-----|-----------|--------------|
| Incidents & Investigation | `incidents` | `incidents/` | Report incidents & near-misses, run 5-Why / Fishbone investigations, track CAPA |
| Hazard Identification & Risk Assessment | `hira` | `hira/` | Hazard register with a likelihood × severity risk matrix and controls |
| Inspections | `inspections` | `inspections/` | Scheduled inspections and checklist walkthroughs with findings |
| Internal Audit | `audit` | `audit/` | ISO 45001 audit plans, findings and corrective actions |
| Permit to Work | `ptw` | `ptw/` | Raise, approve and close work permits with QR verification |
| Lockout / Tagout | `loto` | `loto/` | Hazardous energy control procedures and lock/tag records |
| Emergency Equipment Inventory | `equipment` | `fire/` | Extinguishers, AEDs, fire-alarm systems and signages with full inspection lifecycle |
| Mock Drills | `drills` | `fire/` | Fire drills and emergency scenarios with scored checklist reports |
| HSE Committee Meetings | `committee` | `committee/` | Schedule meetings, capture minutes, track actions |
| Training & Certifications | `training` | `training/` | Courses, certifications and expiry alerts |
| Document Library & SDS | `documents` | `documents/` | Versioned policies, SOPs, forms and Safety Data Sheets |
| Emergency Response (FERP) | `emergency` | `emergency/` | FERP contacts, evacuation plans, scenario rescue plans |
| Objectives & Targets | `objectives` | `objectives/` | OH&S KPI scorecard against target at org, region and site level |
| Site Weather Risk | `weather` | `weather/` | Conditions at every site read as occupational risk — heat stress, wind, lightning, UV |
| CCTV Inventory & Health | `cctv` | `cctv/` | Cameras, DVRs and network devices as one chain, so a dead switch reads as one fault |
| Customer Escalations & Legal | `stakeholder` | `stakeholder/` | Escalations and the legal matters they turn into |
| Central Action Tracker | `actions` | `actions/` | Every CAPA and action item across all modules, updated in place |

Two registry keys — `equipment` and `drills` — are both served by
`src/modules/fire/`. That is the one place the registry and the filesystem do
not share a name.

## Architecture

Three deployable units, plus one that is built but not yet deployed:

- **Frontend** (`src/`) — one Vite React SPA. A shared shell (auth, nav,
  dashboard) mounts each module as a lazily-loaded feature area under
  `src/modules/<key>/`. Public unauthenticated routes exist for the QR flows
  (`/qr/:token`, `/permit/:token`, `/p/:id`, `/t/:id/:point`).
- **Cloud Functions** (`functions/`) — its own npm package, deployed to
  `asia-south1`. Custom-claim sync, the data-key service, subject-access export,
  the nightly retention sweep, and the one-time backfills the Maintenance page
  drives. Has its own lockfile, test config and CI job.
- **Security rules** (`firestore.rules`, `storage.rules`) — where tenant
  isolation is actually enforced, with a dedicated emulator-backed test suite.
- **API server** (`server/`) — an Express + firebase-admin service that will
  eventually own the write path (see `server/README.md`). **Nothing deploys it
  yet.** It runs and tests locally, and CI runs its suite, but no traffic
  reaches it.

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
src/
  shared/       firebase · auth · org · audit · crypto · data · storage · ui (clay kit)
                layout · module-kit · docId · modules registry
  pages/        auth/ · admin/ · analytics/ · platform/ · portal/ · Dashboard
  modules/      incidents hira inspections audit ptw loto fire committee training
                documents emergency objectives weather cctv stakeholder actions
functions/      Cloud Functions (own package)
server/         API server, not yet deployed (own package)
tests/          Firestore + Storage rules suite (needs the emulator)
e2e/            Playwright smoke + console sweep
scripts/        seed and one-off ops scripts (.mjs, Node only)
docs/           production runbook, security register, compliance
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
`npm run dev:full`, `npm run test:rules`, the Playwright suite and the API
server's attack tests. Java 17 is what CI uses.

Seed a demo organization with `npm run seed`.

### One-command Docker (optional)

```bash
docker compose up
```

Runs the Vite app and the Firebase Emulator Suite in containers. It does **not**
build `server/`.

### First run

1. **Register organization** — you become the first admin (approved automatically).
2. Teammates **Sign up** and pick your org, then appear as *pending* on
   **Users**, where an admin approves them and assigns a role.
3. Create records in any module. Everything writes to the unified **Audit Log**
   and rolls up onto the **Dashboard**.

## Connecting a real Firebase project

`docs/PRODUCTION.md` is the maintained runbook and covers the parts that bite:
environment files, the order rules must ship in relative to hosting, App Check,
backups, custom domains and the four allowlists, bucket CORS, and the encryption
switch-on. Read §0 before deploying anything.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run dev:full` | Emulators + Vite together |
| `npm run emulators` | Firebase Emulator Suite (needs a JDK) |
| `npm run build` | Production build |
| `npm run seed` | Seed a demo organization into the emulators |
| `npm test` | Unit tests (Vitest, `src/**` only) |
| `npm run test:rules` | Firestore + Storage rules suite (needs a JDK) |
| `npm run platform:grant` | Grant a user platform-operator access |
| `npm run deploy:staging` | Deploy to the staging project |
| `npm run lint` / `npm run format` | Lint / format |

`functions/` and `server/` have their own `npm test`; the root `npm test` does
not reach them, which is why CI runs all three.

## Testing

- **Unit** — colocated `*.test.js(x)` beside the source, weighted towards pure
  logic: risk matrices, RBAC, crypto, the data/storage adapters, CSV and PDF
  export, scheduling, energy sources. Run them with `--no-file-parallelism`; the
  parallel run reports phantom failures.
- **Rules** — `npm run test:rules` spins up the emulator and asserts tenant
  isolation (org A cannot read org B), role-gated writes, medical-record
  confinement and the limits of the anonymous QR write surfaces. These send
  hostile payloads, not well-behaved ones.
- **Functions** — `cd functions && npm test`.
- **API server** — `cd server && npm test` (unit plus an attack suite).
- **End-to-end** — `e2e/` under Playwright, against seeded emulators.
