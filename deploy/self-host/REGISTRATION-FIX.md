# Rebuild only the app after the registration check

Postgres, MinIO, and Keycloak stay up. Do not copy `docker-compose.yml`,
`minio/`, or `secrets/` from this archive. Do not run `docker compose down`
or `down -v`.

The form was prefilled with `http://127.0.0.1:8080/realms/ohsms` and
`http://127.0.0.1:8787/presign`, then rejected them because submit used the
hosted https rule. Those two addresses are accepted only when
`VITE_CONTROL_PLANE=local` is injected, which `/stack-env.js` does before
the bundle runs. Any other host, a password in the URL, or a query string
is still refused. The server applies the same rule on `POST /requests`.

From the install directory, copy only:

- `Dockerfile` over the existing `Dockerfile`
- `app/stack/server.mjs` over the existing file
- `app/src/shared/org/provisioningSchema.js` onto that path
- `app/dist/` over the existing `app/dist/` (replace the directory so the
  page is this build, not the previous bundle)

Leave `docker-compose.yml`, `minio/`, `secrets/`, `app/functions/`, and
`app/stack` other than `server.mjs` as they are.

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS http://127.0.0.1:8787/health
```

The two `ps -q` lines should print the same three ids. `build ohsms`
rebuilds `ohsms-self-host-ohsms:latest` only. Then open
http://127.0.0.1:8787/register-org and file the request. The issuer and
presign already shown are the ones to keep.

This archive was not started under Docker. SAML login, logout, a fresh
login, and an object upload were not run here.
