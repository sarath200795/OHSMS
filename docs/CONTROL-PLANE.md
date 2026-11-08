# Running a company on its own database (deploying a dedicated environment)

WEEHS normally runs on the shared Firebase project. A company that chooses
**Use your own database** at registration instead gets a **dedicated
environment**: its own web address, its own Postgres database, its own sign-in
(company SAML, OIDC or Supabase Auth) and its own file store. No WEEHS Firebase
account is created for its users.

This guide deploys one dedicated environment on **Google Cloud Run** with a
**managed Postgres**. The design and its reasoning are in
[`CUSTOM-STACK.md`](CUSTOM-STACK.md); this file is the procedure.

> Everything below uses placeholders (`PROJECT`, `REGION`, `ehs.example.com`).
> Keep your real project ids, hostnames and tokens out of this repository: it
> is public ([`AGENTS.md`](../AGENTS.md)).

## 0. What you are deploying

One container, built from `stack/Dockerfile`, per company. It is three things
on one origin:

- the **control plane** for that company: it takes the provisioning request,
  emails the one-time secret-handoff link, and fulfils the request;
- the **gateway** the app talks to (`/data`, `/presign`, `/rpc`, sign-in),
  enforcing tenancy with Postgres row-level security;
- the **app**. The same build serves every company: the host tells it its
  gateway, sign-in and file store when it loads (`/runtime-config.js`).

**One environment serves one company.** It holds one sign-in configuration;
filing a second company's request on it would replace the first company's
identity provider. Deploy one service per company.

The lifecycle:

1. The company registers on the shared site with **Use your own database**.
   The request appears at `/platform/provisioning`, and operators are emailed.
2. You deploy that company's environment (steps 1–6).
3. You file the request on it (step 7). It emails the company's handoff
   contact a one-time link.
4. The company opens the link and submits its secrets. The environment
   becomes live and emails the founder its address.
5. The company's people sign in at that address with their own IdP.

## 1. Prerequisites

- The `gcloud` CLI, signed in, with a Google Cloud project that has billing.
  It can be the Firebase project or a separate one.
- These APIs enabled: Cloud Run, Cloud Build, Artifact Registry, Cloud SQL
  Admin, Secret Manager.
- From `/platform/provisioning`: the company's request (id, organization,
  contact, hosting mode, sign-in method, issuer URL, client id, bucket choice).
- The web address the company will use, for example `https://ehs.example.com`.
  It is a deploy setting (`PUBLIC_ORIGIN`, step 5), not part of the image.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com
