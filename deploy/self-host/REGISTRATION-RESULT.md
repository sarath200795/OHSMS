# Registration result on the existing app

Do not copy `docker-compose.yml`, `minio/`, `secrets/`, or `Dockerfile`.
Do not run `docker compose down` or `down -v`. Do not submit the form
again until the checks below have been read.

The click that stayed on the form had finished. A refusal was only a toast,
and that toast leaves after a few seconds. The new page keeps the result
above the button. A second submit for a name that is already live shows
that organization and does not create another one.

## What the first click stored

From the install directory. These print counts only.

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT count(*) FROM documents WHERE path = '\''organizations'\'';"'
docker compose exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT count(*) FROM invites;"'
docker compose exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT count(*) FROM documents WHERE path = '\''users'\'';"'
```

`0` on the first query means no organization row was stored. A missing
`documents` table means the same. After this image is up, submit once.

A number other than `0` on the first query means an organization row
exists. Do not expect a second one. After this image is up, submit once:
the page reports the existing organization.

The password stays in the container. Do not add it to the command, and do
not paste `compose.env` or a connection string.

## Replace only the app

Copy `app/stack/server.mjs` over the existing file. Replace `app/dist/`
with this archive’s `app/dist/`.

```sh
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS http://127.0.0.1:8787/health
curl -fsS --get --data-urlencode 'name=test' http://127.0.0.1:8787/registration-status
```

The two `ps -q` lines should print the same three ids. The status body is
`absent`, `running`, `failed`, or `live`. It has no database URL, password,
or token. `failed` with `identity` means the identity provider refused and
no organization was saved. `live` means do not create another.

Then open http://127.0.0.1:8787/register-org and submit once. The result
stays on the page.

Docker was not available where this archive was built. Keycloak and MinIO
were not started here. SAML login through Keycloak and an object upload
were not run on that machine.
