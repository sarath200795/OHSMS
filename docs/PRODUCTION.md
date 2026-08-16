# Production runbook

## 0. Environment files — the footgun that bit us  ⚠️ read before deploying

Vite loads `.env` for **every** mode; `.env.<mode>` overrides only the keys it
names. Any key missing from `.env.production` therefore inherits the demo value
from `.env` — silently, and per-key.

That is how the live site shipped with
`storageBucket=ohsms-demo.appspot.com` while auth and Firestore pointed at the
real project: every upload failed and nothing in the UI said why.

`.env.production` is gitignored (it holds keys), so this list cannot be enforced
by the repo. **Every one of these must be defined explicitly there:**

```
VITE_USE_EMULATORS=false
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=      # firebase apps:sdkconfig web  →  storageBucket
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Verify after any build, before deploying:

```bash
grep -o "ohsms-demo[^\"]*" dist/assets/*.js   # must print nothing
```

The app also checks this itself at startup and logs an error listing any demo
values found in a non-emulator build.

What the code already does, and the console/CLI steps only a project owner can
perform. Work top to bottom; each section says how to verify it worked.

## 0b. Deploy order: rules BEFORE hosting  ⚠️ or public QR reporting breaks

The public write surfaces are validated by `firestore.rules` with `hasOnly()`,
so the rules enumerate the exact field set the client sends. That makes the two
artifacts a matched pair, and it makes the deploy order load-bearing:

- **A new client against old rules fails closed.** When the QR defect report
  started carrying a `token`, the old `hasOnly(['extId','defectType','createdAt'])`
  on `/defectLocks` rejected the extra key — every public defect report was
  refused, and because `createReport` maps `permission-denied` to the duplicate
  message, the reporter was told the fault was "already under progress". A
  silent break on the one surface where the reporter has no way to escalate.
- **An old client against new rules also fails**, for the mirror-image reason:
  the public branch now requires proof of scan and an already-loaded tab has no
  `token` to send. That window is small — a QR scan loads the page fresh — but
  it is real.

So: `firebase deploy --only firestore:rules` first, confirm, then
`--only hosting`. Never the single combined command for a release that changes
both, and never hosting first.

**The same ordering now carries file deletion, and functions come first.**
`storage.rules` refuses client deletes outright (`canDeleteFrom` is `false`);
deletion happens in the `deleteOrgFile` callable, which checks the caller's live
profile — see SECURITY.md S-19. So the function must be deployed **before** the
rules that assume it exists, or deleting anything fails for everyone.
`deploy.yml` already does functions → rules → hosting, which is the correct
order for this and was chosen for `syncUserClaims` for the same reason.

There is a small, benign window between the rules deploy and the hosting deploy:
the still-live old client calls `deleteObject` directly and is refused. Deletion
is best-effort by design (`removeFile` swallows the failure — an orphaned object
is a cost, not a correctness bug), so the visible effect is a file that stays in
the bucket after its record is gone, for the few minutes until hosting catches
up. Worth knowing rather than worth avoiding; the alternative ordering breaks
the security control instead.

```bash
npx firebase deploy --only firestore:rules --project weehs-4eb28
```

Verify a denied write before shipping the client (this creates no data):

```bash
curl -s -X POST "https://firestore.googleapis.com/v1/projects/weehs-4eb28/databases/(default)/documents/organizations/ORGID/reports" -H "Content-Type: application/json" -d '{"fields":{"source":{"stringValue":"qr"},"kind":{"stringValue":"defect"},"extId":{"stringValue":"x"},"approvalStatus":{"stringValue":"pending"},"reportedBy":{"stringValue":"public"},"note":{"stringValue":""}}}'
```

It must return `PERMISSION_DENIED` — no token, no write.

## 0c. Site-scoped documents: BACKFILL BEFORE RULES  ⚠️ or the library goes dark

Site-level documents are restricted to people whose access reaches that site.
The rule reads `visibility` off each document **directly** — `resource.data.visibility`,
not `resource.data.get('visibility', 'all')` — and that is load-bearing rather
than stylistic.

`read` covers `get` and `list`. For a list, Firestore has to prove from the rule
alone that the query cannot return a document the rule would refuse, and it can
only do that when the condition names a field directly. Written defensively —
`.get(field, default)`, `!('visibility' in resource.data) || …`, or
`keys().hasAny([…])` — the condition stops constraining the query: the
single-document `get` is still refused, but an unfiltered **list returns the
whole collection, contents and all**. All three forms were checked against the
emulator. Per-document tests pass in every one of them, which is how this would
have shipped; `tests/documents.rules.test.js` lists as well as gets.

The price of direct access is that reading a field that is not there errors, and
an erroring rule denies. A document with no `visibility` is therefore readable by
nobody but admins, managers and auditors. So, in this order:

```bash
node scripts/backfill-document-visibility.mjs --dry-run
```

```bash
node scripts/backfill-document-visibility.mjs
```

Then, and only then:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project weehs-4eb28
```

The script is idempotent — it only touches documents with no `visibility` yet,
and stamps every one of them `all`, which is exactly the access they have today.
It narrows nothing; it records what is already true so the rule can read it. Run
it against **every** org in the project, not just the first: it reads the org off
the signed-in account, so one run covers one tenant.

The indexes ship with the rules because a member's library is fetched as
`visibility == 'all'` plus `siteId in (…)`, and both need a composite index with
`createdAt`. Without them a member sees an empty library and a console error.

## 1. App Check — protect the public write surfaces  ⚠️ console required

The app has three deliberately unauthenticated write surfaces (equipment defect
reports via QR, defect locks, permit observations via QR). The client is fully
wired; without the steps below it ships no tokens and nothing is enforced.

1. Firebase console → **App Check** → **Apps** → register the web app → pick an
   attestation provider → copy the site key.
2. **Make `firebase.js` match the provider you picked.** reCAPTCHA v3 and
   reCAPTCHA Enterprise mint different tokens, and App Check refuses the wrong
   kind:

   | Registered as | `src/shared/firebase.js` must use |
   | --- | --- |
   | reCAPTCHA v3 | `ReCaptchaV3Provider` |
   | reCAPTCHA Enterprise | `ReCaptchaEnterpriseProvider` |

   Match the provider to **the key**, then make the console agree — not the
   other way round. The console's label is just a label; the key is the thing
   that either works or does not. Tell them apart in the browser:

   | Symptom in the console/network tab | What it means |
   | --- | --- |
   | `recaptcha/api.js` loads, badge renders, no errors | the key is **classic v3** |
   | `recaptcha/enterprise.js` returns **400**, `appCheck/recaptcha-error` | an Enterprise provider on a **v3 key** |
   | Everything loads but verified stays **0%** | provider and key agree, but the **registration** does not |

   **Test the key before wiring it in.** Two provider swaps and a production
   lockout were spent on a mismatch that did not exist, because nobody asked
   reCAPTCHA whether it recognised the key. It answers directly:

   ```bash
   K=<your-site-key>
   CO=$(node -e "process.stdout.write(Buffer.from('https://YOUR-DOMAIN:443').toString('base64').replace(/=/g,'.'))")
   curl -s "https://www.google.com/recaptcha/api2/anchor?ar=1&k=$K&co=$CO&hl=en&size=invisible&cb=x" \
     | grep -oiE "Invalid site key|Invalid domain|ERROR for site owner[^<]*"
   ```

   | Output | Meaning |
   | --- | --- |
   | *(nothing)* | the key is valid for that origin — wire it in |
   | `Invalid site key` | the key does not exist as a **site** key. Usually the **Secret** key pasted by mistake: reCAPTCHA issues both, both are 40 chars, both start `6L` |
   | `Invalid domain …` | right key, wrong origin — add the domain to the key |

   Swap `api2` for `enterprise` in that URL to test an Enterprise key. Sanity-check
   the probe itself with Google's public test key
   `6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI`, which must come back clean.

   **The console registration must hold the same key.** A valid site key that
   App Check → Apps does not know still verifies **0%** — it just fails later, at
   the token exchange, instead of at reCAPTCHA. Same symptom, different cause, so
   read the console before concluding anything from the percentage:

   | Browser console | Where it broke |
   | --- | --- |
   | `appCheck/recaptcha-error`, `recaptcha/api2/…` **400** | reCAPTCHA refused the key — run the probe |
   | `appCheck/fetch-status-error`, or a 403 exchanging the token | reCAPTCHA is fine; the **registration** holds a different key |
   | Nothing, but verified stays 0% after a day | give it 24h — these metrics lag |

   > **Current state of this project: App Check is ON, unenforced.**
   > `VITE_APPCHECK_SITE_KEY` is a classic **v3** site key, proved with the probe
   > above (accepted on `api2` from `weehs-4eb28.web.app`, while the key it
   > replaced was rejected as `Invalid site key` and Google's control key passed).
   > The client uses `ReCaptchaV3Provider` to match. Firestore, Storage and
   > Authentication are all on **Monitoring** — that is deliberate, and nothing
   > should be enforced until verified requests approach 100%.
3. Put the key in the production env: `VITE_APPCHECK_SITE_KEY=<key>` (locally in
   `.env.production`, in CI as a repo variable), redeploy.
4. Watch console → App Check → **APIs** until Cloud Firestore's verified-request
   share is ~100% (give real users a day or two; metrics lag up to 24h).
5. **Only then**: App Check → APIs → **Cloud Firestore → ⋮ → Enforce**.
6. For local dev against the enforced project: console → App Check → your app →
   **Manage debug tokens** → create one → set `VITE_APPCHECK_DEBUG_TOKEN`.

> ⚠️ **Do not enforce while verified sits at 0%.** Enforcement is checked at
> Google's edge *before* security rules, so it rejects everything — including the
> member-profile read that runs immediately after sign-in. The symptom is
> "Missing or insufficient permissions" **at login**, for every user at once,
> with nothing wrong in the rules. This has happened here once, caused by the
> provider mismatch in step 2. Recovery is App Check → APIs → Cloud Firestore →
> ⋮ → **Unenforce**, which takes a minute or two to propagate.

Verify: with enforcement on, `curl` against the Firestore REST API without a
token gets `PERMISSION_DENIED`; the app keeps working.

## 1b. Single sign-on and two-factor  ⚠️ console + Identity Platform

The app code for both is in place. Both are off until the console side is done,
and **the order matters for MFA** — see the warning below.

### Two-factor (TOTP)

TOTP rather than SMS: codes work with no signal, which is the difference between
a second factor and a lockout on a plant floor, and SMS costs money per login
and falls to SIM swap.

1. Firebase console → **Authentication → Sign-in method → Advanced → SMS/TOTP
   multi-factor** → enable **TOTP**. This requires Identity Platform (the paid
   tier of Firebase Auth).
2. Users turn it on themselves at **/security**, reachable from the account menu.
   Enrolment is deliberately self-service: the secret must reach that person's
   authenticator and nobody else's, so a flow where an admin sees it defeats the
   point.