```

## 2. Database

Any Postgres 14+ works (Cloud SQL, Supabase, Neon, AlloyDB, your own). Cloud SQL
is shown.

```bash
gcloud sql instances create ehs-COMPANY --database-version=POSTGRES_16 --region=REGION --tier=db-g1-small
```

```bash
gcloud sql users create ehs_app --instance=ehs-COMPANY --password='A-STRONG-PASSWORD'
```

```bash
gcloud sql databases create ehs --instance=ehs-COMPANY
```

**One-time role setup, as an administrator.** The schema needs two roles:
`ohsms_browser`, which every request from the app runs as and which row-level
security applies to, and `ohsms_worker`, which bypasses it for server jobs. A
managed Postgres does not give your app user the right to create a role that
bypasses RLS, so an administrator creates both once. Connect as the
instance's admin user (on Cloud SQL, `postgres`) and run:

```sql
CREATE ROLE ohsms_browser NOLOGIN;
CREATE ROLE ohsms_worker NOLOGIN BYPASSRLS;
GRANT ohsms_browser, ohsms_worker TO ehs_app;
ALTER DATABASE ehs OWNER TO ehs_app;
```

Then, connected to the `ehs` database as the admin, make the app user own the
`public` schema:

```sql
ALTER SCHEMA public OWNER TO ehs_app;
```

If `CREATE ROLE ... BYPASSRLS` is refused, your provider's admin role cannot
grant it. Use a provider or tier that allows it, or ask the provider; the
environment cannot run without that role. This was verified against Postgres 16
with a non-superuser app role; check it on your provider before the company's
handoff, not during it.

The environment creates its tables and policies itself, as `ehs_app`, every
time it starts.

## 3. Secrets

Create each in Secret Manager. Generate the random ones:

```bash
openssl rand -base64 32 | gcloud secrets create ehs-COMPANY-state-key --data-file=-
```

```bash
openssl rand -hex 32 | gcloud secrets create ehs-COMPANY-control-token --data-file=-
```

```bash
openssl rand -hex 32 | gcloud secrets create ehs-COMPANY-session-secret --data-file=-
```

```bash
openssl rand -base64 32 | gcloud secrets create ehs-COMPANY-data-key-master --data-file=-
```

The database URL, for Cloud SQL over its Unix socket:

```bash
printf 'postgres://ehs_app:A-STRONG-PASSWORD@/ehs?host=/cloudsql/PROJECT:REGION:ehs-COMPANY' | gcloud secrets create ehs-COMPANY-database-url --data-file=-
```

And the SMTP password, if the environment should send mail (the same Brevo
SMTP key the shared site uses works):

```bash
printf 'SMTP-KEY' | gcloud secrets create ehs-COMPANY-smtp-pass --data-file=-
```

| Variable          | What it is                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `STATE_KEY`       | Encrypts the stored handoff secrets. **Losing it loses them**, and the environment refuses to start with a different key. Back it up. |
| `CONTROL_TOKEN`   | The operator's password for filing a request (step 7). Keep it with the operators.                                                    |
| `SESSION_SECRET`  | Signs sign-in sessions. Changing it signs everyone out.                                                                               |
| `DATA_KEY_MASTER` | Wraps the keys for encrypted fields. 32 random bytes, base64 (as above); a hex value is refused at start-up.                          |
| `DATABASE_URL`    | The database from step 2.                                                                                                             |
| `SMTP_PASS`       | Optional. Without mail, the handoff token is returned to you instead (step 7).                                                        |

Allow the Cloud Run service account to read them:

```bash
for s in state-key control-token session-secret data-key-master database-url smtp-pass; do gcloud secrets add-iam-policy-binding ehs-COMPANY-$s --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor; done
```

## 4. Build the image

One image serves every company; nothing about a company is built into it.
Each version tag publishes it to `ghcr.io/OWNER/weehs-dedicated` with a
release page ([`RELEASES.md`](RELEASES.md)); use that image and skip this
step. To build it yourself instead, from the repository root:

```bash
gcloud artifacts repositories create ehs --repository-format=docker --location=REGION
```

```bash
gcloud builds submit --config stack/cloudbuild.yaml --substitutions=_IMAGE=REGION-docker.pkg.dev/PROJECT/ehs/weehs-dedicated:v1 .
```

The sign-in method, gateway and presign endpoint the app uses are read from
the environment at load: the method from the IdP the handoff adopts, the
presign endpoint from the request (the company's own when it brought a
bucket), the gateway from `PUBLIC_ORIGIN`. Before the handoff the sign-in page
says the environment is not set up yet.

## 5. Deploy to Cloud Run

```bash
gcloud run deploy ehs-COMPANY --image=IMAGE --region=REGION --allow-unauthenticated --max-instances=1 --add-cloudsql-instances=PROJECT:REGION:ehs-COMPANY --set-env-vars=PUBLIC_ORIGIN=https://ehs.example.com,SMTP_HOST=smtp-relay.brevo.com,SMTP_PORT=587,SMTP_USER=BREVO-LOGIN,MAIL_FROM='EHS notifications <info@weehs.org>' --set-secrets=STATE_KEY=ehs-COMPANY-state-key:latest,CONTROL_TOKEN=ehs-COMPANY-control-token:latest,SESSION_SECRET=ehs-COMPANY-session-secret:latest,DATA_KEY_MASTER=ehs-COMPANY-data-key-master:latest,DATABASE_URL=ehs-COMPANY-database-url:latest,SMTP_PASS=ehs-COMPANY-smtp-pass:latest
```

- `IMAGE`: an image in your Artifact Registry. Cloud Run does not pull from
  `ghcr.io`, so either build it (step 4) or copy the release image in, by the
  digest on its release page:

  ```bash
  docker pull ghcr.io/OWNER/weehs-dedicated@sha256:DIGEST
  docker tag ghcr.io/OWNER/weehs-dedicated@sha256:DIGEST REGION-docker.pkg.dev/PROJECT/ehs/weehs-dedicated:VERSION
  docker push REGION-docker.pkg.dev/PROJECT/ehs/weehs-dedicated:VERSION
  ```

- **`--max-instances=1` is required.** A sign-in that is half-way through (the
  SAML request id, the OIDC state) is held in the instance's memory; with two
  instances, the return leg can land on the one that did not start it.
- `--allow-unauthenticated` because this is a public website: the company's
  people sign in with their IdP, and the handoff page is opened from an email.
- No mail? Leave the four `SMTP_`/`MAIL_FROM` variables out of
  `--set-env-vars`, `SMTP_PASS=…` out of `--set-secrets`, and `smtp-pass` out
  of the loop in step 3: Cloud Run will not start a revision that names a
  secret which does not exist.
- The service refuses to start, and says which setting, if any of the required
  ones is missing or too short. Read the log if the deploy reports an unhealthy
  revision.

## 6. Point the company's address at it

```bash
gcloud beta run domain-mappings create --service=ehs-COMPANY --domain=ehs.example.com --region=REGION
```

Add the DNS records the command prints. `PUBLIC_ORIGIN` must be exactly this
address: the handoff link, the sign-in redirect and the app's API calls are all
built on it, and an `http` origin is refused.

Check it:

```bash
curl -s https://ehs.example.com/health
```

It answers `{"ok":true}`, and `https://ehs.example.com/` shows the sign-in
page with **Continue with company sign-in**. Signing in answers "not
configured" until step 8: there is no IdP yet.

## 7. File the request

Copy the request from `/platform/provisioning` into a file, `request.json`,
with exactly these fields (the id is the one shown there):

