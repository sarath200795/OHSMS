#!/usr/bin/env bash
# Exercises apply-storage-cors.sh against a fake gcloud that records argv.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/scripts/apply-storage-cors.sh"
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
log="$tmp/gcloud.log"
cat >"$tmp/gcloud" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
FAKE
chmod +x "$tmp/gcloud"
echo '{}' >"$tmp/sa.json"
export GCLOUD="$tmp/gcloud" FAKE_LOG="$log"

# The committed rule must parse, and must cover the production origin.
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
if (!r[0].origin.includes("https://suite.weehs.org")) process.exit(1)
if (r[0].method.some((m) => !["GET", "HEAD"].includes(m))) process.exit(2)
' "$root/scripts/storage-cors.json" || fail "storage-cors.json missing production origin or allows a write method"

# Unset bucket: skip with a warning, call nothing.
out="$(BUCKET= GOOGLE_APPLICATION_CREDENTIALS="$tmp/sa.json" bash "$script")"
[[ "$out" == *"::warning::"* ]] || fail "unset bucket should warn"
[[ ! -s "$log" ]] || fail "unset bucket should not call gcloud"

# A gs:// prefix is stripped; the update targets exactly that bucket.
BUCKET=gs://demo-bucket.example GOOGLE_APPLICATION_CREDENTIALS="$tmp/sa.json" bash "$script" >/dev/null
grep -q "^auth activate-service-account --key-file=$tmp/sa.json" "$log" || fail "did not activate the key"
grep -q "^storage buckets update gs://demo-bucket.example --cors-file=$root/scripts/storage-cors.json" "$log" \
  || fail "did not update the bucket with the committed file"

# Hostile bucket names never reach gcloud.
: >"$log"
if BUCKET='x --clear-cors' GOOGLE_APPLICATION_CREDENTIALS="$tmp/sa.json" bash "$script" 2>/dev/null; then
  fail "accepted a bucket name carrying a flag"
fi
[[ ! -s "$log" ]] || fail "rejected bucket still reached gcloud"

# Missing key file fails rather than running unauthenticated.
if BUCKET=demo GOOGLE_APPLICATION_CREDENTIALS="$tmp/nope.json" bash "$script" 2>/dev/null; then
  fail "ran without a key file"
fi

echo "apply-storage-cors.sh: ok"
