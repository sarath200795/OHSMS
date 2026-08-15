# ohsms-server

The API server for WEHS/OHSMS. It exists so that **authorization stops being
Firestore-specific**.

Today the browser talks to Cloud Firestore directly, and `firestore.rules` —
1064 lines, ~20 match blocks, ~58 `allow` rules, 25 helpers — is the *only*
thing standing between one tenant and everybody else's incident reports,
injuries and health records. That works, and it is well tested, but it means the
authorization model can only ever live in one database's rule language. This
process is where it moves to.

Right now it is a **skeleton**. It authenticates callers, loads their live
profile, and serves no business routes at all.

---

## What this is NOT

Read this section before adding anything.

**It does not own reads.** Reads stay as client-side Firestore `onSnapshot`
listeners governed by `firestore.rules`. All 61 of them stay exactly where they
are — that is what makes the screens live, and replacing them with polling
against this server would be a downgrade the users would feel immediately. This
is a *hybrid*: the server owns writes, the rules keep owning reads.

**It does not own writes yet either.** One module's writes move at a time
(strangler fig, below). Everything not yet migrated keeps writing directly to
Firestore and **must keep working**. A change here that breaks a module which
has not moved yet is a regression, not progress.

**It is not a place to relax a rule.** `firebase-admin` does not evaluate
`firestore.rules` — not a lenient version of them, *none of them*. Every rule
that protected an operation has to exist again, in JavaScript, **before** a
route serves that operation. A route that writes without the equivalent check is
not a weaker rule; it is no rule, and it is a hole straight through the entire
security model that `firestore.rules` cannot see in order to backstop it.

**`firestore.rules` is not edited from here.** Not to loosen it, not to tighten
it. It stays as the backstop for everything still writing directly. Tightening
it is a later, separate, deliberate step, taken once a module is *fully*
migrated and verified.

---

## Layout

```
server/
  src/
    index.js        the express app: middleware order, health, 404, error handler
    auth.js         verifies the ID token; attaches a uid and nothing else
    authz/          the authorization core — profile loading, predicates, guards
    firestore.js    the Admin SDK handles, and the guard that keeps tests off prod
    errors.js       what a client is told, and what it is never told
    log.js          structured logging shaped for Cloud Run
    routes/         where module routes get mounted (empty, on purpose)
  Dockerfile        the Cloud Run image
  package.json      separate from the repo root and from functions/
```

The middleware order in `src/index.js` is the security model in miniature and is
worth reading top to bottom:

| Stage | What it does |
|---|---|
| `requestId` | every log line and every error body carries the same id |
| `express.json` | a **bounded** body, before anything allocates on a caller's word |
| `requireAuth` | a verified ID token; attaches a `uid` and nothing else |
| `requireProfile` | the **live** `/users` profile, re-read every request; fails closed |
| `apiRouter` | module routes, mounted one migrated module at a time |
| `notFound` | *after* auth, so 404-vs-401 cannot be used to map the surface |
| `errorHandler` | a code and a request id to the caller, the detail to the log |

`requireAuth` and `requireProfile` are applied with `app.use`, not per-router, so
that a route added later cannot be left unauthenticated by omission. The cost of
forgetting is a 401, not an open endpoint.

### Two things the code will not let you do

**The token's claims are not authority.** `functions/lib/claims.js` stamps
`{orgId, role}` onto the ID token, and that token lives for up to an hour.
`firestore.rules` never reads either one — it re-reads `/users` on *every*
evaluation, so a revocation lands instantly. The claims exist only because Cloud
Storage rules cannot query Firestore.

The gap is not theoretical: `revokesAccess()` revokes refresh tokens on exactly
two transitions, and **member → auditor is not one of them**. Nothing fires, and
the freshly-demoted auditor's token still says `role: 'member'` for the rest of
the hour. A server that branched on that claim would let them *write* for that
hour — precisely the failure `isWriterOf` was introduced to close. Likewise
`mustChangePassword` is not a claim key at all, so a provisioned account's token
looks perfectly healthy while `passwordIsOwn()` denies it everything.

That is why `req.caller.staleClaims` is named the way it is. Log them, assert
them against the profile, never branch on them.

