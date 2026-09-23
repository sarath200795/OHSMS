#!/usr/bin/env bash
# Exercises prepare-functions-deploy.sh without a Firebase project.
# The fake CLI records argv and classifies secrets the way functions:secrets:get
# does: metadata on stdout, HTTP 404 / not found on stderr, never a payload.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/scripts/prepare-functions-deploy.sh"
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local got="$1" want="$2" label="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $label" >&2
    echo "  got:  [$got]" >&2
    echo "  want: [$want]" >&2
    exit 1
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── write-env: filename is functions/.env.<projectId>, defaults, no secrets ──
PROJECT_ID=weehs-4eb28 FUNCTIONS_DIR="$tmp/fn" bash "$script" write-env >/dev/null
env_file="$tmp/fn/.env.weehs-4eb28"
[[ -f "$env_file" ]] || fail "expected $env_file"
assert_eq "$(basename "$env_file")" ".env.weehs-4eb28" "dotenv filename"
assert_eq "$(grep '^SMTP_HOST=' "$env_file")" "SMTP_HOST=mail.privateemail.com" "default host"
assert_eq "$(grep '^SMTP_PORT=' "$env_file")" "SMTP_PORT=465" "default port"
assert_eq "$(grep '^SMTP_USER=' "$env_file")" "SMTP_USER=info@weehs.org" "default user"
assert_eq "$(grep '^MAIL_FROM=' "$env_file")" "MAIL_FROM=WEEHS <info@weehs.org>" "default from"
assert_eq "$(grep '^APP_ORIGIN=' "$env_file")" "APP_ORIGIN=https://suite.weehs.org" "default origin"
if grep -Eq '^(DATA_KEY_MASTER|SMTP_PASS)=' "$env_file"; then
  fail "secret key written into dotenv"
fi

# Overrides replace defaults. Exported secret env vars must still be ignored.
PROJECT_ID=weehs-4eb28 \
  FUNCTIONS_DIR="$tmp/fn2" \
  SMTP_HOST=smtp.example \
  SMTP_PORT=587 \
  SMTP_USER=mailer@example.com \
  MAIL_FROM='Ops <ops@example.com>' \
  APP_ORIGIN=https://staging.example \
  SMTP_PASS=supersecret \
  DATA_KEY_MASTER=do-not-write \
  bash "$script" write-env >/dev/null
over="$tmp/fn2/.env.weehs-4eb28"
assert_eq "$(grep '^SMTP_HOST=' "$over")" "SMTP_HOST=smtp.example" "override host"
assert_eq "$(grep '^SMTP_PORT=' "$over")" "SMTP_PORT=587" "override port"
assert_eq "$(grep '^SMTP_USER=' "$over")" "SMTP_USER=mailer@example.com" "override user"
assert_eq "$(grep '^MAIL_FROM=' "$over")" "MAIL_FROM=Ops <ops@example.com>" "override from"
assert_eq "$(grep '^APP_ORIGIN=' "$over")" "APP_ORIGIN=https://staging.example" "override origin"
if grep -q 'supersecret\|do-not-write\|SMTP_PASS\|DATA_KEY_MASTER' "$over"; then
  fail "override path wrote a secret into dotenv"
fi

if PROJECT_ID='../etc' FUNCTIONS_DIR="$tmp/bad" bash "$script" write-env >/dev/null 2>&1; then
  fail "bad project id was accepted"
fi

# ── ensure-secrets ───────────────────────────────────────────────────────────
fake="$tmp/fake-firebase"
log="$tmp/firebase.log"
set_value="$tmp/set-value"
cat >"$fake" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_FIREBASE_LOG"
if [[ "$*" == *--force* ]]; then
  echo "refusing --force" >&2
  exit 1
fi
if [[ "$1" == "functions:secrets:get" ]]; then
  name="$2"
  state=present
  if [[ "$name" == "DATA_KEY_MASTER" ]]; then
    state="${FAKE_MASTER:-present}"
  elif [[ "$name" == "SMTP_PASS" ]]; then
    state="${FAKE_SMTP:-present}"
  else
    echo "unexpected secret $name" >&2
    exit 1
  fi
  if [[ "$state" == "present" ]]; then
    echo "1 ENABLED"
    exit 0
  fi
  if [[ "$state" == "missing" ]]; then
    echo "Request to https://secretmanager.googleapis.com/v1/projects/p/secrets/${name}/versions had HTTP Error: 404, Secret [projects/p/secrets/${name}] not found." >&2
    exit 1
  fi
  echo "Request to https://secretmanager.googleapis.com/v1/projects/p/secrets/${name} had HTTP Error: 403, Permission denied." >&2
  exit 1
