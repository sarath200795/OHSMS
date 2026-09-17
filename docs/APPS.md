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

A platform operator activates modules on `/platform` (Module access). That
screen is the subscription grant: flipping a key to `true` makes the module
usable. Activating later does not recreate the org. Firestore rules refuse a
founder activating anything themselves; they may only seed the all-off document.

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
`apps/<key>/` exists, add its key to `apps.js`, and add it to the placeholder
check in `firestore.rules` (`modulesArePlaceholders`).
