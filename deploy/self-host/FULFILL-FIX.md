# Fulfill the existing registration

Do not copy `docker-compose.yml`, `minio/`, `secrets/`, or `Dockerfile`.
Do not run `docker compose down` or `down -v`.

The 500 was fulfillment treating the public name `ohsms` as a leaked
secret, because that name is both the MinIO user and the SAML client id
and it also appears in the issuer URL. The organization write now happens
only after that check. A second submit for the same name returns the
existing organization instead of creating another.

If a later step still throws, the form and `GET /registration-status`
include `stage` and `code`. Those are a step name and a SQLSTATE. They
are not a database URL, a password, an email, or a token. The app log
line is `registration <reason> test stage=<stage> code=<code>`.

Copy `app/stack/server.mjs` and `app/stack/fulfill.mjs` over the existing
files. Replace `app/dist/` with this archive’s `app/dist/`.

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS http://127.0.0.1:8787/health
curl -fsS --get --data-urlencode 'name=test' http://127.0.0.1:8787/registration-status
```

The two `ps -q` lines should print the same three ids. If status is
`live`, submit the form once and it reports that organization. If status
is `failed` or `absent`, submit once. Do not submit a second time while
the first is still on screen.

This was reproduced with embedded Postgres and the host’s secret shape.
Docker, Keycloak, and MinIO were not started here.
