# Frontend apps — shell + operating modules, one Firebase project

The product is no longer one SPA that mounts every module. It is a **shell**
(sign-in, org onboarding, portal, admin, platform console) plus **one Vite app
per operating module**, all talking to the **same** Firebase Auth / Firestore /
Storage project. There is no per-module database.

`src/shared/` is the shared package: auth, org context, UI kit, data adapters,
permissions, the registry, and entitlements. Feature code stays in
`src/modules/<key>/` and is imported by that module's app. It is not deleted
or rewritten.

## Layout

```
apps/
  shell/           auth, portal, dashboard, admin, platform, module launcher
  incidents/       …one folder per registry key
  …                equipment and drills both import src/modules/fire/
src/
  shared/          the shared package every app imports
  modules/         operating-module feature code
  pages/           shell screens
  app/             bootstrap, AppLink, ModuleApp
  App.jsx          combined (and shell) routes
  main.jsx         combined entry used by `npm run dev`
```

`src/shared/modules/apps.js` is the deployable-app list (keys and URL prefixes).
`src/shared/modules/registry.js` remains the product list (labels, icons, tiles).
A unit test fails if those two drift.

## One Firebase project

Every app initialises the same config from `src/shared/firebase.js` (`VITE_FIREBASE_*`).
Module data is still `/organizations/{orgId}/…`. Entitlements are still
`/moduleEntitlements/{orgId}`.

## Placeholders and subscription

On **organization create**, the same batch that writes the org also writes
`/moduleEntitlements/{orgId}` with **every registry key (and every add-on) set
to `false`**. Those rows are placeholders. They exist even for modules the
org has not subscribed to.

A platform operator activates modules on `/platform` (Module access), either
**per module** or by assigning a **suite** (Core, Operations, Fire & Emergency,
Compliance, Full). Suites are defined in `src/shared/modules/suites.js` — they
group registry keys; they are not a second database. Assigning a suite flips
those placeholders to active and does not turn other modules off, so a second
suite or individual switches are à-la-carte extras. Activating later does not
recreate the org. Firestore rules refuse a founder activating anything
themselves; they may only seed the all-off document.

`/moduleEntitlements/{orgId}` is still the one document:

| Field     | Meaning                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ |
| `modules` | Map of every registry key (and add-on) to `true`/`false`. This is what the UI and rules enforce. |
| `suite`   | The assigned bundle (`core`, `operations`, `fire`, `compliance`, `full`), `custom`, or `''`.     |

`suite` is a label the console records. It does not authorize anything on its
own — a forged `suite: 'full'` with every module `false` would still be a
placeholder org.

Organizations registered **before** this existed still have no entitlement
document, which still means the full product. That default is unchanged so
shipping this took nothing away from anyone.

Inactive modules:

- show as locked tiles on the portal and dashboard
- `ModuleGate` refuses the route
- `moduleOn` in `firestore.rules` refuses reads and writes to that module's
  collections (deletes remain possible so a tenant can still remove its data)

## Running locally against emulators

A JDK is required for the emulators. Copy `.env.example` to `.env` first.

### Everyday (combined SPA — what e2e uses)

```bash
npm run dev:full
```

Open http://localhost:5173. This is `src/main.jsx` mounting every module in
one process, the same composition as before. Use it for day-to-day work and
for Playwright.

### Production-like split (recommended for the multi-app layout)

```bash
npm run emulators     # terminal 1
npm run dev:apps      # terminal 2
```

One origin, one Auth session. The Vite middleware sends `/incidents/**` to the
incidents app, `/hira/**` to HIRA, everything else to the shell. Same rewrite
shape as Firebase Hosting.

### Shell + one module on two ports

```bash
npm run emulators
npm run dev:shell                 # :5173
npm run dev:module -- incidents   # :5174
```

Different ports are different origins, so Firebase Auth is **not** shared —
you will sign in again on the module app. Prefer `npm run dev:apps` unless you
are debugging a single module's bundle.

## Building

```bash
npm run build             # shell + every module app → dist/ (what hosting deploys)
npm run build:combined    # the in-process SPA, for comparison
```

Hosting rewrites in `firebase.json` send each module prefix to
`/apps/<key>/index.html`, and everything else to `/index.html` (the shell,
copied there at the end of the apps build).

After adding a registry module, run `node scripts/generate-apps.mjs` so
`apps/<key>/` exists, add its key to `apps.js`, put it in exactly one packaging
suite in `suites.js`, and add it to the placeholder check in `firestore.rules`
(`modulesArePlaceholders`).

## Handoff from weehs-landing

