# Recognize the provisioned owner

Do not copy `docker-compose.yml`, `minio/`, `secrets/`, or `Dockerfile`.
Do not replace `app/stack` as a whole. Do not recreate the Keycloak
container. Do not run `docker compose down` or `down -v`. Do not create
another organization, and do not open Postgres yourself.

The approval page is the signed-in profile. It appears when that profile's
status is not `approved`, and the blank administrator name is
`profile.orgName`, which fulfillment never copied onto the founder. The
registration contact is the owner. The host keeps that assignment and, on
startup and on that person's own profile read, writes `approved`, `admin`,
the organization, and its name onto their row only. A member stays pending.
A profile that already belongs to a different organization is not moved.
A SAML sign-in with no invite is still refused.

Sign out on that page asks the identity provider first, then leaves. It no
longer clears the session and immediately starts another sign-in. If the
identity provider does not answer, the browser goes to
`/login?signedOut=1`, which shows the company sign-in link and does not
redirect by itself.

Copy these over the same paths:

- `app/stack/engine.mjs`
- `app/stack/fulfill.mjs`
- `app/stack/identity.mjs`
- `app/stack/ownerGrant.mjs`
- `app/stack/schema.sql`
- `app/stack/self-host.mjs`
- `app/stack/server.mjs`
- `app/dist/` (replace the directory)

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS http://127.0.0.1:8787/health
```

The three container ids for Postgres, MinIO, and Keycloak should be
unchanged. Reload http://127.0.0.1:8787/ . The registration contact for the
live organization should land in the product. Someone else stays on the
approval page. Sign out on that page returns to company sign-in without
starting it again. This host was not started here, so that browser sign-in
was not run.
