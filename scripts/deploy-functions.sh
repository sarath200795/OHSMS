#!/usr/bin/env bash
# Deploy the Cloud Functions this repository exports.
#
# firebase-tools, with --non-interactive --force and `--only functions`, treats
# --force as consent to delete every function that is deployed and no longer
# exported (lib/deploy/functions/prompts.js promptForFunctionDeletion). Without
# --force, that same non-interactive deploy aborts. --force is still required
# for the other prompts (minimum instances, cleanup policy, failure policy).
#
# Default: deploy only the export names in functions/index.js. A function that
# is still in the project and absent from source — tgWebhook after this removal
# — is not deleted. Set APPROVE_FUNCTION_DELETION=yes to deploy the whole
# codebase and allow that deletion. CI does not set it. Deleting tgWebhook is
# a separate operator step, after the Telegram webhook has been removed.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
index="$root/functions/index.js"

mapfile -t names < <(grep -E '^export const [A-Za-z0-9_]+ =' "$index" \
  | sed -E 's/^export const ([A-Za-z0-9_]+) =.*/\1/' \
  | sort -u)

if [[ "${#names[@]}" -lt 1 ]]; then
  echo "::error::No Cloud Functions found in functions/index.js." >&2
  exit 1
fi

for name in "${names[@]}"; do
  case "$name" in
    tgWebhook|TG_*|TELEGRAM_*)
      echo "::error::Refusing to deploy a Telegram function ($name)." >&2
      exit 1
      ;;
  esac
done

if [[ "${1:-}" == "--print-only" ]]; then
  printf '%s\n' "${names[@]}"
  exit 0
fi

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "::error::PROJECT_ID is required." >&2
  exit 1
fi
if [[ ! "$PROJECT_ID" =~ ^[A-Za-z0-9-]+$ ]]; then
  echo "::error::PROJECT_ID is not a project id." >&2
  exit 1
fi

firebase_cli() {
  if [[ -n "${FIREBASE_BIN:-}" ]]; then
    "$FIREBASE_BIN" "$@"
  else
    npx firebase-tools "$@"
  fi
}

only="functions"
if [[ "${APPROVE_FUNCTION_DELETION:-}" == "yes" ]]; then
  echo "APPROVE_FUNCTION_DELETION=yes: this deploy may delete Cloud Functions that source no longer exports."
else
  joined=""
  for name in "${names[@]}"; do
    if [[ -n "$joined" ]]; then
      joined+=","
    fi
    joined+="functions:${name}"
  done
  only="$joined"
  echo "Deploying ${#names[@]} functions. Functions absent from source are left deployed."
fi

firebase_cli deploy --only "$only" \
  --project "$PROJECT_ID" \
  --non-interactive \
  --force
