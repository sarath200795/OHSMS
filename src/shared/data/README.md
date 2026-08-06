# Data & storage portability

The app is built on Firebase today, but two seams keep it swappable:

| Seam | Selects backend via | Adapters live in |
|---|---|---|
| **Files** — `src/shared/storage/` | `VITE_STORAGE_DRIVER` (`firebase` \| `s3`) | `src/shared/storage/adapters/` |
| **Database** — `src/shared/data/` | `VITE_DATA_DRIVER` (`firestore`) | `src/shared/data/adapters/` |

## Adding a storage backend

Write one file in `src/shared/storage/adapters/` exporting
`{ name, put(path, blob) -> {url}, remove(path) }`, register it in the
`DRIVERS` map in `src/shared/storage/index.js`, set `VITE_STORAGE_DRIVER`.
An S3-compatible adapter (AWS S3 / R2 / MinIO / B2) already exists — it needs
only a presign endpoint you host; the contract is documented at the top of
`adapters/s3.js`.

## Adding a database backend

Write one file in `src/shared/data/adapters/` implementing the provider
contract documented in `src/shared/data/index.js`
(`serverTimestamp, subscribe, list, create, update, remove` over string paths
like `organizations/<orgId>/<collection>`), register it in `DRIVERS` in
`src/shared/data/index.js`, set `VITE_DATA_DRIVER`.

For Supabase/Postgres, the natural mapping is one table per collection with
`org_id` and `jsonb data` columns, `subscribe` via Supabase Realtime, and
Row Level Security policies replacing `firestore.rules`.

## What the seam covers — and what it does not

`createModuleService` (module-kit) routes **all generic module CRUD** through
the provider. A full migration additionally touches:

- **Direct Firestore usage** not yet behind the seam:
  `src/shared/org/orgData.js` (orgs, users, audit log, sites, batched writes),
  `src/shared/docId/` (transactional ID reservation), and per-module
  `lib/firestore.js` files (fire, ptw, training, incidents, loto). Migrate
  them the same way: move each call onto `dataProvider`, extending the
  contract where needed (e.g. `getDoc`, `where` filters, transactions).
- **Auth** — Firebase Auth issues the identity everything checks. Swapping the
  DB means swapping auth (e.g. Supabase Auth) or federating tokens.
- **Security rules** — `firestore.rules` / `storage.rules` enforce tenancy
  server-side. The replacement backend must re-enforce the same rules (RLS,
  bucket policies); the client-side seam is *not* a security boundary.
- **Offline & realtime** — Firestore's IndexedDB cache and `onSnapshot` give
  offline reads/queued writes for free. Verify the replacement's story before
  switching; site-WiFi dead spots are a real usage mode for this app.
- **Timestamps** — records store Firestore `Timestamp` values. A new backend's
  adapter should normalise to ISO strings or ms epochs on read, and a one-off
  data migration converts history.

Rule of thumb: **new code never imports `firebase/firestore` or
`firebase/storage` directly** — it calls `dataProvider` / `putFile`. Every file
that still does is a to-do on the migration list, findable with:

```bash
grep -rl "firebase/firestore\|firebase/storage" src --include="*.js*" | grep -v shared/data/adapters | grep -v shared/storage/adapters
```