⚠️ **Do not enforce MFA before this code is deployed.** When a second factor is
required, Firebase does not return a user — it throws
`auth/multi-factor-auth-required` carrying a resolver, and sign-in only
completes by answering it. An app that does not catch that shows a generic
error and the account is unreachable. Enforcing MFA against a client without the
challenge handling locks people out rather than protecting them. That handling
now exists (`src/shared/auth/mfa.js`, wired through `AuthContext.login`), so as
long as the client is deployed first, enabling it is safe.

⚠️ **Enrolment requires a verified email.** Firebase refuses to add a factor to
an unverified address, and only says so when you try. This app never sent
verification emails before — accounts come from signup or admin provisioning —
so the security screen detects it and offers to send one. Expect the first
person to enrol to verify their address first.

### Single sign-on (SAML / OIDC)

1. Firebase console → **Authentication → Sign-in method → Add new provider** →
   SAML or OIDC. Also Identity Platform. Note the provider id it gives you: it
   always begins `saml.` or `oidc.`.
2. Add that id to the client build:

```bash
VITE_SSO_PROVIDERS="saml.acme:Acme SSO,oidc.okta:Okta"
```

   Comma-separated, each `providerId:Button label`; the label is optional. Set it
   as a repository variable so CI builds carry it (`.github/workflows/deploy.yml`
   passes `VITE_*` through).
