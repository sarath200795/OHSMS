#!/bin/sh
# The named volume is root-owned the first time it is created. Fix that,
# then drop to the minio user. The healthcheck still runs as root so curl
# can call the documented liveness probe.
set -e
mkdir -p /data
chown -R minio:minio /data
exec runuser -u minio -- /usr/local/bin/minio "$@"
