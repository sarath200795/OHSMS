#!/usr/bin/env bash
# Prepare a non-interactive `firebase deploy --only functions`.
#
# firebase-tools 13 resolveParams throws in --non-interactive mode BEFORE it
# applies defineString defaults, and the error names every unresolved param —
# including DATA_KEY_MASTER and SMTP_PASS — even when those secrets already
# exist. That is the failure that stopped the v1.9.19 production deploy.
# loadUserEnvs reads functions/.env.<projectId> from the functions source
# (firebase.json "functions.source"). Code defaults are not consulted.
#
# Secrets must not be written into that file. A key present in dotenv is
# deployed as a plain environment variable and is never bound through Secret
# Manager, which is the LOW-13 finding this project already recorded against
# a mail credential.
#
#   write-env        functions/.env.<PROJECT_ID> with the non-secret mail and
#                    WhatsApp params
#   ensure-secrets   leave existing secrets alone; create SMTP_PASS and the
#                    three WA_* secrets only when missing (as non-working
#                    placeholders); fail if DATA_KEY_MASTER is missing
#
# DATA_KEY_MASTER is never created here. Encrypted records can only be opened
# with the key that wrapped them. Inventing a new one would let the deploy
# succeed and leave that data unreadable.
set -euo pipefail

usage() {
  echo "usage: $0 write-env|ensure-secrets" >&2
  exit 2
}

# Firebase project ids are 6–30 chars, start with a letter, and do not end in
# a hyphen. Anything else must not become a path segment under functions/.
require_project_id() {
  local project="${PROJECT_ID:-}"
  if [[ ! "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
    echo "::error::PROJECT_ID must be the Firebase project id (functions/.env.<projectId>). Got: ${project:-<empty>}" >&2
    exit 1
  fi
}

# A newline or '#' would split or truncate the dotenv line. Reject rather than
# quote our way into a value the CLI parses differently from the one we meant.
reject_param_value() {
  local key="$1"
  local value="$2"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* || "$value" == *'#'* ]]; then
    echo "::error::${key} contains a newline or '#', which would not survive the functions dotenv file. Refusing to write it." >&2
    exit 1
  fi
}

# Copy $2 into the variable named by $1, or $3 when $2 is empty or whitespace.
# `:-` does not treat spaces as unset, and a line of spaces is still a value.
set_or_default() {
  local dest="$1"
  local value="$2"
  local default="$3"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    printf -v "$dest" '%s' "$default"
  else
    printf -v "$dest" '%s' "$value"
  fi
}

# firebase-tools treats `KEY=` as a value and publishes it over the param
# already on the function. It does not apply the defineString default first
# (v1.9.19; still true in firebase-tools 15). v2.0.9 wrote `SMTP_USER=` from
# an empty GitHub variable and weather digests then failed with
# missing:["SMTP_USER"]. Omit the line. Do not invent a login to fill it.
# A missing SMTP_USER stops the non-interactive deploy and names the variable,
# which leaves the login already deployed in place.
append_env_unless_empty() {
  local key="$1"
  local value="$2"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$value"
}

firebase_cli() {
  if [[ -n "${FIREBASE_BIN:-}" ]]; then
    "$FIREBASE_BIN" "$@"
  else
    npx firebase-tools "$@"
  fi
}

# Metadata only. functions:secrets:access prints the payload; this must not.
# stdout is one of: present, missing, error. Diagnostics go to stderr.
secret_state() {
  local name="$1"
  local err out
  err="$(mktemp)"
  out="$(mktemp)"
  if firebase_cli functions:secrets:get "$name" --project "$PROJECT_ID" --non-interactive >"$out" 2>"$err"; then
    rm -f "$err" "$out"
    echo present
    return 0
  fi
  # A missing secret is HTTP 404 / NOT_FOUND. Anything else (403, API
  # disabled, auth) is not "missing" — creating or failing open would be
  # the wrong response, especially for DATA_KEY_MASTER.
  if grep -Eq 'HTTP Error: 404' "$err" "$out" && grep -Eqi 'NOT_FOUND|not found' "$err" "$out"; then
    rm -f "$err" "$out"
    echo missing
    return 0
  fi
  echo "::error::Could not check whether secret ${name} exists in project ${PROJECT_ID}. Refusing to create or change it." >&2
  cat "$err" >&2
  rm -f "$err" "$out"
  echo error
  return 0
}

