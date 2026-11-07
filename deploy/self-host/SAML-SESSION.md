# Finish the Keycloak re-authentication

Do not copy `docker-compose.yml`, `minio/`, `secrets/`, `Dockerfile`, or
replace `app/stack` as a whole. Do not recreate the Keycloak container.
Do not run `docker compose down` or `down -v`.

"Please re-authenticate to continue" is Keycloak's own message. It appears
only when a SAML request has ForceAuthn and Keycloak already has a session
cookie. The name form created that cookie. ForceAuthn stays on: the password
on that screen is the fresh sign-in. It is not typed into the app.

After that password, Keycloak posts the SAML response to the app. The app
put the session in the URL hash, then sent the browser to `/login`, which
immediately started another ForceAuthn. That is why the same prompt came
back. The hash is now read before that navigation. On startup the app also
clears a finished profile prompt in Keycloak without sending the password
again. Names already stored are left as they are.

Copy these over the same paths:

- `app/stack/keycloakAdmin.mjs`
- `app/stack/self-host.mjs`
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
unchanged. Then open http://127.0.0.1:8787/auth/start once. If Keycloak
shows the re-authenticate screen, enter the password once on that screen.
This host was not started here, so that browser sign-in was not run.
