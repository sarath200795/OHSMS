# Legacy download URLs — operator runbook

**Finding M-5 residual.** `#49` stopped minting new Firebase download URLs.
Every URL minted before that change is still a bearer credential: it answers
to no rule, works signed-out, and survives the holder leaving the tenant.

This file is the operator procedure. The classifier is
`src/shared/storage/legacyDownloadUrls.js`. The walker is
`scripts/inventory-download-tokens.mjs`. Neither talks to a live project unless
you point it there with `--prod` and the same `VITE_*` values the app uses.

**This agent does not run `--apply` against any live Firebase project.** An
operator may, after a dry-run they have actually read.

---

## What is safe to revoke, and what is not

| Class | Meaning | `--apply` |
|---|---|---|
| **revoke** | Pointer has a download token **and** a stored `path` / `filePath` / `logoPath`. `fileUrl` can `getBlob` after the token dies. | May strip `firebaseStorageDownloadTokens` from that object. |
| **review** | Token, **no stored path**. `fileUrl` falls back to the stored URL. Killing the token leaves a record that cannot be opened any other way. | **Never.** Printed for a person. The encoded path in the URL is a hint, not a substitute. |
| **skip** | Inline `data:`, no token, or not a Firebase download host. | Ignored. |

`applyTargets()` filters the revoke list a second time so concatenating the
review rows onto it still cannot strip a url-only token. Tests pin that split.

---

## Environment

Same connection as the other maintenance scripts (`scripts/_firebase.mjs`).
Emulators are the default.

| Variable | Required for | Notes |
|---|---|---|
| `VITE_USE_EMULATORS` | live run | Must be `false` together with `--prod`. Without `--prod` the script refuses a real project. |
| `VITE_FIREBASE_API_KEY` | live run | Client config. Not a secret in the usual sense; still do not commit `.env.production`. |
| `VITE_FIREBASE_PROJECT_ID` | live run | |
| `VITE_FIREBASE_AUTH_DOMAIN` | live run | |
| `VITE_FIREBASE_STORAGE_BUCKET` | `--apply` | Admin SDK needs it to open the bucket. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | any run | Signs in as the org admin so the walker can read the tenant. |
| `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT` | `--apply` only | Service-account JSON. The client SDK cannot strip download-token metadata. Keep the file off the repository (`.gitignore` already covers `.env` and key material). |
| `CONFIRM_REVOKE` | `--apply` against a **live** project | Must be the string `yes`. Emulator `--apply` does not need it. |

Do not put a production key in this repository. Do not paste a live `--apply`
command into a public issue.

---

## Procedure

### 1. Dry-run (always first)

Against emulators, while developing the classifier:

```bash
node scripts/inventory-download-tokens.mjs
node scripts/inventory-download-tokens.mjs --json
```

Against the real tenant (read-only — this does not strip anything):

```bash
export VITE_USE_EMULATORS=false
# plus the VITE_* and SEED_ADMIN_* values from the private production runbook
node scripts/inventory-download-tokens.mjs --prod
```

Read the walk list the script prints. A pointer in a collection that is not
named there is a gap; add the collection to `FILE_POINTER_ORG_COLLECTIONS` or
`FILE_POINTER_TOP_LEVEL` rather than guessing.

### 2. Backfill `path` on every review row you still need

A review row whose URL encodes an object path can be repaired by writing that
path onto the Firestore pointer (`path`, `filePath` or `logoPath` — whichever
shape the record already uses) **without** stripping the token yet.

Do this by hand, record by record, in the Firebase console or a one-off Admin
script you do not commit. Confirm the file still opens in the app via
`getBlob`. Then re-inventory: that row should move from **review** to
**revoke**.

Never feed `suggestedPath` to `--apply`. The classifier reports it as a hint
and `applyTargets` ignores it.

A review row whose URL does not name a path, or whose object is already gone,
stays on the review list. Leave those tokens. Breaking a medical attachment
because the inventory could not prove a path is worse than leaving a bearer
link that a person still needs.

### 3. `--apply` — only after the review list is empty, or accepted

Allowed when:

1. You have a dry-run of **this** tenant in front of you.
2. Every review row is either backfilled or explicitly accepted as "leave the
   token".
3. Admin credentials are set (`GOOGLE_APPLICATION_CREDENTIALS` or
   `FIREBASE_SERVICE_ACCOUNT`).
4. Against a live project, `CONFIRM_REVOKE=yes` is set. Without it the script
   exits 1 and writes nothing.

```bash
CONFIRM_REVOKE=yes GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/inventory-download-tokens.mjs --prod --apply
```

`--apply` strips tokens on the **revoke** list only. Review rows are printed
again at the end, untouched.

### 4. What `--apply` is not

- Not a deploy step. Not a CI job. Not something to run "to be sure".
- Not a backfill. It does not write `path` onto Firestore documents.
- Not a delete of the Storage object. The file stays; only the anonymous
  download token dies. Authenticated `getBlob` continues to work when a path
  is stored.

---

## Failure modes worth naming

- **Url-only pointer + `--apply`.** Refused by construction. If a future edit
  moved the filter, `legacyDownloadUrls.test.js` is the test that would fail.
- **Live `--apply` without `CONFIRM_REVOKE=yes`.** Refused. Same file.
- **`--apply` as a signed-in client, no Admin SDK.** Refused. The metadata
  write is not a Firestore rule.
- **Walking an unnamed collection.** The dry-run prints the walk list. A
  missing collection is an incomplete inventory, not a silent revoke.