fi
if [[ "$1" == "functions:secrets:set" ]]; then
  if [[ "$2" != "SMTP_PASS" ]]; then
    echo "refusing to set $2" >&2
    exit 1
  fi
  data_file=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--data-file" ]]; then
      data_file="$arg"
    fi
    prev="$arg"
  done
  cp "$data_file" "$FAKE_SET_VALUE"
  exit 0
fi
echo "unexpected argv: $*" >&2
exit 1
EOF
chmod +x "$fake"
creds="$tmp/sa.json"
printf '%s' '{"type":"service_account"}' >"$creds"

run_secrets() {
  : >"$log"
  rm -f "$set_value"
  env \
    PROJECT_ID=weehs-4eb28 \
    GOOGLE_APPLICATION_CREDENTIALS="$creds" \
    FIREBASE_BIN="$fake" \
    FAKE_FIREBASE_LOG="$log" \
    FAKE_SET_VALUE="$set_value" \
    FAKE_MASTER="${FAKE_MASTER:-present}" \
    FAKE_SMTP="${FAKE_SMTP:-present}" \
    SMTP_PASS="${SMTP_PASS:-}" \
    bash "$script" ensure-secrets
}

FAKE_MASTER=present FAKE_SMTP=present run_secrets >/dev/null
if grep -q 'functions:secrets:set' "$log"; then
  fail "existing secrets were passed to functions:secrets:set"
fi
grep -q 'functions:secrets:get DATA_KEY_MASTER' "$log" || fail "did not describe DATA_KEY_MASTER"
grep -q 'functions:secrets:get SMTP_PASS' "$log" || fail "did not describe SMTP_PASS"

FAKE_MASTER=present FAKE_SMTP=missing SMTP_PASS= run_secrets >/dev/null
grep -q 'functions:secrets:set SMTP_PASS' "$log" || fail "missing SMTP_PASS was not created"
if grep -q -- '--force' "$log"; then
  fail "secrets:set was called with --force"
fi
assert_eq "$(cat "$set_value")" "UNSET-PLACEHOLDER" "placeholder value"
if grep -q 'functions:secrets:set DATA_KEY_MASTER' "$log"; then
  fail "DATA_KEY_MASTER was set"
fi

FAKE_MASTER=present FAKE_SMTP=missing SMTP_PASS='mailbox-secret' \
  out="$(run_secrets)"
assert_eq "$(cat "$set_value")" "mailbox-secret" "github secret value"
if grep -q 'mailbox-secret' <<<"$out"; then
  fail "SMTP_PASS value was printed"
fi

set +e
FAKE_MASTER=missing FAKE_SMTP=missing SMTP_PASS= err="$(run_secrets 2>&1 >/dev/null)"
missing_rc=$?
set -e
[[ "$missing_rc" -ne 0 ]] || fail "missing DATA_KEY_MASTER did not fail"
if grep -q 'functions:secrets:set' "$log"; then
  fail "a missing master key still created a secret"
fi
grep -q 'Refusing to invent a master key' <<<"$err" || fail "missing-key error was not clear: $err"

set +e
FAKE_MASTER=denied FAKE_SMTP=missing SMTP_PASS= run_secrets >/dev/null 2>&1
denied_rc=$?
set -e
[[ "$denied_rc" -ne 0 ]] || fail "permission error was treated as success"
if grep -q 'functions:secrets:set' "$log"; then
  fail "permission error still created SMTP_PASS"
fi

# The only secrets:set invocation is SMTP_PASS, and it does not pass --force.
# Comments may mention the command; the call itself is firebase_cli.
set_lines="$(grep -n 'firebase_cli functions:secrets:set' "$script" || true)"
assert_eq "$(printf '%s\n' "$set_lines" | wc -l | tr -d ' ')" "1" "one secrets:set invocation"
grep -q 'SMTP_PASS' <<<"$set_lines" || fail "secrets:set does not target SMTP_PASS"
if grep -q -- '--force' <<<"$set_lines"; then
  fail "secrets:set line includes --force"
fi

echo "ok"