3. Add the production domain to **Authorised domains** in the same console
   screen, or sign-in returns `auth/unauthorized-domain`.

With the variable unset there are no SSO buttons and the login page is exactly
what it was — nothing to undo for deployments that do not use it. A malformed
entry is dropped with a console error rather than throwing, because a bad value
here must not take down the login page: without the password form there is no
way back in.

Sign-in tries a popup first and falls back to a full redirect when the browser
blocks it — common on managed corporate devices, which is exactly the fleet most
likely to have SSO.

**What SSO does not do on its own:** a federated user still needs a `/users`
profile before they can see anything, and the rules still put a self-created one
in `pending` until an admin approves it. SSO replaces the password, not the
approval step.

## 2. Error monitoring  ⚠️ account required

The root ErrorBoundary and global handlers are live and log to the console
today. To ship errors somewhere useful:

1. Create a (free-tier) Sentry project → copy the DSN.
2. Set `VITE_SENTRY_DSN=<dsn>` in the production env, redeploy.

The SDK is dynamically imported — builds without the DSN carry zero Sentry
bytes. Verify in a deployed build by triggering any error and checking the
Sentry inbox. In dev, `?__crash=1` on any URL exercises the boundary itself.

**Sentry covers the browser only.** Nothing that happens in `functions/` reaches
it, which is the subject of the next section.

## 2a. The server side: alerting on the nightly sweep  ⚠️ console required

Sentry watches the tier where a failure is *visible* — a user sees a broken
screen and complains. Nothing watched the tier where a failure is **invisible**,
which is the one that actually needed watching.

`purgeSoftDeleted` runs unattended at 03:30 every night with Admin SDK
privileges and hard-deletes occupational-health records. It is written to be
resilient: every error inside it is caught so that one bad organization cannot
stop the rest. That is correct. But it used to end there — nothing ever threw,
`retryCount` is 0, and so **the invocation was recorded as a success no matter
what happened inside it**. A sweep that had been failing for months was
indistinguishable from one with nothing to do, while the app went on telling
users their data is purged after 30 days.

That is fixed in code (`functions/lib/retention.js` `summarizeFailures`): the
sweep still does all the work, and then throws if any part of it failed, which
marks the invocation FAILED. Four things now count as a failure:

| Kind | Meaning |
|---|---|
| `collection-failed` | one org/collection threw; the rest of the sweep continued |
| `file-left-behind` | the pointer was deleted and the object was NOT — the shape of a failed erasure request |
| `foreign-file-path` | **attack indicator**: a record named a file outside its own org |
| `foreign-qr-mirror` | **attack indicator**: a record named a public QR mirror owned by another tenant |

The last two are not glitches. A member cannot delete anything under
`storage.rules`; these are what it looks like when someone tries to get the
Admin-SDK sweep to do it for them, in someone else's tenant. They should page a
human, not sit in a log.

**The console half — do this, or the code change above changes nothing.** A
failed invocation is only useful if something is listening:

1. Google Cloud console → **Monitoring** → **Alerting** → *Create policy*.
2. Condition on the Cloud Functions metric
   `cloudfunctions.googleapis.com/function/execution_count`, filtered to
   `function_name = purgeSoftDeleted` and `status != ok`. Threshold: above 0.
3. Notification channel: an email that a person actually reads.

Add a second policy for the case error alerting can never catch — **the sweep
not running at all**. A missing scheduled execution produces no error, no log
and no signal of any kind. Alert on `execution_count` for `purgeSoftDeleted`
being **absent for 26 hours** (the job is daily; 26h tolerates a late run
without crying wolf).

**Uptime check** — while in Monitoring, add one against the hosted app so a
white screen is not discovered by a user:

Monitoring → **Uptime checks** → *Create*: HTTPS, host `weehs-4eb28.web.app`,
path `/`, 5-minute interval, alert after 2 consecutive failures, to the same
notification channel. The SPA returns `index.html` at every path, so `/` is a
sufficient liveness probe — it proves hosting is serving, not that Firestore is
answering, and that distinction is worth remembering when it goes green during
an incident.

**Verify the alerting, do not assume it.** In the Cloud console, run
`purgeSoftDeleted` manually via *Testing* while an org holds a record with a
deliberately bad file path, and confirm the alert email arrives. An alert policy
nobody has ever seen fire is the same class of belief as an untested backup.

## 3. Backups — CONFIGURED. State as of 2026-08-16

Firestore has no undo. Two layers, both in place. `gcloud` is **not** required;
the Firebase CLI does all of this, which matters because nobody here has gcloud
installed.

| Layer | Setting | Verified |
|---|---|---|
| Point-in-time recovery | `POINT_IN_TIME_RECOVERY_ENABLED`, 7-day window | 2026-08-16 |
| Scheduled export | Weekly (Sunday), 30-day retention | 2026-08-16 |
| Delete protection | `DELETE_PROTECTION_ENABLED` | 2026-08-16 |

Read the current state — do this before believing any of the above:

```bash
npx firebase-tools firestore:databases:get "(default)" --project weehs-4eb28
```

