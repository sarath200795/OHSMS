#!/usr/bin/env bash
# Applies scripts/storage-cors.json to the Storage bucket.
#
# The file existed and nothing applied it. Reads go through getBlob (an
# authenticated request, so storage.rules decides), and a browser refuses that
# response from a bucket with no CORS rule for the page's origin. Production
# logged "No 'Access-Control-Allow-Origin' header" for every org logo and fell
# back to download-token URLs — the bearer-credential path getBlob replaced.
# Applying it on every deploy means the bucket cannot drift from the file.
#
# Env: BUCKET (bare name, no gs://), PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS.
# An empty BUCKET falls back to <PROJECT_ID>.firebasestorage.app, the same
# default src/shared/firebase.js gives the bundle, so the rule lands on the
# bucket the app actually reads rather than on none.
# GCLOUD overrides the binary for the test.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cors="${CORS_FILE:-$root/scripts/storage-cors.json}"
gcloud_bin="${GCLOUD:-gcloud}"

bucket="${BUCKET:-}"
if [[ -z "$bucket" && -n "${PROJECT_ID:-}" ]]; then
  bucket="${PROJECT_ID}.firebasestorage.app"
fi
if [[ -z "$bucket" ]]; then
  echo "::warning::Neither a storage bucket nor a project id is set; bucket CORS not applied."
  exit 0
fi
bucket="${bucket#gs://}"
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9._-]*[a-z0-9]$ ]]; then
  echo "Refusing bucket name: $bucket" >&2
  exit 1
fi
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS does not point at a key file" >&2
  exit 1
fi

# A throwaway config dir, so the activated account never lands in ~/.config
# on the runner and outlives the key file removed at the end of the job.
CLOUDSDK_CONFIG="$(mktemp -d)"
export CLOUDSDK_CONFIG
trap 'rm -rf "$CLOUDSDK_CONFIG"' EXIT

"$gcloud_bin" auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS" --quiet
"$gcloud_bin" storage buckets update "gs://$bucket" --cors-file="$cors" --quiet
echo "Applied $(basename "$cors") to gs://$bucket"
