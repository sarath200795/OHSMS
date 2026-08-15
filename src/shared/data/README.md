# Data & storage portability

The app is built on Firebase today, but two seams keep it swappable:

| Seam | Selects backend via | Adapters live in |
|---|---|---|
| **Files** — `src/shared/storage/` | `VITE_STORAGE_DRIVER` (`firebase` \| `s3`) | `src/shared/storage/adapters/` |
| **Database** — `src/shared/data/` | `VITE_DATA_DRIVER` (`firestore` \| `memory`) | `src/shared/data/adapters/` |

## Adding a storage backend

Write one file in `src/shared/storage/adapters/` exporting
`{ name, put(path, blob) -> {url}, remove(path) }`, register it in the
`DRIVERS` map in `src/shared/storage/index.js`, set `VITE_STORAGE_DRIVER`.
An S3-compatible adapter (AWS S3 / R2 / MinIO / B2) already exists — it needs
only a presign endpoint you host; the contract is documented at the top of
`adapters/s3.js`.

## Adding a database backend

Write one file in `src/shared/data/adapters/` implementing the provider
contract documented at the top of `src/shared/data/index.js` — that header is
the specification, not a summary of one. Register it in `DRIVERS` in the same
file and set `VITE_DATA_DRIVER`.

The surface, over `/`-separated collection paths with documents addressed as
`(path, id)`:

| | |
|---|---|
| sentinels | `serverTimestamp`, `increment`, `arrayUnion` |
| reads | `get`, `list`, `count`, `subscribe`, `subscribeDoc` |
| writes | `newId`, `create`, `set`, `createExclusive`, `update`, `remove` |
| composition | `batch`, `runTransaction` |
| errors | `isWriteRefused` |

Four of those carry weight beyond their signature, and an adapter that gets
them wrong will still pass a casual read of its own tests: `createExclusive`
must be atomic at the backend and never a read-then-write, `update` must
**reject** on a missing document rather than upsert, `batch` must be
all-or-nothing across *arbitrary* collections (not just one org's), and both
subscribes must return their unsubscribe synchronously while delivering the
first emission asynchronously. `index.js` says why each one matters.

`adapters/memory.js` is a full second implementation — no emulator, no JDK, so
the contract suite runs under plain `npx vitest run`. Read it before writing a
third; it is the smallest honest version of every guarantee above. It is a test
and development driver, not a store anything should be shipped against.

For Supabase/Postgres, the natural mapping is one table per collection with
`org_id` and `jsonb data` columns, `subscribe` via Supabase Realtime, and
Row Level Security policies replacing `firestore.rules`.

## What the seam covers — and what it does not

`createModuleService` (module-kit) routes **all generic module CRUD** through
the provider. A full migration additionally touches:

- **Direct Firestore usage** not yet behind the seam:
  `src/shared/org/orgData.js` (orgs, users, audit log, sites, batched writes),
  `src/shared/docId/` (transactional ID reservation), and per-module
  `lib/firestore.js` files (fire, ptw, training, incidents, loto, cctv).
  Migrate them the same way: move each call onto `dataProvider`. The contract
  is already wide enough to carry them — single-doc reads, `where` filters,
  batches, transactions and exclusive create are all in it — so a call that
  cannot move is a finding worth writing down, not a reason to widen it
  further. Two known ones: `doc.ref` writes (`deleteDoc(d.ref)` and friends)
  have to be rewritten as `remove(path, row.id)` because the provider returns
  plain rows with no ref, and fire's read-only demo guard wraps the raw write
  primitives at its import site, so moving those calls drops it unless the
  guard moves too.
- **Auth** — Firebase Auth issues the identity everything checks. Swapping the
  DB means swapping auth (e.g. Supabase Auth) or federating tokens.
- **Security rules** — `firestore.rules` / `storage.rules` enforce tenancy
  server-side. The replacement backend must re-enforce the same rules (RLS,
  bucket policies); the client-side seam is *not* a security boundary.
- **Offline & realtime** — Firestore's IndexedDB cache and `onSnapshot` give
  offline reads/queued writes for free. Verify the replacement's story before
  switching; site-WiFi dead spots are a real usage mode for this app.
- **Timestamps** — records store Firestore `Timestamp` values, and the seam
  passes stored values through **unchanged** in both directions. Do not have a
  new adapter quietly normalise them to ISO strings on read: 16 files read
  `.seconds`/`.toDate()`, and three sorts compare `.seconds` directly, so a
  changed shape gives an all-zero comparator — which leaves the original order,
  meaning the list looks fine and is simply wrong. Normalising is its own task,
  with a data migration for history attached to it.

Rule of thumb: **new code never imports `firebase/firestore` or
`firebase/storage` directly** — it calls `dataProvider` / `putFile`. Every file
that still does is a to-do on the migration list, findable with:

```bash
grep -rl "firebase/firestore\|firebase/storage" src --include="*.js*" | grep -v shared/data/adapters | grep -v shared/storage/adapters
```