write_env() {
  require_project_id
  local dir="${FUNCTIONS_DIR:-functions}"
  local env_file="${dir}/.env.${PROJECT_ID}"
  # Host, port and From keep the relay defaults when their variables are
  # empty. Those defaults are the relay, not a credential. SMTP_USER has no
  # default: the From mailbox would authenticate as the wrong account, and an
  # empty value must be omitted rather than written (see append_env_unless_empty).
  local host port user from origin
  set_or_default host "${SMTP_HOST-}" "smtp-relay.brevo.com"
  set_or_default port "${SMTP_PORT-}" "587"
  set_or_default user "${SMTP_USER-}" ""
  set_or_default from "${MAIL_FROM-}" "EHS notifications <info@weehs.org>"
  set_or_default origin "${APP_ORIGIN-}" "https://suite.weehs.org"

  reject_param_value SMTP_HOST "$host"
  reject_param_value SMTP_PORT "$port"
  reject_param_value SMTP_USER "$user"
  reject_param_value MAIL_FROM "$from"
  reject_param_value APP_ORIGIN "$origin"

  # WhatsApp site lookup. Off unless WA_ENABLED is exactly "true" AND the
  # phone number id and the three WA_* secrets are real (functions/index.js).
  # Production's site lookup bots are live: its defaults are the live values,
  # so a CI deploy that names none of them does not switch WhatsApp off. Any
  # other project (staging, a fork) keeps the off-by-default behaviour.
  local wa_default_enabled=false wa_default_pnid='' wa_default_display=''
  if [[ "$PROJECT_ID" == "weehs-4eb28" ]]; then
    wa_default_enabled=true
    wa_default_pnid=1418439508016031
    wa_default_display='+91 77939 66625'
  fi
  local wa_enabled="${WA_ENABLED:-$wa_default_enabled}"
  local wa_pnid="${WA_PHONE_NUMBER_ID:-$wa_default_pnid}"
  local wa_ver="${WA_GRAPH_VERSION:-v25.0}"
  local wa_display="${WA_DISPLAY_NUMBER:-$wa_default_display}"
  local wa_cap="${WA_DAILY_CAP:-2000}"
  # Business-initiated template names (`name+lang`). Blank is a value on
  # purpose. firebase-tools 13 throws in --non-interactive before it applies
  # the defineString default of '', and the error names every key that is
  # simply absent. v2.0.7 stopped on these two. An empty value is what
  # waTemplate treats as free-form text. Repository variables of the same
  # name override the blank once a template is approved in Meta.
  local wa_welcome="${WA_TEMPLATE_WELCOME:-}"
  local wa_test="${WA_TEMPLATE_TEST:-}"
  # Identity Toolkit password check for completePasswordChange. Empty is a
  # value: the function then refuses and does not clear mustChangePassword.
  # Not the browser key. A newline or '#' is rejected like the other params.
  local auth_web_api_key="${AUTH_WEB_API_KEY:-}"
  reject_param_value WA_ENABLED "$wa_enabled"
  reject_param_value WA_PHONE_NUMBER_ID "$wa_pnid"
  reject_param_value WA_GRAPH_VERSION "$wa_ver"
  reject_param_value WA_DISPLAY_NUMBER "$wa_display"
  reject_param_value WA_DAILY_CAP "$wa_cap"
  reject_param_value WA_TEMPLATE_WELCOME "$wa_welcome"
  reject_param_value WA_TEMPLATE_TEST "$wa_test"
  reject_param_value AUTH_WEB_API_KEY "$auth_web_api_key"

  mkdir -p "$dir"
  umask 077
  {
    # Empty SMTP_HOST, SMTP_PORT, SMTP_USER and MAIL_FROM are omitted. A blank
    # assignment would clear the value already on the function. WhatsApp keys
    # below stay even when blank: a missing key stopped the v2.0.7 deploy, and
    # an empty template name is free-form text on purpose.
    append_env_unless_empty SMTP_HOST "$host"
    append_env_unless_empty SMTP_PORT "$port"
    append_env_unless_empty SMTP_USER "$user"
    append_env_unless_empty MAIL_FROM "$from"
    append_env_unless_empty APP_ORIGIN "$origin"
    printf 'WA_ENABLED=%s\n' "$wa_enabled"
    printf 'WA_PHONE_NUMBER_ID=%s\n' "$wa_pnid"
    printf 'WA_GRAPH_VERSION=%s\n' "$wa_ver"
    printf 'WA_DISPLAY_NUMBER=%s\n' "$wa_display"
    printf 'WA_DAILY_CAP=%s\n' "$wa_cap"
    printf 'WA_TEMPLATE_WELCOME=%s\n' "$wa_welcome"
    printf 'WA_TEMPLATE_TEST=%s\n' "$wa_test"
    printf 'AUTH_WEB_API_KEY=%s\n' "$auth_web_api_key"
  } >"$env_file"

  # Names in this guard are credentials. A match deletes the dotenv file
  # rather than deploying them as plain env vars (LOW-13). Weather uses
  # Open-Meteo's free API and does not need WINDY_API_KEY; the name stays
  # here so a leftover copy is still refused.
  if grep -Eq '^(DATA_KEY_MASTER|SMTP_PASS|WINDY_API_KEY|WA_APP_SECRET|WA_ACCESS_TOKEN|WA_VERIFY_TOKEN)=' "$env_file"; then
    rm -f "$env_file"
    echo "::error::Refusing to leave a secret (DATA_KEY_MASTER, SMTP_PASS, WINDY_API_KEY, WA_APP_SECRET, WA_ACCESS_TOKEN, WA_VERIFY_TOKEN) in ${env_file}." >&2
    exit 1
  fi
  echo "Wrote ${env_file} with non-secret params only (SMTP_HOST SMTP_PORT SMTP_USER MAIL_FROM APP_ORIGIN WA_ENABLED WA_PHONE_NUMBER_ID WA_GRAPH_VERSION WA_DISPLAY_NUMBER WA_DAILY_CAP WA_TEMPLATE_WELCOME WA_TEMPLATE_TEST AUTH_WEB_API_KEY). Empty SMTP_HOST, SMTP_PORT, SMTP_USER and MAIL_FROM lines are omitted."
}