The public front door is [weehs-landing](https://github.com/sarath200795/weehs-landing),
not this repository. **All six product cards** open this origin
(`https://suite.weehs.org`). The five standalone Vercel apps are no longer
landing destinations.

- **OHS Suite** opens the **shell** (`/login`, `/register-org`, `/signup`).
- **Fire Marshal, HECP LOTO, Online Permit to Work, ISO 45001 Auditor, HIRA**
  deep-link the matching **module app**. An unauthenticated visit hits that
  prefix, `ProtectedRoute` bounces to `/login?next=…` on the shell, and after
  sign-in the browser resumes the prefix. If the org is not entitled,
  `ModuleGate` shows the locked placeholder (org create still seeds every
  module as inactive; suites / à-la-carte on `/platform` activate access).

The contract lives in `src/shared/modules/landing.js`. A unit test fails if a
product’s key or prefix drifts from the registry, if hosting stops rewriting
that prefix to the module app, or if the shell auth paths move.

### Public URLs landing should set

Every product’s `domain` / `hosting` is `https://suite.weehs.org`. Per-product
`routes` (what landing’s `appLink` appends):

| Landing product       | Registry key | Open app (`routes.login`) | Register (`routes.register`)      | Join (`routes.join`)        |
| --------------------- | ------------ | ------------------------- | --------------------------------- | --------------------------- |
| Fire Marshal          | `equipment`  | `/equipment`              | `/register-org?next=%2Fequipment` | `/signup?next=%2Fequipment` |
| HECP LOTO             | `loto`       | `/loto`                   | `/register-org?next=%2Floto`      | `/signup?next=%2Floto`      |
| Online Permit to Work | `ptw`        | `/permits`                | `/register-org?next=%2Fpermits`   | `/signup?next=%2Fpermits`   |
| ISO 45001 Auditor     | `audit`      | `/audit`                  | `/register-org?next=%2Faudit`     | `/signup?next=%2Faudit`     |
| HIRA                  | `hira`       | `/hira`                   | `/register-org?next=%2Fhira`      | `/signup?next=%2Fhira`      |
| OHS Suite             | _(shell)_    | `/login`                  | `/register-org`                   | `/signup`                   |

Those Open-app paths are the **deployed prefixes** in `apps.js`, not the
source folder and not always the registry key: Fire Marshal is `/equipment`
(code lives in `src/modules/fire/`), Permit to Work is `/permits` (key `ptw`).

OHS Suite still uses landing’s shared `CONFIG.routes`:

| Landing `CONFIG.routes` | Shell path      | Screen                                             |
| ----------------------- | --------------- | -------------------------------------------------- |
| `login`                 | `/login`        | Sign in                                            |
| `register`              | `/register-org` | Create a new organisation (first account is admin) |
| `join`                  | `/signup`       | Join an organisation that already exists           |

Those three paths are mounted on the shell `App` under those names — they are
not aliases. Hosting’s catch-all `**` → `/index.html` serves them. Module
prefixes are rewritten to `/apps/<key>/index.html`.

`landingProductRoutes()` in `landing.js` is the machine-readable form of the
table above. What a product card should open:

```
all six products, domain / hosting  =  https://suite.weehs.org

OHS Suite     routes.login     =  /login
Fire Marshal  routes.login     =  /equipment
HECP LOTO     routes.login     =  /loto
Permit        routes.login     =  /permits
Auditor       routes.login     =  /audit
HIRA          routes.login     =  /hira
```

`VITE_PUBLIC_ORIGIN` in `.env.example` is the same origin, for documentation
and for a module app on a different origin that needs an absolute bounce back
to the branded shell. Production same-origin hosting leaves it blank so in-app
links stay relative. `VITE_SHELL_ORIGIN` is the local two-port equivalent
(`http://localhost:5173`); `scripts/dev-module.mjs` sets it.

### Auth and App Check hosts

Firebase Auth and App Check run on the **shell**, not on the landing page.

| Host                          | Firebase Auth → Authorized domains | App Check / reCAPTCHA domain list |
| ----------------------------- | ---------------------------------- | --------------------------------- |
| `suite.weehs.org`             | **Required**                       | **Required**                      |
| `weehs.org` / `www.weehs.org` | Not needed                         | Not needed                        |

`suite.weehs.org` without Auth authorized-domains fails sign-in with
`auth/unauthorized-domain`. The App Check site key is scoped to a domain list
too — a key that still only listed the old `*.web.app` host minted no token
the day the custom domain went live. `weehs.org` does not run Auth, so it
does not need either list.

If Google / Microsoft sign-in is enabled, the provider redirect URI is
`https://suite.weehs.org/__/auth/handler`. Password-reset email templates
should use that host too.

The live Firebase project id, hosting target, and console toggle state belong
in the private `docs/PRODUCTION.md`, not here.
