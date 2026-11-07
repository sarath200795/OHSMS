# Rebuild only the app image

Postgres, MinIO, and Keycloak are already running. This delta does not
replace them. Do not copy `docker-compose.yml`, `minio/`, or `secrets/` from
any archive over the install. The compose file already in
`/Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host` is
the MinIO source build and stays.

The running app image exits before it listens:

`ERR_MODULE_NOT_FOUND: Cannot find module '/app/functions/lib/fileDelete.js'`

`presign.mjs` and `workers.mjs` import that tree at load. The files below
are the whole relative closure, not a stub for the one missing path.
`retentionPolicy.js` also needs `subjectData.js`. The Dockerfile `COPY
app/functions` is what puts them in the image. Adding the files without
replacing `Dockerfile` leaves the next build on the old copy list.

From the install directory, copy only:

- `Dockerfile` over the existing `Dockerfile`
- `app/functions/lib/*.js` onto `app/functions/lib/`

Leave `app/dist`, `app/stack`, `secrets/`, `minio/`, and `docker-compose.yml`
as they are. Do not run `node bootstrap.mjs` again.

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
docker compose ps -q postgres minio keycloak
docker compose build ohsms
docker compose up -d --no-deps --force-recreate ohsms
docker compose ps -q postgres minio keycloak
curl -fsS http://127.0.0.1:8787/health
```

The two `ps -q` commands should print the same three ids. `build ohsms`
rebuilds `ohsms-self-host-ohsms:latest` only. `--no-deps` does not recreate
Postgres, Keycloak, or MinIO. `pgdata` and `miniodata` are not removed.

`/health` is the app. MinIO stays `http://127.0.0.1:9000/minio/health/live`.
Keycloak stays `http://127.0.0.1:9002/health/ready`.

This archive was checked by importing `stack/self-host.mjs` from a temp
directory that contained only the closure. Docker is not available where
the archive was packed, so this image was not built or started here, and
SAML login, logout, and object upload were not run.