**An `orgId` from the client is an assertion, not a fact.** It is something to be
*compared* against the profile, exactly as `isApprovedMemberOf(orgId)` compares a
path segment. On an update, authorise against the **stored** `orgId` and reject
any write that changes it — authorising against the incoming one is how a caller
captures another tenant's document by rewriting a field, and it is the single
mistake `firestore.rules` has been patched for the most times.

---

## Running it locally against the emulator

You need a JDK on the PATH for the Firebase emulators, and dependencies
installed in `server/` (it has its own `package.json` and its own lockfile,
separate from the repo root and from `functions/`).

**Terminal 1** — emulators, from the repo root:

```sh
npm run emulators      # auth :9099 · firestore :8080 · UI :4000
npm run seed           # optional: demo org + admin@acme.test / password123
```

**Terminal 2** — the server, from `server/`:

```sh
npm install

export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export PORT=8081

npm run dev            # node --watch src/index.js
curl localhost:8081/healthz
```

In PowerShell, `$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'` and so on.

### Two things that will catch you

**Set `PORT`.** The server defaults to 8080 because that is Cloud Run's default
— and the Firestore emulator is *also* on 8080 (`firebase.json`). Started
without `PORT`, the server loses the race and dies on `EADDRINUSE`, or, worse,
starts first and the emulator is the one that fails. 8081 keeps them apart.

**Set both emulator hosts.** They are two different variables, and the server's
own `isEmulated()` only looks at the Firestore one. If you set
`FIRESTORE_EMULATOR_HOST` and forget `FIREBASE_AUTH_EMULATOR_HOST`, writes go to
the emulator but `verifyIdToken` tries to validate the emulator's unsigned
tokens against Google's real public keys — so **every** request is a 401 and the
log says `verification_failed`, which looks exactly like a genuinely bad token.

### Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Injected by Cloud Run. Set it locally — see above. |
| `FIRESTORE_EMULATOR_HOST` | unset | Honoured by the Admin SDK. Also what the test guard checks. |
| `FIREBASE_AUTH_EMULATOR_HOST` | unset | Separate variable. Needed for `verifyIdToken` locally. |
| `GOOGLE_CLOUD_PROJECT` | metadata / `ohsms-demo` | On Cloud Run this comes from the metadata server. |
| `JSON_BODY_LIMIT` | `1mb` | A Firestore document cannot exceed 1 MiB, so a larger body cannot become one. |
| `AUTH_CHECK_REVOKED` | on | `false` skips the revocation lookup. A degraded-mode switch, not a default. |
| `NODE_ENV` | — | `production` in the image. `test` under vitest, where it arms the guard below. |

Production credentials are never written down here and never baked into the
image: on Cloud Run, `initializeApp()` takes the service account and the project
from the metadata server.

---

## Tests

```sh
npm test               # vitest run
npm run test:watch
```

The suite is unit-level and holds no credentials. `src/firestore.js` **refuses to
initialise `firebase-admin` when `NODE_ENV === 'test'` and no emulator host is
set**, which is the guard that keeps a stray test off the production database —
under the Admin SDK such a test would write to a real tenant's records with
nothing refusing it, and the first anyone would know is a customer asking who
filed an inspection at 2am. Point tests at the emulator deliberately, or stub the
module.

Every behaviour gets a vitest test beside the code. For the routes that come
next, the rules suites at the repo root are ready-made oracles rather than a
blank page — `tests/manager.rules.test.js` and `tests/hardening.rules.test.js`
already encode auditor-refused / member-allowed on the generic rule, and
`tests/firestore.rules.test.js` covers `docSeq` monotonicity and the `auditLogs`
actor pin end to end. Port those expectations; do not re-derive them.

---

## The strangler fig

One module's writes move at a time. The order is by **containment** — how few
cross-cutting rules apply, and whether the shared primitives it forces you to
build are the ones every later module needs anyway. It is not by size and not by
business value.

