# Console hardening — operator checklist

App Check, MFA, API key restrictions, and backups are **console state**.
Nothing in this repository fails CI if one of them is switched off later
(`docs/SECURITY.md` S-05). Re-checking them is an operator job, not a pull
request.

This file is the checklist with **exact console paths**. It does not name the
live project id, the billing account, or a copy-pasteable `curl` against a
write endpoint. Those stay in the private production runbook
(`docs/PRODUCTION.md` is the pointer).

A machine-readable reminder that prints the same steps (and, if you already
have local `gcloud` / Application Default Credentials, a few read-only
probes) is:

```bash
node scripts/report-console-hardening.mjs
```

It never writes, never needs a secret committed to git, and exits 0 when it
could only print the checklist.

Do this on a calendar (quarterly is the minimum that matches "periodic
review" in S-05), and after anyone else is given Owner/Editor on the
project.

---

## 1. App Check — Firebase console

**Authentication / product:** Firebase console → the production project →
**App Check**.

Check, in this order:

1. The **web app** is registered (the same app whose config is in the private
   `.env.production`).
2. A provider is **enforced**, not only registered — reCAPTCHA Enterprise or
   reCAPTCHA v3, whichever was chosen when S-05 closed.
3. Enforcement is on for the products the public QR surfaces actually write:
   **Cloud Firestore**, **Cloud Storage**, **Cloud Functions** (the public
   report/observation paths). A registered-but-not-enforced app is the
   default and is not a control.
4. Debug tokens exist only for emulators / CI, not as a permanent bypass.

Turning App Check off does not weaken `firestore.rules`. It removes the only
volume control those anonymous write surfaces have.

## 2. MFA (TOTP) — Firebase console + Identity Platform

Two different switches; do not mix them up.

| What | Where | What "on" means |
|---|---|---|
| **Console MFA (S-05)** | Firebase console → **Authentication** → **Sign-in method** → **Advanced** / Multi-factor, **or** Google Cloud console → **Identity Platform** → **Providers** → **Multi-factor authentication** | An enrolled user is challenged at **sign-in**. |
| **Rules MFA (M-3)** | `firestore.rules` → `requireAdminMfa()` | An admin token without `sign_in_second_factor` cannot administer the tenant. **This is `return false` today.** Do not flip it until every admin has enrolled TOTP **and signed in again**. Hygiene fails if the constant is not `false`. |

Checklist for the **console** half:

1. TOTP is enabled as a second factor.
2. Enrolment is available to users (Settings → Security in the app; Firebase
   refuses enrolment on an unverified email).
3. At least the operator/admin accounts show a second factor under
   Authentication → Users → the user → **Multi-factor**.

Do **not** complete M-3 (the rules lock) from this checklist. Enrolment is
the gate; a lock without enrolment locks the tenant.

## 3. API key restrictions — Google Cloud console

Google Cloud console → **APIs & Services** → **Credentials** → the **Browser
key** that the SPA ships (the `VITE_FIREBASE_API_KEY` value).

1. **Application restrictions** → HTTP referrers. Production hosting origin
   and `localhost` (for emulator work) only. No `*` .
2. **API restrictions** → restrict to the APIs this app actually calls
   (Identity Toolkit, Firestore, Storage, etc.). A key that can also spin up
   Compute is the default and is wrong.
3. There is no second "server" key in this repository. If one exists in the
   console for Functions, it is not committed here; confirm it is not in
   git (`git grep` for `AIza` on the working tree if you are unsure).

Staging origins belong on the staging key / staging project, not as an extra
referrer on the production key.

## 4. Backups — Google Cloud console

Google Cloud console → **Firestore** → **Import/Export** and **Disaster
recovery** (PITR):

1. **Point-in-time recovery** is enabled. Window is 7 days unless counsel
   asked for otherwise.
2. A **scheduled export** exists (weekly, 30-day bucket retention, as S-05
   recorded). Confirm the destination bucket is in the same project and is
   not world-readable.
3. **Delete protection** is on for the Firestore database.
4. The last restore **drill** date is recorded in the private runbook. A
   backup nobody has restored is a belief. Do not invent a drill date in
   this public file.

## 5. After the walk

Tick the date in the private register, not here. If anything is off, treat
it as an incident: console state drifted, and S-05's whole point was that
git cannot see that.

Related: `docs/PLATFORM-CONSOLE.md` is the **product** console at
`/platform` (module entitlements), not Google Cloud. Different checklist.