```bash
npx firebase-tools firestore:backups:schedules:list --project weehs-4eb28
```

```bash
npx firebase-tools firestore:backups:list --project weehs-4eb28
```

**Known RPO gap.** The export runs *weekly*. PITR covers any point in the last
7 days continuously, so an ordinary bad write is fully recoverable — but if the
**project itself** were lost, PITR goes with it and the exports are the only
survivor, making the worst case up to 7 days of loss. Moving to daily is one
command and was consciously deferred:

```bash
npx firebase-tools firestore:backups:schedules:update <scheduleId> --recurrence DAILY --project weehs-4eb28
```

## 3a. Restore — what the drill found  ⚠️ read before you need it

A drill was performed on 2026-08-16: backup `c2573b10` was restored into a
scratch database `restore-drill`. It succeeded and took **about 15 minutes**
end to end. Four things came out of it that are not obvious and cost real
recovery time — or a false alarm — if met for the first time during an incident.

**0. The database appears instantly and is EMPTY for most of the restore.**
This is the one that will fool you. `firestore:databases:get` returns a healthy
record within seconds of starting a restore, and the console will happily show
you the new database with no collections in it. That is not a failed restore or
an empty backup; the data import is still running. During the drill this
produced exactly the wrong conclusion — "the backup is empty" — from an
operation that was working correctly.

The database record is not the signal. **`sourceInfo.progress` is**, and it is
only visible in the JSON:

```bash
npx firebase-tools firestore:databases:get restore-drill --project weehs-4eb28 --json
```

It reads `IN_PROGRESS` until the import finishes, then `COMPLETED`. Do not judge
a restore, and do not start the steps below, before it says `COMPLETED`.

**1. You cannot restore over an existing database.** Firestore restores only
ever create a NEW database, named at restore time. There is no "restore
production back to Tuesday" — there is only "make a second database that looks
like Tuesday". The `(default)` database the app talks to is untouched by a
restore, which is safe, but it means a restore alone recovers nothing users
can see.

**2. So the app has to be pointed at the restored database.** It used to be
hardwired to `(default)`, so this meant editing source under pressure. It is now
`VITE_FIREBASE_DATABASE_ID` (`src/shared/firebase.js`) — set it, rebuild,
deploy. The app logs a warning on every boot while it is set, so a recovery
build cannot quietly become the permanent one.

**3. A restored database comes up with CLOSED rules and PITR disabled.** The
restore copies data, not configuration. Until rules and indexes are deployed to
it, every client request is denied — which during a recovery reads exactly like
the restore having failed. It has not; it is unconfigured.

Recovery sequence, therefore:

```bash
npx firebase-tools firestore:databases:restore --database restored-YYYY-MM-DD --backup <backupName> --project weehs-4eb28
```

Then, in this order: deploy rules and indexes to the new database → set
`VITE_FIREBASE_DATABASE_ID=restored-YYYY-MM-DD` → rebuild → deploy hosting →
re-enable PITR and delete protection on the new database. Only then is the data
actually back in front of users.

**Stated targets** (previously undeclared, which is its own audit finding):
RPO 7 days worst case (project loss) / near-zero for data errors within the PITR
window. RTO is the ~15-minute restore **plus** the rules-and-redeploy sequence
above — call it under an hour with someone who has read this section, and
several hours without. The 15 minutes scales with data volume, so re-measure it
as tenants grow rather than quoting this number forever.

**Delete protection is now ENABLED**, so the scratch-database cleanup and any
future `firestore:databases:delete` against `(default)` will refuse until it is
consciously disabled:

```bash
npx firebase-tools firestore:databases:update "(default)" --delete-protection DISABLED --project weehs-4eb28
```

Re-run the drill after any change to how the app connects to Firestore, and at
least annually. A backup nobody has restored is a belief, not a control.

## 3b. Composite indexes — audited, complete. Why the file looks too short

`firestore.indexes.json` defines three composite indexes for a twelve-module
app, which looks alarming and has now been raised as a gap twice. It is not one,
and this section exists so it stops being re-raised.

**Firestore builds single-field indexes automatically, ascending and
descending.** A composite index is only required when a query combines an
equality or `in` filter with an `orderBy` on a *different* field (or mixes
inequalities across fields). This app almost never does that: the prevailing
pattern is `query(col, orderBy(x, 'desc'), limit(n))` with filtering done in the
browser. Those need nothing declared.

**Audit method — repeat this rather than eyeballing it.** Grepping is not
sufficient: a query is built across several lines and `where(` nested inside
`query(` defeats a naive regex, which on the first attempt produced the
confident and completely wrong answer of "zero compound queries". Match
parentheses instead:

```bash
node -e "const fs=require('fs'),p=require('path');const F=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,e.name);if(e.isDirectory()){if(e.name!=='node_modules')w(q)}else if(/\.(js|jsx)$/.test(e.name)&&!/\.test\./.test(e.name))F.push(q)}})('src');for(const f of F){const s=fs.readFileSync(f,'utf8');for(let i=0;i<s.length;i++){if(!s.startsWith('query(',i)||/[A-Za-z0-9_$.]/.test(s[i-1]||''))continue;let d=0,j=i+5;for(;j<s.length;j++){if(s[j]==='(')d++;else if(s[j]===')'){d--;if(!d)break}}const b=s.slice(i+6,j);if(/where\(/.test(b)&&/orderBy\(/.test(b))console.log(f+':'+s.slice(0,i).split('\n').length+' '+b.replace(/\s+/g,' ').slice(0,160))}}"
```

As of 2026-08-16 it prints exactly one site: `src/modules/documents/lib/service.js`,
which emits `visibility == 'all'` and `siteId in [...]`, each with
`orderBy('createdAt','desc')`. Both indexes are declared. Coverage is complete.

**Two things this audit also found, neither urgent:**

