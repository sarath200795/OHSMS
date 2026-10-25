#!/usr/bin/env bash
# Retry a Firestore rules, indexes and Storage rules deploy when the Rules
# compiler answers with a transient error.
#
# v2.0.1, and v2.0.3 twice, failed in "Deploy rules + indexes" on:
#
#   POST https://firebaserules.googleapis.com/v1/projects/<id>:test
#   HTTP 503, The service is currently unavailable.
#
# while checking firestore.rules. storage.rules had already compiled. The
# v2.0.3 file is byte-identical to the one v2.0.2 compiled and released
# (163364 bytes; the documented source limit is 256 KB), and the successful
# compile took about five seconds — the same window in which the 503
# returned. firebase-tools 15.34.1 calls :test with no retryCodes, so one
# 503 aborts the release. That is the Rules compiler behaviour tracked in
# firebase-tools issue 5590 (503, and 409 "already exists", on large
# rulesets the compiler has already accepted).
#
# v2.0.4 retried five times over about five minutes. Two attempts 503'd on
# :test. The other three compiled firestore.rules and then 503'd on
# POST /rulesets, and the CLI still uploaded. Those files were already the
# live release. scripts/rules-live.mjs reads the released ruleset and the
# live indexes from the Firebase API (not from a tag). When they match,
# this script does not call the Rules API, and hosting may ship. When they
# differ, only the differing parts are deployed. When the live release
# cannot be read, that is not a match: everything is deployed.
#
# Compilation errors, HTTP 400/401/403, and any other unrecognised failure
# are not retried. Hosting is a separate workflow step and runs only when
# this script exits 0. A skip is exit 0 because production is already
# enforcing these files. A failed deploy is not.
set -euo pipefail

require_project_id() {
  local project="${PROJECT_ID:-}"
  if [[ ! "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
    echo "::error::PROJECT_ID must be the Firebase project id. Got: ${project:-<empty>}" >&2
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

sleep_backoff() {
  local seconds="$1"
  if [[ -n "${RULES_DEPLOY_SLEEP_BIN:-}" ]]; then
    "$RULES_DEPLOY_SLEEP_BIN" "$seconds"
  else
    sleep "$seconds"
  fi
}

# Non-zero is retried only when the log names a transient Rules API or
# transport failure. A compilation error is the ruleset; 400/401/403 are
# the request or the credential. Retrying those burns the release window
# and cannot change the result.
transient_failure() {
  local log="$1"
  if grep -Eq 'Compilation error' "$log"; then
    return 1
  fi
  if grep -Eq 'HTTP Error: (400|401|403)\b' "$log"; then
    return 1
  fi
  if grep -Eq 'HTTP Error: (408|409|429|500|502|503|504)\b' "$log"; then
    return 0
  fi
  local transport='ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up'
  transport+='|The service is currently unavailable|fetch failed|network timeout'
  if grep -Eqi "$transport" "$log"; then
    return 0
  fi
  return 1
}

require_project_id

attempts="${RULES_DEPLOY_ATTEMPTS:-5}"
if [[ ! "$attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::RULES_DEPLOY_ATTEMPTS must be a positive integer. Got: $attempts" >&2
  exit 1
fi

read -r -a backoff <<< "${RULES_DEPLOY_BACKOFF:-15 30 60 120}"
if [[ "${#backoff[@]}" -eq 0 ]]; then
  echo "::error::RULES_DEPLOY_BACKOFF is empty" >&2
  exit 1
fi
for delay in "${backoff[@]}"; do
  if [[ ! "$delay" =~ ^[0-9]+$ ]]; then
    echo "::error::RULES_DEPLOY_BACKOFF must be whole seconds. Got: $delay" >&2
    exit 1
  fi
done

# Words after `differ` are firestore, indexes, storage. Anything else,
# including a live check that could not be read, deploys all three. Deploying
# more than changed still refuses hosting if it fails. Deploying less would
# ship a site ahead of a rules release.
select_targets() {
  local line="$1"
  local full="firestore:rules,firestore:indexes,storage"
  local -a words=()
  read -r -a words <<< "$line"
  if [[ "${words[0]:-}" != "differ" || "${#words[@]}" -lt 2 ]]; then
    echo "$full"
    return
  fi
  local firestore=0 indexes=0 storage=0 word
  for word in "${words[@]:1}"; do
    case "$word" in
      firestore) firestore=1 ;;
      indexes) indexes=1 ;;
      storage) storage=1 ;;
      *)
        echo "$full"
        return
        ;;
    esac
  done
  local targets=""
  if [[ "$firestore" -eq 1 ]]; then targets="firestore:rules"; fi
  if [[ "$indexes" -eq 1 ]]; then targets="${targets:+$targets,}firestore:indexes"; fi
  if [[ "$storage" -eq 1 ]]; then targets="${targets:+$targets,}storage"; fi
  if [[ -z "$targets" ]]; then
    echo "$full"
    return
  fi
  echo "$targets"
}

script_dir="$(cd "$(dirname "$0")" && pwd)"
log="$(mktemp)"
live_out="$(mktemp)"
trap 'rm -f "$log" "$live_out"' EXIT

set +e
if [[ -n "${RULES_LIVE_BIN:-}" ]]; then
  "$RULES_LIVE_BIN" >"$live_out"
else
  node "$script_dir/rules-live.mjs" >"$live_out"
fi
live_status=$?
set -e
live_line="$(tr -d '\r' <"$live_out" | head -n 1)"

if [[ "$live_status" -eq 0 && "$live_line" == "match" ]]; then
  echo "Live Firestore rules, Storage rules and indexes match this commit. Skipping the Rules API deploy."
  exit 0
fi

targets="firestore:rules,firestore:indexes,storage"
if [[ "$live_status" -eq 10 ]]; then
  targets="$(select_targets "$live_line")"
  echo "Live release differs (${live_line}). Deploying ${targets}."
else
  echo "::warning::Could not confirm the live rules release (exit ${live_status}). Deploying rules, indexes and storage." >&2
fi

attempt=1
while true; do
  set +e
  firebase_cli deploy \
    --only "$targets" \
    --project "$PROJECT_ID" \
    --non-interactive \
    2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -eq 0 ]]; then
    if [[ "$attempt" -gt 1 ]]; then
      echo "Rules deploy succeeded on attempt ${attempt}/${attempts}."
    fi
    exit 0
  fi

  retryable=0
  if transient_failure "$log"; then
    retryable=1
  fi

  if [[ "$retryable" -eq 0 || "$attempt" -ge "$attempts" ]]; then
    if [[ "$retryable" -eq 1 ]]; then
      echo "::error::Rules deploy failed after ${attempts} attempts. Hosting will not deploy." >&2
    else
      echo "::error::Rules deploy failed with a non-transient error. Not retrying. Hosting will not deploy." >&2
    fi
    exit "$status"
  fi

  idx=$((attempt - 1))
  last=$((${#backoff[@]} - 1))
  if [[ "$idx" -gt "$last" ]]; then
    idx=$last
  fi
  delay="${backoff[$idx]}"
  echo "::warning::Rules deploy attempt ${attempt}/${attempts} hit a transient Rules API error. Retrying in ${delay}s." >&2
  sleep_backoff "$delay"
  attempt=$((attempt + 1))
done
