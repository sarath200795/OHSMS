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
#   write-env        functions/.env.<PROJECT_ID> with the non-secret mail params
#   ensure-secrets   leave existing secrets alone; create SMTP_PASS only when
#                    it is missing; fail if DATA_KEY_MASTER is missing
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
  local host="${SMTP_HOST:-smtp-relay.brevo.com}"
  local port="${SMTP_PORT:-587}"
  # The Brevo SMTP login. Empty until it is set; the From address is not it.
  local user="${SMTP_USER:-}"
  local from="${MAIL_FROM:-EHS notifications <info@weehs.org>}"
  local origin="${APP_ORIGIN:-https://suite.weehs.org}"

  reject_param_value SMTP_HOST "$host"
  reject_param_value SMTP_PORT "$port"
  reject_param_value SMTP_USER "$user"
  reject_param_value MAIL_FROM "$from"
  reject_param_value APP_ORIGIN "$origin"

  mkdir -p "$dir"
  umask 077
  {
    printf 'SMTP_HOST=%s\n' "$host"
    printf 'SMTP_PORT=%s\n' "$port"
    printf 'SMTP_USER=%s\n' "$user"
    printf 'MAIL_FROM=%s\n' "$from"
    printf 'APP_ORIGIN=%s\n' "$origin"
  } >"$env_file"

  if grep -Eq '^(DATA_KEY_MASTER|SMTP_PASS)=' "$env_file"; then
    rm -f "$env_file"
    echo "::error::Refusing to leave DATA_KEY_MASTER or SMTP_PASS in ${env_file}." >&2
    exit 1
  fi
  echo "Wrote ${env_file} with non-secret params only (SMTP_HOST SMTP_PORT SMTP_USER MAIL_FROM APP_ORIGIN)."
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
}

case "${1:-}" in
  write-env) write_env ;;
  ensure-secrets) ensure_secrets ;;
  *) usage ;;
esac
