# Replace only the MinIO image

The app image `ohsms-self-host-ohsms:latest` stays. Do not unpack a new full
archive over this directory. Do not delete `secrets/` or any volume.

`minio/minio` on Docker Hub returns HTTP 404. The repository is gone. That
is not a missing tag and not a private repository. `docker login` does not
fix it. `quay.io/minio/minio` returns HTTP 401 to an anonymous pull. This
package does not log in and does not switch to a fork.

MinIO is compiled here from the public tag
`RELEASE.2025-10-15T17-29-55Z` on `github.com/minio/minio`, using the public
`golang:1.24.8-bookworm` and `debian:bookworm-slim` images. Both publish
`linux/arm64`.

From the existing install directory:

```sh
cd /Users/sarathchandra/ohsms-self-host-install-20261107/ohsms-self-host
# copy docker-compose.yml, minio/Dockerfile, and minio/entrypoint.sh
# from this fix onto those paths. Leave secrets/ untouched.
docker compose build minio
```

Create `secrets/bootstrap-password` (mode 0600, one line, at least 12
characters) only when that password is ready, then:

```sh
node bootstrap.mjs
docker compose up -d --no-build
docker compose ps
```

`--no-build` does not rebuild `ohsms-self-host-ohsms:latest`.

Stop later with `docker compose stop`. Do not run `docker compose down -v`.

Health, not executed in the environment that wrote this file:

```sh
curl -fsS http://127.0.0.1:9000/minio/health/live
curl -fsS http://127.0.0.1:9002/health/ready
```

The first is MinIO's documented liveness probe. `mc ready local` is not
used: that binary was bundled in the removed registry image. The second is
Keycloak's documented readiness probe on the management port, published
only on `127.0.0.1:9002`. The Keycloak `26.0.7` image does not include
curl, so there is no in-container healthcheck for it.