- The declared `users` index (`orgId` + `createdAt`) is **unused** — both `users`
  queries filter on `orgId` with no `orderBy`. It costs a little write
  amplification per user document and nothing else. Left in place deliberately:
  removing an index is the kind of change that fails at runtime, in production,
  on the one query nobody remembered.
- The reason the index file is short is the reason the *read* volume is high.
  Avoiding compound queries means reading whole collections (`COLLECTION_READ_CAP`
  = 5000) and filtering client-side. That is the real scaling ceiling, it is
  tracked as S-04 in `SECURITY.md`, and it is a separate piece of work from
  indexing. The app already signals a truncated read (`incompleteReadNotice`)
  rather than silently showing a partial list, which is the important half.

**The standing rule:** any new `query()` that puts a `where` and an `orderBy` on
different fields needs an entry in `firestore.indexes.json` in the same commit.
CI deploys indexes ahead of hosting (`deploy.yml`), so a declared index is live
before the client that needs it — but only if it was declared at all. A missing
one is a `FAILED_PRECONDITION` at runtime that the emulator never reproduces.

## 4. Cloud Storage for files  ⚠️ one console click

The code now uploads new training-content files to Cloud Storage under an
org-scoped path, and falls back to the old inline base64 if the bucket is
unavailable — so nothing breaks before this step, files just stay on the old
path.

⚠️ **Storage does NOT enforce the same tenancy as Firestore.** This section used
to claim it did, which was wrong and is the more dangerous kind of wrong: it
told whoever read it that a boundary existed. `storage.rules` binds nothing to
an org — the `{orgId}` path segment is captured and never checked, because doing
so needs either cross-service Firestore reads or an `orgId` custom claim on the
token, and neither is in place yet. Concretely, any signed-in user of any
tenant can read and delete any other tenant's uploaded files if they know the
path. Uploads are at least safe from being overwritten in place (`update` is
denied outright and every upload lands on a random path).

Closing it needs the custom claim, which needs the Admin SDK — i.e. the
`functions/` tier. The stronger ruleset is already written at the bottom of
`storage.rules`, commented, ready to swap in once claims exist. Until then,
treat file storage as org-scoped by convention only, and do not put anything in
it that would be materially worse in a competitor's hands than the Firestore
records already are.

