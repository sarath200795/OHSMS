# OHS MS — Occupational Health & Safety Management System

A unified, multi-tenant OHS platform that brings ten health-&-safety domains into
one app with a single sign-on, one dashboard and one audit trail.

Built with **Vite + React + Tailwind CSS + Firebase (Auth + Firestore)**.
UI follows a **claymorphism** design language with **Emil Kowalski**-style motion and
**skeleton loaders** throughout.

## Modules

| Module | What it does |
|--------|--------------|
| Incidents & Investigation | Report incidents / near-misses, classify severity, track to closure |
| Risk Assessment (HIRA) | Hazard register with a 5×5 likelihood × severity risk matrix |
| Inspections | Scheduled inspections & checklist walkthroughs with findings |
| Internal Audit | ISO 45001 audit plans, findings and corrective actions |
| Permit to Work | Raise, approve and close work permits |
| Lockout / Tagout | Hazardous energy control procedures |
| Fire Marshal | Fire wardens, evacuation drills and muster records |
| HSE Committee | Meeting scheduling, minutes and action tracking |
| Training & Certifications *(new)* | Courses & certs with expiry alerts |
| Documents & SDS *(new)* | Versioned policies, SOPs, forms and Safety Data Sheets |

## Architecture

- **Frontend** — one Vite React SPA. Shared shell (auth, nav, dashboard) mounts each
  module as a lazily-loaded feature area under `src/modules/<key>/`.
- **Backend** — Firebase. Security is enforced by `firestore.rules`; a per-module
  client service layer (`src/shared/module-kit/service.js`) does org-scoped reads/writes.
- **Data** — Cloud Firestore. Every tenant is an organization; all module data lives
  under `/organizations/{orgId}/<collection>` for strict row-level isolation. The
  append-only audit trail is `/organizations/{orgId}/auditLogs`.
- **Auth & RBAC** — Firebase Auth (email/password). Four roles: `admin`, `manager`,
  `member`, `auditor` (`src/shared/auth/permissions.js`). Self-service org onboarding
  with admin approval.

```
src/
  shared/       firebase · auth · org · audit · ui (clay kit) · layout · module-kit · modules registry
  pages/        auth/ · admin/ · Dashboard
  modules/      incidents hira inspections audit ptw loto fire committee training documents
```

## Getting started (local, with emulators — no cloud project needed)

```bash
cp .env.example .env      # demo config + VITE_USE_EMULATORS=true already set
npm install
npm run dev:full          # starts Firebase emulators + Vite together
```

Open http://localhost:5173. The Firebase Emulator UI is at http://localhost:4000.

Prefer two terminals? Run `npm run emulators` and `npm run dev` separately.

### One-command Docker (optional)

```bash
docker compose up
```

Runs the Vite app and the Firebase Emulator Suite in containers.

### First run

1. **Register organization** → you become the first admin (approved automatically).
2. Share the app; teammates **Sign up** and pick your org → they appear as *pending*
   on **Users**, where an admin approves them and assigns a role.
3. Create records in any module — everything writes to the unified **Audit Log** and
   rolls up onto the **Dashboard**.

## Connecting a real Firebase project

Set `VITE_USE_EMULATORS=false` in `.env` and fill in the `VITE_FIREBASE_*` values from
your Firebase console (Project settings → Your apps → Web). Then deploy rules:

```bash
firebase deploy --only firestore:rules,firestore:indexes
npm run build && firebase deploy --only hosting
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run dev:full` | Emulators + Vite together |
| `npm run emulators` | Firebase Emulator Suite |
| `npm run build` | Production build |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:rules` | Firestore security-rules tests |
| `npm run lint` / `npm run format` | Lint / format |

## Testing

- Unit tests cover the risk-matrix scoring and RBAC matrix.
- `npm run test:rules` spins up the Firestore emulator and asserts **tenant isolation**
  (org A cannot read org B) and role-gated writes.