```json
{
  "id": "REQUEST-ID",
  "status": "requested",
  "orgName": "…",
  "address": "…",
  "contactName": "…",
  "contactEmail": "…",
  "handoffContact": "…",
  "mode": "bring",
  "engine": "postgres",
  "authMethod": "saml",
  "authIssuer": "https://…",
  "authClientId": "…",
  "bucketMode": "bring",
  "bucketName": "…",
  "bucketRegion": "…",
  "presignUrl": "https://…"
}
```

Then, with the control token from step 3:

```bash
curl -s -X POST https://ehs.example.com/requests -H "Authorization: Bearer $CONTROL_TOKEN" -H 'Content-Type: application/json' --data @request.json
```

- With mail configured, the answer is `{"ok":true,"emailed":true,…}` and the
  handoff contact has the one-time link.
- Without mail, the answer carries a `token`, shown this once. Send the
  contact `https://ehs.example.com/handoff?request=REQUEST-ID&token=TOKEN` over
  a channel you trust. Anyone with that link and the contact's email can
  submit the secrets.

## 8. The company submits its secrets

The handoff contact opens the link, enters their email, and fills in what
their sign-in needs:

| Sign-in  | Fields                                                            |
| -------- | ----------------------------------------------------------------- |
| SAML     | **SAML IdP certificate** and **SAML entry point** (both required) |
| OIDC     | **OIDC client secret**                                            |
| Supabase | **Supabase anon key**                                             |

plus, if they brought a bucket, the S3 keys. Leave the **DATA_KEY_MASTER**
field empty: this environment uses the `DATA_KEY_MASTER` deployed with it in
step 5, and a value typed here is not used. The SAML certificate can be pasted
as-is; a lost line break is fine.

On success the page says **Organization is live**, shows the address, and the
founder is emailed that it is ready. The founder's email is invited as the
organization's administrator.

In the company's IdP, register this environment as the application:

- SAML: ACS URL `https://ehs.example.com/auth/saml`, entity id / audience =
  the request's client id.
- OIDC: redirect URI `https://ehs.example.com/auth/callback`.

## 9. First sign-in

The founder opens `https://ehs.example.com`, chooses **Continue with company
sign-in**, signs in at their IdP, and lands in the portal as administrator.

## 10. Invite the rest of the company

Signing in with the company's IdP proves who someone is, not that they belong
in this environment or with what role — an IdP usually holds the whole
company, contractors included. So people are invited first.

1. An administrator opens **Employees** and chooses **Invite employee**.
2. They enter the person's work email (the address the IdP will report for
   them), an optional name, and a role: Admin, Manager / Safety Officer,
   Member or Auditor.
3. The person is emailed (when mail is configured) and signs in at the
   environment's address with **Continue with company sign-in**. Their first
   sign-in turns the invite into an account with that role.

Pending invites are listed in the same dialog and can be withdrawn; a
withdrawn address can no longer sign in. Someone the IdP authenticates but
nobody invited is told there is no account on this organization. Only an
approved administrator can invite, list or withdraw, and that is re-checked on
every call, so an admin demoted mid-session loses it immediately. An existing
member's role is changed in the Employees list, not by inviting them again.

## Updating an environment

Rebuild with a new tag (step 4) and deploy it (step 5). Requests, handoffs and
the sign-in configuration are in the database and survive; the schema is
re-applied at start and is idempotent. Keep `STATE_KEY` and `SESSION_SECRET`
unchanged across deploys.

## Known limits — read before promising a company a date

- **OIDC providers must vouch for the email.** The host reads the provider's
  discovery document, so Okta, Microsoft Entra, Google, Keycloak and others
  work. Invites are matched by email, so a sign-in whose provider marks the
  address unverified (`email_verified: false`) is refused. With Microsoft
  Entra, register the application as **single-tenant** (your organization
  only): a multi-tenant registration admits accounts from other tenants whose
  email address nobody verified.
- **"WEEHS provisions a bucket" is not served.** The presign answer points at a
  `/blob` route this host does not implement. Have the company bring a bucket
  and a presign endpoint (`docs/CUSTOM-STACK.md`, "Files").
- **The database URL submitted on the handoff page is stored, not used.** The
  environment connects to the `DATABASE_URL` it was deployed with. For a
  company that brings its own database, that connection string goes into the
  deploy secret (step 3), arranged with the company directly.
- **One instance.** `--max-instances=1`, as above.
- **The shared site does not learn the outcome.** The request at
  `/platform/provisioning` stays `requested` after the environment goes live.
- **Mail from the environment** is plain text and uses the SMTP settings given
  at deploy; without them the operator relays the handoff link.

## Testing locally

The policy tests can run against a real Postgres as well as the embedded one:

```bash
OHSMS_TEST_PG_URL=postgres://ehs_app:PASS@127.0.0.1:5432/ehs OHSMS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/ehs npx vitest run src/shared/data/adapters/postgres.rls.test.js
```

`src/shared/data/controlPlane.test.js` runs the whole deployed path — filing,
handoff, restart, SAML sign-in, member reads — on an embedded database set up
the way a managed one is (an ordinary app role, the two roles made by an
administrator), so CI catches what only appears without superuser.