| # | Module | Why here |
|---|---|---|
| 1 | **Inspections** | Every cross-cutting rule collapses to a no-op. No decision states, not `documents`, not `sites`, path-tenanted, no public surface. The whole surface is `isWriterOf` to create/update and `isManagerOf` to delete — provable against the generic rule with nothing in the way. |
| 2 | Objectives | Smaller still, and proves the scaffolding generalises. Second rather than first only because it has no direct rules-test coverage to check the port against. |
| 3 | CCTV | Generic rule only, strong pure-logic coverage. Held back by two multi-document batches needing a transactional equivalent. |
| 4 | HIRA | Writes `/organizations/{orgId}` directly, which is `isAdminOf` — a different predicate on a different match block. |
| 5 | Committee | Writes `/orgIndex`, the tenant-hijack surface. Do not let the first `orgIndex` implementation ride in on a small module. |
| 6–8 | Training, Audit, Emergency | The first modules that genuinely need `keepsDecision` on `status` / `approvalStatus` / `lifecycle`. |
| 9 | Incidents | Biggest by write count; drags in `injuries` and `illnesses` with their manager-only read rule, plus subcollection writes that inherit the parent collection's gating. |
| 10 | Documents | The only module where the six-field classification freeze *and* decision gating both apply, on top of the site-visibility read model. |
| 11 | LOTO | Field tenancy across five top-level collections, the `/procedureQr` mirror, and the append-only `/lotoEvents` trail. |
| 12 | PTW & Fire | Every trap at once: the public QR surfaces, the `defectLocks` exclusive-create, the mirrors, and permits' six nested decision paths. Migrate when the primitives are already proven elsewhere. |

Inspections is first because it is the smallest module that still forces you to
build the three pieces every later module needs, and to build them right the
first time: the live-profile middleware, the `auditLogs` writer with a
server-pinned actor and timestamp, and the `docSeq` reserver with its strictly
monotonic transaction.

### Rules for each migration

- **Re-implement before you serve.** The check lands in the same change as the
  route, or the route does not land.
- **Classify by document existence, not by HTTP verb.** The rules treat
  `resource == null` as a create, which means a `set()` over an existing document
  is an *update*. Match that.
- **Evaluate the merged post-state.** `request.resource.data` is the full
  document after the write, not the patch. For a partial update the server has to
  merge into the stored document and check the result.
- **Re-read the profile inside the write's transaction.** The middleware ran
  before the handler and the write happens after it. Rules had no such gap — they
  evaluate against committed state at write time — so a read-then-write outside a
  transaction opens a TOCTOU window the rules did not have. That is what
  `reloadCaller` is for.
- **Use `.create()` where the rules relied on create-fails-if-exists.** The Admin
  SDK's `.set()` overwrites, so it succeeds exactly where the rule refused.
- **Never collapse a validation failure into a business outcome.** A refused QR
  defect report once came back as "already reported", so for a day reporters were
  told the system had their report and it had nothing. Codes say what happened.
- **Never log an ID token, an API key, or personal/health data.**

### The one surface that must never be mounted on the authenticated router

The public QR paths (`/reports`, `/observations`, `defectLocks`) are anonymous.
`firestore.rules` keeps their `keys().hasOnly()` *inside* the anonymous branch
rather than above both branches, because a constraint placed on the member
branch is silently overridden by the generic rule — rules are a permissive
**union**, and a narrow match restricts nothing while a broader one still grants.

The server equivalent is a **separate router with no auth middleware and its own
exhaustive validation**, mounted above `requireAuth`. Not an optional-auth flag
on a handler in `routes/index.js`.

Note that in the server this union property *inverts*: there, a narrow rule was
merely decorative; here, a route with no check is the weakest member and it wins.

---

## The container

`Dockerfile` targets Cloud Run: `asia-south1`, project `weehs-4eb28`, alongside
the existing Cloud Functions. Build from `server/`, which is the build context:

```sh
docker build -t ohsms-server .
docker run --rm -e PORT=8081 -p 8081:8081 ohsms-server
```

Production-only dependencies (`npm ci --omit=dev`), a non-root `node` user, code
left owned by root so the process cannot rewrite its own authorization checks,
and `PORT` read from the environment. The `CMD` is in exec form so node is PID 1
and the `SIGTERM` handler in `src/index.js` actually runs — in shell form
`/bin/sh` is PID 1, does not forward signals, and every in-flight request is cut
when Cloud Run recycles an instance.

**Nothing here is deployed yet.** Build and test locally only.
