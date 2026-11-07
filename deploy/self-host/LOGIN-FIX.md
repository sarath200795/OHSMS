# Company sign-in

Do not copy `docker-compose.yml`, `minio/`, `secrets/`, `Dockerfile`, or
`app/stack/`. Those stay as they are. Do not run `docker compose down` or
`down -v`.

The sign-in entry is already on the running host:

http://127.0.0.1:8787/auth/start

That address builds the SAML request and redirects to Keycloak. The
password is typed on the Keycloak page, not in the app email form. Opening
Keycloak directly skips the request this app has to send.

`/login` on the current image still shows the email form. This archive
replaces only `app/dist/`. After the app image is rebuilt, `/login` follows
the same start address and does not show the email form.

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:8787/auth/start
```

The two `ps -q` lines should print the same three ids. A `302` whose
redirect starts with `http://127.0.0.1:8080/` is the identity provider.
This image was not started here, and the browser sign-in was not run.
