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
env -u WA_TEMPLATE_WELCOME -u WA_TEMPLATE_TEST \
  PROJECT_ID=weehs-4eb28 FUNCTIONS_DIR="$tmp/fn" bash "$script" write-env >/dev/null
env_file="$tmp/fn/.env.weehs-4eb28"
[[ -f "$env_file" ]] || fail "expected $env_file"
assert_eq "$(basename "$env_file")" ".env.weehs-4eb28" "dotenv filename"
assert_eq "$(grep '^SMTP_HOST=' "$env_file")" "SMTP_HOST=smtp-relay.brevo.com" "default host"
assert_eq "$(grep '^SMTP_PORT=' "$env_file")" "SMTP_PORT=587" "default port"
assert_eq "$(grep '^SMTP_USER=' "$env_file")" "SMTP_USER=" "default user is unset"
assert_eq "$(grep '^MAIL_FROM=' "$env_file")" "MAIL_FROM=EHS notifications <info@weehs.org>" "default from"
assert_eq "$(grep '^APP_ORIGIN=' "$env_file")" "APP_ORIGIN=https://suite.weehs.org" "default origin"
assert_eq "$(grep '^TG_ENABLED=' "$env_file")" "TG_ENABLED=true" "telegram stays on"
assert_eq "$(grep '^TG_LIST_ORGS=' "$env_file")" "TG_LIST_ORGS=false" "org names are not listed"
assert_eq "$(grep '^TG_ORG_ID=' "$env_file")" "TG_ORG_ID=" "telegram is not pinned"
assert_eq "$(grep '^WA_TEMPLATE_WELCOME=' "$env_file")" "WA_TEMPLATE_WELCOME=" "welcome template stays blank"
assert_eq "$(grep '^WA_TEMPLATE_TEST=' "$env_file")" "WA_TEMPLATE_TEST=" "test template stays blank"
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
  WA_TEMPLATE_WELCOME='weehs_welcome+en' \
  WA_TEMPLATE_TEST='weehs_test+en' \
  SMTP_PASS=supersecret \
  DATA_KEY_MASTER=do-not-write \
  bash "$script" write-env >/dev/null
over="$tmp/fn2/.env.weehs-4eb28"
assert_eq "$(grep '^SMTP_HOST=' "$over")" "SMTP_HOST=smtp.example" "override host"
assert_eq "$(grep '^SMTP_PORT=' "$over")" "SMTP_PORT=587" "override port"
assert_eq "$(grep '^SMTP_USER=' "$over")" "SMTP_USER=mailer@example.com" "override user"
assert_eq "$(grep '^MAIL_FROM=' "$over")" "MAIL_FROM=Ops <ops@example.com>" "override from"
assert_eq "$(grep '^APP_ORIGIN=' "$over")" "APP_ORIGIN=https://staging.example" "override origin"
assert_eq "$(grep '^WA_TEMPLATE_WELCOME=' "$over")" "WA_TEMPLATE_WELCOME=weehs_welcome+en" "override welcome template"
assert_eq "$(grep '^WA_TEMPLATE_TEST=' "$over")" "WA_TEMPLATE_TEST=weehs_test+en" "override test template"
if grep -q 'supersecret\|do-not-write\|SMTP_PASS\|DATA_KEY_MASTER' "$over"; then
  fail "override path wrote a secret into dotenv"
fi

# A blank template is free-form text. A value firebase-tools would mis-parse
# must not be written as a different string.
if env -u WA_TEMPLATE_TEST PROJECT_ID=weehs-4eb28 FUNCTIONS_DIR="$tmp/badtpl" \
  WA_TEMPLATE_WELCOME='weehs#welcome' bash "$script" write-env >/dev/null 2>"$tmp/tpl.err"; then
  fail "template value containing # was accepted"
fi
grep -q 'WA_TEMPLATE_WELCOME' "$tmp/tpl.err" || fail "rejected template did not name the key"