# A WhatsApp secret that does not exist yet is created as UNSET-PLACEHOLDER so
# the functions that bind it can deploy. The placeholder authenticates nothing:
# lib/whatsapp/signature.js isRealSecret refuses it, so the webhook stays off
# until the real value is set with `firebase functions:secrets:set <NAME>`.
# Never overwritten here, and no --force (see SMTP_PASS below).
ensure_placeholder_secret() {
  local name="$1"
  local state
  state="$(secret_state "$name")"
  case "$state" in
    present)
      echo "${name} already exists in Secret Manager; leaving it unchanged."
      ;;
    missing)
      local f
      f="$(mktemp)"
      chmod 600 "$f"
      printf '%s' 'UNSET-PLACEHOLDER' >"$f"
      echo "${name} is missing; creating non-working placeholder UNSET-PLACEHOLDER."
      firebase_cli functions:secrets:set "$name" \
        --project "$PROJECT_ID" \
        --data-file "$f" \
        --non-interactive
      rm -f "$f"
      ;;
    *)
      exit 1
      ;;
  esac
}

ensure_secrets() {
  require_project_id
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
    echo "::error::GOOGLE_APPLICATION_CREDENTIALS is not a readable key file. Refusing to check or create secrets." >&2
    exit 1
  fi

  local master
  master="$(secret_state DATA_KEY_MASTER)"
  case "$master" in
    present)
      echo "DATA_KEY_MASTER already exists in Secret Manager; leaving it unchanged."
      ;;
    missing)
      # Do not invent a master key. There is no recovery from deploying a
      # new one over data wrapped by the key that is supposed to be here.
      echo "::error::DATA_KEY_MASTER is not in Secret Manager for project ${PROJECT_ID}. Refusing to invent a master key. Encrypted records can only be opened with the existing key; a new value would deploy and leave that data unreadable. Set the current key with 'firebase functions:secrets:set DATA_KEY_MASTER' and re-run." >&2
      exit 1
      ;;
    *)
      exit 1
      ;;
  esac

  local smtp
  smtp="$(secret_state SMTP_PASS)"
  case "$smtp" in
    present)
      echo "SMTP_PASS already exists in Secret Manager; leaving it unchanged."
      ;;
    missing)
      local smtp_file
      smtp_file="$(mktemp)"
      # shellcheck disable=SC2064
      trap "rm -f '$smtp_file'" RETURN
      chmod 600 "$smtp_file"
      if [[ -n "${SMTP_PASS:-}" ]]; then
        printf '%s' "$SMTP_PASS" >"$smtp_file"
        echo "SMTP_PASS is missing; creating it from the SMTP_PASS GitHub secret."
      else
        # DEPLOYMENT.md §6: a placeholder deploys; mail is not sent until the
        # value is the real mailbox password.
        printf '%s' 'UNSET-PLACEHOLDER' >"$smtp_file"
        echo "SMTP_PASS is missing; creating non-sending placeholder UNSET-PLACEHOLDER (DEPLOYMENT.md §6)."
      fi
      # No --force. On functions:secrets:set, --force redeploys bound
      # functions and destroys stale secret versions. This path only runs
      # when the secret does not exist yet, and must not be able to rotate
      # anything if that check is ever wrong.
      firebase_cli functions:secrets:set SMTP_PASS \
        --project "$PROJECT_ID" \
        --data-file "$smtp_file" \
        --non-interactive
      ;;
    *)
      exit 1
      ;;
  esac

  ensure_placeholder_secret WA_APP_SECRET
  ensure_placeholder_secret WA_ACCESS_TOKEN
  ensure_placeholder_secret WA_VERIFY_TOKEN
}

case "${1:-}" in
  write-env) write_env ;;
  ensure-secrets) ensure_secrets ;;
  *) usage ;;
esac