1. Firebase console → **Storage** → Get started (default bucket, production
   rules — the repo's `storage.rules` deploys over them).
2. `npx firebase deploy --only storage`.

Verify: add a file to a training course; the stored course document should gain
`content[].path` starting with `orgs/…` instead of a multi-hundred-KB `dataUrl`.

Remaining inline-file call sites to migrate onto `shared/storage` the same way
(each is the same ~20-line pattern as `Courses.jsx`): incident photos, illness
attachments, permit documents, drill evidence, LOTO procedure photos, course
thumbnails, quotation uploads.

## 4b. Functions, and closing the storage hole  ⚠️ Blaze plan required

This is what fixes `SECURITY.md` S-01 — any signed-in user of any tenant being
able to read and delete any other tenant's files.

**Why it needs a function at all.** Cloud Storage rules cannot query Firestore,
so they have no way to learn which organization the caller belongs to. The only
thing a Storage rule can read about the caller is their ID token. So the org has
to be *on* the token as a custom claim, and only the Admin SDK can put it there
— which means Cloud Functions.

### First, the plan

Cloud Functions requires the **Blaze** pay-as-you-go plan — this project is already on it. Until then the API is
off and `firebase deploy --only functions` fails with `SERVICE_DISABLED`. This
cannot be done from the CLI — it needs a billing account attached:

Firebase console → **⚙️ → Usage and billing → Details & settings → Modify plan**
→ Blaze. Then enable the Cloud Functions API if prompted.

Two functions this size cost approximately nothing — they fire on profile writes,
not on page loads — but Blaze is still a real billing account, so set a budget
alert while you are in there.

### Then, in this order — the order is the whole point

```bash
npx firebase deploy --only functions --project weehs-4eb28
```

`syncUserClaims` now stamps every future profile write. Existing users still
carry no claim, so next:

Call `backfillClaims` once, signed in as an admin of the org. It is idempotent
and scoped to the caller's own organization. From the browser console of the
running app:

```js
const { getFunctions, httpsCallable } = await import('firebase/functions')
await httpsCallable(getFunctions(undefined, 'asia-south1'), 'backfillClaims')()
```

It returns `{ total, updated, skipped, failed }`. Run it for **every** org in the
project — it does one tenant per call, by design.

Then people need a token carrying the new claim. Signing out and in does it
immediately; otherwise a cached token can be up to an hour stale. The client
forces a refresh on every sign-in (`AuthContext.adopt`), so in practice this
takes care of itself.

⚠️ **Only now** swap in the stricter ruleset — it is written out in full at the
bottom of `storage.rules`. Uncomment it, delete the permissive block above it,
and deploy:

```bash
npx firebase deploy --only storage --project weehs-4eb28
```

Do it in the other order and every user is denied their own files, because a
token with no `orgId` fails every rule in the new set. That is the correct
behaviour — it is just catastrophic if nobody has been stamped yet.

### Verifying it actually closed

Signed in as a member of org A, in the browser console:

```js
(await firebase.auth().currentUser.getIdTokenResult()).claims.orgId
```

should be org A's id. Then try to read a path under another org's prefix — it
must fail. If the claim is `undefined`, the backfill has not reached that user.

## 5. Deploys from CI, and staging  ⚠️ secrets required

`.github/workflows/deploy.yml` deploys hosting + Firestore rules + storage
rules on version tags (`v1.0.0`) after re-running lint and tests. It skips
politely until credentials exist:

1. Console → Project settings → Service accounts → **Generate new private
   key** → GitHub repo → Settings → Secrets → `FIREBASE_SERVICE_ACCOUNT`.
2. Repo → Settings → Variables: the `VITE_FIREBASE_*` values (plus
   `VITE_APPCHECK_SITE_KEY` / `VITE_SENTRY_DSN` once you have them).
3. Release: `git tag v1.0.0 && git push --tags`.

## 5a. Staging  ⚠️ second Firebase project required (Blaze)

`.github/workflows/deploy-staging.yml` exists and ships **every merge to main**
to a separate project. It skips politely until the secret below is set, so
nothing happens until you have created the project. The relationship is: merge →
staging automatically, tag → production deliberately.

**Why every variable is named `STAGING_*` rather than reusing the `VITE_*` ones
through a GitHub Environment.** Repository variables are the *fallback* for
anything an environment does not define. So one missing key or one mistyped name
in a `staging` environment resolves silently to the **production** values — and
this workflow runs on every merge, so it would deploy over production from a
merge commit. Distinct names cannot fail that way: an unset `STAGING_` variable
is empty, and empty stops the run. Uglier names, safer failure.

The workflow refuses to run if `STAGING_FIREBASE_PROJECT_ID` is empty or equal
to `VITE_FIREBASE_PROJECT_ID`, and that refusal is a hard failure rather than a
skip — a skip reads as "staging is not set up yet", and this is the opposite.

**One-time setup:**

1. Firebase console → **Add project** → `weehs-staging`. Upgrade it to **Blaze**;
   Cloud Functions require it, and without functions there are no auth claims,
   so `storage.rules` denies everything and file deletion has no route at all.
2. Add a **Web app** to it → copy the config values.
3. Enable **Authentication → Email/Password**, create **Firestore** and
   **Storage** — pick the same region as production (`asia-south1`) so latency
   and residency behave the same way they will in production.
4. Project settings → Service accounts → **Generate new private key** → GitHub →
   Settings → Secrets → `STAGING_FIREBASE_SERVICE_ACCOUNT`.
5. **Give the staging project its own `DATA_KEY_MASTER`, before the first merge.**
   This step is not optional and it is not cosmetic: `getDataKeys` declares
   `defineSecret('DATA_KEY_MASTER')`, Firebase resolves declared secrets at
   *deploy* time, and this workflow deploys functions with `--non-interactive` —
   so a missing secret is a hard error, not a prompt. Functions are the FIRST
   deploy step, so the whole run fails and nothing ships.

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx firebase functions:secrets:set DATA_KEY_MASTER --project weehs-staging
   ```

   A **different** value from production, deliberately. Staging is a project with
   weaker access by design, and one master key across both would mean a leak
   there is a leak of every production tenant's records. Nothing is shared
   between the two: keys are per organization and per project, so a distinct
   master costs nothing and contains the blast radius.
6. GitHub → Settings → **Variables**, from the web app config in step 2:

```
STAGING_FIREBASE_PROJECT_ID          # must NOT equal the production id
STAGING_FIREBASE_API_KEY
STAGING_FIREBASE_AUTH_DOMAIN
STAGING_FIREBASE_STORAGE_BUCKET
STAGING_FIREBASE_MESSAGING_SENDER_ID
STAGING_FIREBASE_APP_ID
STAGING_APPCHECK_SITE_KEY            # optional
STAGING_SENTRY_DSN                   # optional — see below
STAGING_ENCRYPTION                   # off | on
```

7. Merge anything to `main` and watch the run. It prints the resolved target
   before deploying, so the first thing to check is that it names the staging
   project.

**`STAGING_ENCRYPTION=on` is the point of having staging at all.** Production
ships with sealing off, so staging is the only place the encryption path gets
exercised before customer data depends on it — a real callable, a real keyset
minted on first sign-in, a real backfill run over seeded records. Turning it on
in production without that rehearsal means the first time `getDataKeys` is
called for real is against live health records.

Note that the same variable is missing for production: `VITE_ENCRYPTION` is read
by `deploy.yml` but no repository variable of that name exists yet, so a
production tag today builds with sealing off regardless of what `.env.production`
says locally. That is correct for now and will be the thing that silently does
nothing on the day it is meant to be switched on.

**Give staging its own Sentry DSN, or none.** Sentry tags each event with
`import.meta.env.MODE`, which is `production` for any `vite build` — staging
included. Pointing staging at the production DSN therefore files staging noise
in the production inbox *under the production label*, and the first thing it
costs is trust in the alerts. Leaving `STAGING_SENTRY_DSN` unset ships no Sentry
at all, which is a fine default.

**Never copy production data into staging.** This system holds injuries,
illnesses and medical records; a copy in a project with weaker access is a
second place to breach and it is not covered by any consent the data was
collected under. Seed synthetic data instead.

Note what that does **not** mean, because this runbook implied otherwise and it
cost time during the staging build-out: `scripts/seed.mjs` and
`scripts/seed-injury.mjs` are **emulator-only**. They hardcode
`projectId: 'ohsms-demo'` and call `connectFirestoreEmulator`, so they cannot
populate a real project at all. Only the scripts built on
`scripts/_firebase.mjs` read the `VITE_*` variables and can target one, and
that file refuses a real project without `--prod`.

For a fresh staging project the practical path is the app's own sign-up: the
first user becomes admin of a new organization, which is the real onboarding
flow and a better rehearsal than a seed anyway.

**What staging is for, concretely:** it is where the ordering hazards in §0b and
§0c get rehearsed against a real project rather than an emulator — rules before
hosting, functions before rules, backfill before rules — and where a restore
drill (§3a) can be run without touching anything a customer depends on.

Stop using `firebase deploy` from a laptop for anything but emergencies.

## Known gaps this runbook does not cover

- Composite Firestore indexes: **audited 2026-08-16, complete — no action.**
  See §3b for the method and the standing rule, because the low count in
  `firestore.indexes.json` invites this being raised again as a gap. It is not.
- Admin accounts have no MFA (email/password only).
- LOTO's collections live outside the org tenancy model.
- Three dependency advisories are knowingly open, so `npm audit` is not expected
  to come back clean. Check new findings against this list rather than assuming
  the noise is the usual noise:
  - **jspdf 2.5.2** (rated critical) and **jspdf-autotable 3.8.4**. The fixes are
    two major versions up on each and need a migration. Most of the advisories —
    `AcroForm`/`addJS` arbitrary JS execution, HTML injection, path traversal —
    are unreachable because the app never calls those APIs. What is reachable is
    `addImage` in `src/modules/loto/utils/pdf.js`, which takes user-uploaded
    procedure photos: a crafted BMP/GIF hangs the tab of whoever generates the
    PDF. Client-side DoS by an authenticated member, not disclosure.
  - **xlsx 0.18.5**, no fix on npm — SheetJS publishes to its own CDN now. The
    prototype-pollution sink was tested and is unreachable; the ReDoS is, but
    only against a workbook the user chose to open in their own browser.
  - `undici` is pinned in `overrides` because Firebase holds it at a vulnerable
    version. It never reaches the browser bundle, so the pin keeps `npm audit`
    readable rather than closing a hole in the shipped app.

## 9. API key restrictions  ⚠️ console required

The `AIzaSy…` key in the client bundle is a **Firebase Web API key**, not a
secret. It ships in every Firebase web app by design — it names the project so
Google knows which one a request belongs to — and it cannot be removed from a
browser without the app losing its ability to reach Firebase at all. Anything
that appears to hide it (obfuscation, a proxy, an env indirection) leaves it
visible in the network tab and buys nothing.

What stops it being useful to somebody else is `firestore.rules` and
`storage.rules`: the key lets a caller ADDRESS the project, the rules decide
what they may read or write. That is the control, and it is the one this
codebase invests in.

There is still a worthwhile restriction to apply, and it is console-only.

**Firebase Web API key** — Google Cloud console → APIs & Services →
Credentials → the browser key:
1. *Application restrictions* → **HTTP referrers**, and list only
   `weehs-4eb28.web.app/*` and `weehs-4eb28.firebaseapp.com/*` (add a staging
   host when one exists). A key lifted from the bundle then fails from anywhere
   else, which removes the quota-abuse and phishing-clone uses of it.
2. *API restrictions* → **Restrict key**, and select only what the app calls:
   Identity Toolkit, Token Service, Firestore, Cloud Storage, and — while the
   map is in use — Maps JavaScript.

**Maps JavaScript key** — restrict the same way. This one is billable, so an
unrestricted key is somebody else's map bill. Tracked as S-05 in SECURITY.md.

Neither restriction changes anything in this repository, and neither is a
substitute for the rules. They bound what a copied key can be pointed at.

## 10. Bucket CORS — required before authenticated file reads take effect

`getDownloadURL` mints a URL with a permanent `token` parameter. That token is a
bearer credential in a string: it works unauthenticated, forever, for anyone who
obtains it, and `storage.rules` is never consulted. Once such a URL is stored in
a Firestore document, anyone who can read that document can copy it out, and it
keeps working after they leave the organization.

`shared/storage.fileUrl` / `useFileUrl` prefer an authenticated fetch by `path`
instead, which `storage.rules` governs. That fetch needs a bucket CORS rule that
`<img src>` never required — until it is set, `resolve()` returns null and the
app silently falls back to the stored URL. So this is inert, not broken, on a
bucket without CORS.

To turn it on:

```bash
printf '[{"origin":["https://weehs-4eb28.web.app","https://weehs-4eb28.firebaseapp.com"],"method":["GET"],"maxAgeSeconds":3600,"responseHeader":["Content-Type"]}]' > cors.json && gsutil cors set cors.json gs://weehs-4eb28.firebasestorage.app
```

Then migrate render sites to `useFileUrl` module by module, checking images still
appear after each. Records written before uploads recorded a `path` keep using
the stored URL permanently — only re-upload closes those.

---

## 11. Application-layer encryption  ⚠️ secret required BEFORE the switch

> ### LIVE IN PRODUCTION SINCE 2026-08-16 (v1.1.1)
>
> | | |
> |---|---|
> | Sealing new writes | **yes** — `VITE_ENCRYPTION=on` |
> | Production org | `WYI4ZEQIM5Sew3XqPM9d`, keyset minted 17:18 UTC |
> | `DATA_KEY_MASTER` (prod) | version 1, ENABLED, **never rotated** |
> | Staging | `weehs-staging`, its own distinct master key |
> | History (Firestore) | **still plaintext — backfill not run** |
> | History (bucket objects) | **still plaintext — backfill not run** |
>
> **The two backfills have not been run against production.** Every incident,
> injury, illness, meeting, drill, photo and attachment stored before
> 2026-08-16 is readable in the database and the bucket. Sealing new writes
> closed the door; it did nothing about what was already through it. Both jobs
> are on the Maintenance page and both are idempotent.
>
> **The switch takes effect per browser, not per estate.** Anyone with the app
> already open keeps writing plaintext until they reload, so a backfill run
> immediately after the switch seals what exists and leaves a trickle behind
> it. Run it a day later, once people have cycled onto the new bundle.
>
> **`DATA_KEY_MASTER` has no rotation date and no named owner.** Losing it
> destroys every sealed record in the tenant — it is not derived from anything
> and the wrapped keys in Firestore are useless without it. Secret Manager
> keeps versions; never disable version 1 until a rotation has been verified
> against real data. Record the owner here when one is agreed.
>
> **What was verified before the switch**, on staging against a live project
> and then in production: the keyset mints exactly once inside a transaction;
> an admin receives the medical private key and a member receives only the
> public half (`medicalPrivate: false` in the logs); writes seal under the
> right scheme per class (`enc:` general, `enk:` medical); a malformed master
> key is refused before any data is sealed; the record backfill sealed four
> plaintext records with zero failures and was a no-op on re-run; and a sealed
> photo renders in both the gallery and the exported PDF.
>
> **What was NOT verified before the switch:** the object backfill
> (`sealStoredObjects`) has never run anywhere. It deletes the plaintext
> original after verifying the sealed copy, so a first run against real photos
> is also its first real test. Upload one disposable photo, run the job, and
> confirm it still renders before trusting it with history.


The sensitive fields listed in `src/shared/crypto/policy.js` are sealed in the
browser before they reach Firestore. Two keys per organization, generated on
first use and stored wrapped in `organizations/{orgId}/meta/cryptoKeys`, which
no client rule grants any access to.

**What this protects against, and what it does not.** It stands between the data
and everything that reaches the *store* rather than the app: an exported backup,
a bucket left open, a support engineer with project Viewer, and the next rule
that turns out to be one `match` too wide. It does **not** put the data beyond
this project — whoever holds `DATA_KEY_MASTER` and the Firestore documents can
recover every key. That is the deliberate trade: a zero-knowledge scheme would
also put occupational injury records beyond recovery when an administrator
forgets a passphrase, and those carry a statutory minimum retention.

The one boundary it enforces *inside* the app is the medical class. `/injuries`,
`/injuries/records` and `/illnesses` are `allow read: if isManagerOf(orgId)`
while their writes come through the generic `isWriterOf` rule — a member files a
colleague's injury and cannot read it back. That class is therefore an RSA
keypair, not a shared secret: the public half goes to writers, the private half
only to admin and manager. An auditor is refused it by the same test that
refuses them the documents, so if that rule is ever widened by accident they get
ciphertext instead of a named colleague's medication.

### Setup, in order

**1. Mint the master secret.** Once per project. Everything else depends on it.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | firebase functions:secrets:set DATA_KEY_MASTER
```

> **Losing this value destroys every sealed record in every tenant.** It is not
> derived from anything and cannot be recovered from the database — the keys in
> Firestore are wrapped under it. Secret Manager keeps versions; never disable an
> old version until the rotation replacing it has been verified against real
> data. Record the rotation owner here alongside the App Check notes in §1.

**2. Deploy the rules and the callable.** Rules first, for the same reason as
§0b: the rules change is what stops a member overwriting a tenant's keyset.

```bash
firebase deploy --only firestore:rules,functions:getDataKeys
```

**3. Verify before switching anything on.** Sign in as an admin and confirm the
callable answers. It creates the keyset on first call, inside a transaction, so
the first sign-in of each organization is what mints its keys.

```bash
firebase functions:log --only getDataKeys
```

Look for `crypto: keyset created` then `crypto: keys released`. A
`permission-denied` here means the caller is not an approved member; a
`failed-precondition` means their profile names no organization.

**4. Turn writing on.** Only now, and per environment:

```
VITE_ENCRYPTION=on
```

Then rebuild and deploy hosting. New writes are sealed from that moment.

### Rolling back

Set `VITE_ENCRYPTION=off` and redeploy. Decryption is always attempted whatever
the switch says, so nothing already sealed becomes unreadable — the app simply
stops sealing new writes. This is a safe rollback at any hour, which is the
whole reason the switch governs writes only.

### 5. Encrypt the history

Turning the switch on seals **new writes only**. Everything already stored stays
readable until it is re-written, and that is two separate jobs on the
**Maintenance** page, in this order:

1. **Encrypt existing records** — the Firestore documents. Runs in the browser
   tab, so leave the page open. Capped per run; run it again until `remaining`
   is zero.
2. **Encrypt existing files** — the bytes in Cloud Storage. Runs as a Cloud
   Function. Also capped, because each file is downloaded and re-uploaded.

Both have a **Check first** button that does the full work and the full
verification without writing, so the numbers it reports are the numbers a real
run would produce. Read `blocked` and `failed` before treating a run as
finished.

Neither can lose data. The record job decrypts each sealed copy and compares it
field by field against the plaintext *before* overwriting; the file job writes
the sealed object to a new path and downloads it back before deleting the
original. Anything that fails either check is left exactly as it was and
reported.

### Two things the go-live proved that this runbook had wrong

**Piping a secret from PowerShell corrupts it.** `DATA_KEY_MASTER` was first set
on staging with a PowerShell pipe, which encodes text as UTF-16 — so a
43-character key arrived as 94 bytes and `getDataKeys` refused it on first use.
Use **Git Bash**, and `process.stdout.write` rather than `console.log` so no
trailing newline travels with it:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx firebase-tools functions:secrets:set DATA_KEY_MASTER --project <project>
```

That refusal is the most valuable line in `functions/lib/dataKeys.js`. Had
`masterKey()` stretched or truncated the value instead, records would have been
sealed under a key nobody could reproduce, and it would have surfaced weeks
later.

**A `defineSecret` breaks the first functions deploy on any new project.**
Firebase resolves declared secrets at *deploy* time, so the deploying service
account needs `secretmanager.secrets.get` before `getDataKeys` can ship —
`roles/secretmanager.admin`. Production's account had never deployed a function
and failed on exactly this. Grant it before tagging, not after.

Two adjacent traps on a brand-new project, both hit on staging: the App Engine
default service account may not exist until an App Engine app is created, and
the first 2nd-gen deploy provisions a source bucket and Eventarc agents that can
fail once and succeed on retry. Retry before diagnosing.

### What is NOT covered

`/users` is not sealed at all. Names there are load-bearing for sign-in,
provisioning and the rules themselves — see `docs/SECURITY.md` S-07.

A `getDownloadURL` handed out before an object was sealed is a permanent bearer
link that answers to no rule. Deleting the plaintext stops that link working,
which the file job does — but nothing recalls a copy somebody already
downloaded.