# Every defineString has to be a key in the file write-env produces, for a
# production project and for any other. firebase-tools 13 throws in
# --non-interactive before it applies the code default, and the error names
# each absent key. That is the v2.0.7 failure. defineSecret names stay out:
# a secret in this file is deployed as a plain env var (LOW-13).
string_params="$(grep -RhoE "defineString\\('[A-Z0-9_]+'" "$root/functions" --include='*.js' \
  | sed -E "s/defineString\\('//; s/'//" | sort -u)"
secret_params="$(grep -RhoE "defineSecret\\('[A-Z0-9_]+'" "$root/functions" --include='*.js' \
  | sed -E "s/defineSecret\\('//; s/'//" | sort -u)"
[[ -n "$string_params" ]] || fail "found no defineString params"
[[ -n "$secret_params" ]] || fail "found no defineSecret params"
# The calls in functions/index.js are one line and pass a default. A param
# with no default is the one an interactive deploy prompts for.
while IFS= read -r call; do
  [[ "$call" == *'default:'* ]] || fail "defineString without a default: $call"
done < <(grep -RhoE "defineString\\('[A-Z0-9_]+'[^)]*\\)" "$root/functions" --include='*.js')

unset_args=()
while IFS= read -r name; do
  unset_args+=("-u" "$name")
done <<<"$string_params"

check_written_params() {
  local project="$1" dir="$2" label="$3"
  env "${unset_args[@]}" PROJECT_ID="$project" FUNCTIONS_DIR="$dir" bash "$script" write-env >/dev/null
  local file="$dir/.env.$project"
  local name
  while IFS= read -r name; do
    grep -q "^${name}=" "$file" || fail "$label deploy env missing $name"
  done <<<"$string_params"
  while IFS= read -r name; do
    if grep -q "^${name}=" "$file"; then
      fail "$label deploy env contains secret $name"
    fi
  done <<<"$secret_params"
}

check_written_params weehs-4eb28 "$tmp/fn-prod" "production"
check_written_params stgtest1 "$tmp/fn-other" "non-production"
assert_eq "$(grep '^WA_TEMPLATE_WELCOME=' "$tmp/fn-other/.env.stgtest1")" "WA_TEMPLATE_WELCOME=" "non-production welcome stays blank"
assert_eq "$(grep '^WA_ENABLED=' "$tmp/fn-other/.env.stgtest1")" "WA_ENABLED=false" "non-production whatsapp stays off"

# The checked-in production file is the same deploy env a laptop uses when
# it does not re-run write-env. A key present only in the script still fails
# that deploy. TG_LIST_ORGS was the other one missing from this file.
committed="$root/functions/.env.weehs-4eb28"
while IFS= read -r name; do
  grep -q "^${name}=" "$committed" || fail "functions/.env.weehs-4eb28 missing $name"
done <<<"$string_params"
assert_eq "$(grep '^WA_TEMPLATE_WELCOME=' "$committed")" "WA_TEMPLATE_WELCOME=" "committed welcome stays blank"
assert_eq "$(grep '^WA_TEMPLATE_TEST=' "$committed")" "WA_TEMPLATE_TEST=" "committed test stays blank"
while IFS= read -r name; do
  if grep -q "^${name}=" "$committed"; then
    fail "functions/.env.weehs-4eb28 contains secret $name"
  fi
done <<<"$secret_params"
# The runtime refusal has to name every defineSecret. A comment that mentions
# the secret is not the guard: only the grep that deletes the file counts.
guard="$(grep -E "if grep -Eq '\\^\\(" "$script")"
[[ "$(printf '%s\n' "$guard" | wc -l | tr -d ' ')" == "1" ]] || fail "expected one dotenv secret guard"
while IFS= read -r name; do
  grep -q "$name" <<<"$guard" || fail "dotenv secret guard omits $name"
done <<<"$secret_params"

# GitHub repository variables are not in the environment unless the write-env
# step names them. An unmentioned var cannot override the blank.
assert_workflow_templates() {
  local file="$1"
  local block
  block="$(awk '
    /name: Write functions param file/ { grab=1 }
    grab { print }
    grab && /prepare-functions-deploy.sh write-env/ { exit }
  ' "$file")"
  grep -q 'WA_TEMPLATE_WELCOME: ${{ vars.WA_TEMPLATE_WELCOME }}' <<<"$block" \
    || fail "$file does not pass WA_TEMPLATE_WELCOME into write-env"
  grep -q 'WA_TEMPLATE_TEST: ${{ vars.WA_TEMPLATE_TEST }}' <<<"$block" \
    || fail "$file does not pass WA_TEMPLATE_TEST into write-env"
}
assert_workflow_templates "$root/.github/workflows/deploy.yml"
assert_workflow_templates "$root/.github/workflows/deploy-staging.yml"

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
  elif [[ "$name" == "WA_APP_SECRET" || "$name" == "WA_ACCESS_TOKEN" || "$name" == "WA_VERIFY_TOKEN" || "$name" == "TELEGRAM_BOT_TOKEN" || "$name" == "TG_WEBHOOK_SECRET" ]]; then
    state="${FAKE_PLACEHOLDERS:-present}"
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

# SMTP_PASS and the placeholder helper are the only functions:secrets:set
# calls. Neither passes --force, and neither names DATA_KEY_MASTER.
set_lines="$(grep -n 'firebase_cli functions:secrets:set' "$script" || true)"
assert_eq "$(printf '%s\n' "$set_lines" | wc -l | tr -d ' ')" "2" "two secrets:set invocations"
grep -q 'SMTP_PASS' <<<"$set_lines" || fail "secrets:set does not target SMTP_PASS"
grep -q '$name' <<<"$set_lines" || fail "placeholder secrets:set does not target the secret name"
if grep -q 'DATA_KEY_MASTER' <<<"$set_lines"; then
  fail "secrets:set names DATA_KEY_MASTER"
fi
if grep -q -- '--force' <<<"$set_lines"; then
  fail "secrets:set line includes --force"
fi

echo "ok"
