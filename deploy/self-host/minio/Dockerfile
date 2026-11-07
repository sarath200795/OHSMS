# MinIO community edition is source-only. Docker Hub repository minio/minio
# answers 404 (the repository is gone). quay.io/minio/minio answers 401 to an
# anonymous pull. This image compiles the public Git tag. It does not pull
# a MinIO registry image and it does not use a third-party fork.
FROM golang:1.24.8-bookworm AS build
ARG MINIO_REF=RELEASE.2025-10-15T17-29-55Z
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "${MINIO_REF}" https://github.com/minio/minio.git .
ENV CGO_ENABLED=0
RUN go build -trimpath -o /out/minio .

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1000 --home-dir /data --shell /usr/sbin/nologin minio
COPY --from=build /out/minio /usr/local/bin/minio
COPY entrypoint.sh /usr/local/bin/minio-entrypoint.sh
RUN chmod 755 /usr/local/bin/minio /usr/local/bin/minio-entrypoint.sh
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio-entrypoint.sh"]
CMD ["server", "/data", "--console-address", ":9001"]
