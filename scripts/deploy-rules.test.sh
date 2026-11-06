#!/usr/bin/env bash
# Exercises deploy-rules.sh without a Firebase project. The fake CLI records
# argv and plays back scripted responses, one file per attempt.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/scripts/deploy-rules.sh"
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

fake="$tmp/fake-firebase"
sleepbin="$tmp/fake-sleep"
log="$tmp/firebase.log"
count="$tmp/count"
sleeplog="$tmp/sleep.log"
specs="$tmp/specs"
mkdir -p "$specs"

cat >"$fake" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
n=0
if [[ -f "$FAKE_COUNT" ]]; then
  n="$(cat "$FAKE_COUNT")"
fi
n=$((n + 1))
printf '%s' "$n" >"$FAKE_COUNT"
spec="$FAKE_SPECS/$n"
if [[ ! -f "$spec" ]]; then
  echo "no spec for call $n" >&2
  exit 99
fi
code="$(head -n 1 "$spec")"
tail -n +2 "$spec"
exit "$code"
EOF
chmod +x "$fake"

cat >"$sleepbin" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$1" >>"$SLEEP_LOG"
EOF
chmod +x "$sleepbin"

# Existing retry cases deploy every target. A live release that differs in
# all three parts is what selects that command. Match / partial deploys
# override RULES_LIVE_BIN.
live_all="$tmp/live-all"
cat >"$live_all" <<'EOF'
#!/usr/bin/env bash
echo "differ firestore indexes storage"
exit 10
EOF
chmod +x "$live_all"
export RULES_LIVE_BIN="$live_all"

reset() {
  rm -f "$log" "$count" "$sleeplog"
  rm -rf "$specs"
  mkdir -p "$specs"
  : >"$log"
  : >"$sleeplog"
}

write_spec() {
  local n="$1" code="$2"
  shift 2
  printf '%s\n' "$code" >"$specs/$n"
  if [[ "$#" -gt 0 ]]; then
    printf '%s\n' "$@" >>"$specs/$n"
  fi
}

# Runs the script. Stdout is left in "$tmp/stdout", stderr in "$err", status
# in "$run_status". mode is "default" (script defaults) or "custom".
err="$tmp/stderr"
run() {
  local project="$1" mode="$2" attempts="${3:-}" backoff="${4:-}"
  set +e
  if [[ "$mode" == "default" ]]; then
    env -u RULES_DEPLOY_ATTEMPTS -u RULES_DEPLOY_BACKOFF \
      PROJECT_ID="$project" \
      FIREBASE_BIN="$fake" \
      FAKE_LOG="$log" FAKE_COUNT="$count" FAKE_SPECS="$specs" \
      RULES_DEPLOY_SLEEP_BIN="$sleepbin" SLEEP_LOG="$sleeplog" \
      bash "$script" >"$tmp/stdout" 2>"$err"
  else
    env \
      PROJECT_ID="$project" \
      RULES_DEPLOY_ATTEMPTS="$attempts" \
      RULES_DEPLOY_BACKOFF="$backoff" \
      FIREBASE_BIN="$fake" \
      FAKE_LOG="$log" FAKE_COUNT="$count" FAKE_SPECS="$specs" \
      RULES_DEPLOY_SLEEP_BIN="$sleepbin" SLEEP_LOG="$sleeplog" \
      bash "$script" >"$tmp/stdout" 2>"$err"
  fi
  run_status=$?
  set -e
}

calls() {
  if [[ -f "$count" ]]; then
    cat "$count"
  else
    echo 0
  fi
}

# ── success on the first attempt: one deploy, no sleep ──────────────────────
reset
write_spec 1 0 "=== Deploying to 'ohsms-demo'... ===" "released rules firestore.rules"
run ohsms-demo default
assert_eq "$run_status" "0" "success exits 0"
assert_eq "$(calls)" "1" "success is a single attempt"
assert_eq "$(wc -l <"$sleeplog" | tr -d ' ')" "0" "success does not sleep"
assert_eq "$(cat "$log")" \
  "deploy --only firestore:rules,firestore:indexes,storage --project ohsms-demo --non-interactive" \
  "deploy argv"

# ── the v2.0.3 failure, then a clean compile ─────────────────────────────────
reset
# The production log wraps this line in CLI colour codes. The status is
# still in the text, and a pipe (no TTY) may or may not strip them.
write_spec 1 2 $'\033[1m\033[31mError:\033[39m\033[22m Request to https://firebaserules.googleapis.com/v1/projects/ohsms-demo:test had HTTP Error: 503, The service is currently unavailable.'
write_spec 2 0 "released rules firestore.rules"
run ohsms-demo default
assert_eq "$run_status" "0" "503 then success exits 0"
assert_eq "$(calls)" "2" "503 is retried once"
assert_eq "$(cat "$sleeplog")" "15" "first default backoff is 15s"
grep -q 'Retrying in 15s' "$err" || fail "retry did not warn"
grep -q 'succeeded on attempt 2/5' "$tmp/stdout" || fail "success after retry was not reported"

# ── defaults: five attempts, backoff 15 30 60 120, then fail closed ─────────
reset
for n in 1 2 3 4 5; do
  write_spec "$n" 2 "Error: Request to https://firebaserules.googleapis.com/v1/projects/ohsms-demo:test had HTTP Error: 503, The service is currently unavailable."
done
run ohsms-demo default
assert_eq "$run_status" "2" "exhausted 503 keeps the firebase exit code"
assert_eq "$(calls)" "5" "default is five attempts"
assert_eq "$(cat "$sleeplog")" "$(printf '%s\n' 15 30 60 120)" "default backoff sequence"
grep -q 'failed after 5 attempts' "$err" || fail "exhausted retry did not say it stopped"
grep -q 'Hosting will not deploy' "$err" || fail "exhausted retry did not keep hosting closed"

# ── 502 and 429 are the same class of transient failure ─────────────────────
reset
write_spec 1 2 "HTTP Error: 502, Bad Gateway"
write_spec 2 2 "HTTP Error: 429, Resource has been exhausted"
write_spec 3 0 "released rules"
run ohsms-demo custom 4 "1 2 4"
assert_eq "$run_status" "0" "502 and 429 are retried"
assert_eq "$(cat "$sleeplog")" "$(printf '%s\n' 1 2)" "configured backoff is honoured"

# ── 409 is the other status issue 5590 reports for this compiler ────────────
reset
write_spec 1 2 "HTTP Error: 409, Requested entity already exists."
write_spec 2 0 "latest version of firestore.rules already up to date, skipping upload"
run ohsms-demo custom 3 "0 0"
assert_eq "$run_status" "0" "409 is retried"
assert_eq "$(calls)" "2" "409 retries once"

# A live checker that answers differently on each invocation. Call 1 is the
# pre-deploy read. Later calls are the proof read after a transient error.
live_seq="$tmp/live-seq"
live_seq_n="$tmp/live-seq-n"
live_seq_dir="$tmp/live-seq-d"
mkdir -p "$live_seq_dir"
cat >"$live_seq" <<'EOF'
#!/usr/bin/env bash
n=0
if [[ -f "$LIVE_SEQ_N" ]]; then
  n="$(cat "$LIVE_SEQ_N")"
fi
n=$((n + 1))
printf '%s' "$n" >"$LIVE_SEQ_N"
spec="$LIVE_SEQ_DIR/$n"
if [[ ! -f "$spec" ]]; then
  echo "no live spec for call $n" >&2
  exit 1
fi
code="$(head -n 1 "$spec")"
tail -n +2 "$spec"
exit "$code"
EOF
chmod +x "$live_seq"

write_live() {
  local n="$1" code="$2" line="$3"
  printf '%s\n%s\n' "$code" "$line" >"$live_seq_dir/$n"
}

reset_live() {
  rm -f "$live_seq_n"
  rm -rf "$live_seq_dir"
  mkdir -p "$live_seq_dir"
}

live_calls() {
  if [[ -f "$live_seq_n" ]]; then
    cat "$live_seq_n"
  else
    echo 0
  fi
}

# ── v2.0.14: the first live read fails, :test 503s, a later proof matches ───
# The indexes list 400 made every read `unknown` before this fix. Once a
# read can confirm the release, hosting may proceed and :test is not called
# again. A read that stays unknown is still not a match.
reset
reset_live
write_spec 1 2 "Error: Request to https://firebaserules.googleapis.com/v1/projects/ohsms-demo:test had HTTP Error: 503, The service is currently unavailable."
write_spec 2 2 "Error: Request to https://firebaserules.googleapis.com/v1/projects/ohsms-demo:test had HTTP Error: 503, The service is currently unavailable."
write_live 1 1 "unknown"
write_live 2 0 "match"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 5 "0 0 0 0"
assert_eq "$run_status" "0" "503 then a confirmed live release exits 0"
assert_eq "$(calls)" "1" "a confirmed release stops further :test calls"
assert_eq "$(live_calls)" "2" "the proof read follows the transient error"
grep -q 'live release matches this commit' "$tmp/stdout" || fail "confirmed release after 503 was not reported"
grep -q 'Skipping the Rules API deploy' "$tmp/stdout" && fail "a failed first read must not skip before proof"
RULES_LIVE_BIN="$live_all"

# ── a deploy HTTP 400 is not rescued by a live release that matches ─────────
reset
reset_live
write_spec 1 1 "HTTP Error: 400, Request contains an invalid argument."
write_live 1 10 "differ firestore"
write_live 2 0 "match"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 4 "0 0 0"
assert_eq "$run_status" "1" "deploy 400 is not turned into a live match"
assert_eq "$(calls)" "1" "deploy 400 is not retried"
assert_eq "$(live_calls)" "1" "deploy 400 does not re-read the release"
grep -q 'live release matches this commit' "$tmp/stdout" && fail "deploy 400 was reported as released"
grep -q 'non-transient' "$err" || fail "deploy 400 was described as transient"
RULES_LIVE_BIN="$live_all"

# ── 409 after the release actually landed: prove it, then allow hosting ─────
reset
reset_live
write_spec 1 2 "HTTP Error: 409, Requested entity already exists."
write_live 1 10 "differ firestore"
write_live 2 0 "match"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 3 "0 0"
assert_eq "$run_status" "0" "409 plus a matching live release exits 0"
assert_eq "$(calls)" "1" "a proved release is not deployed again"
assert_eq "$(live_calls)" "2" "the proof read is a second live check"
grep -q 'live release matches this commit' "$tmp/stdout" || fail "proved release was not reported"
RULES_LIVE_BIN="$live_all"

# ── 409 while the release is still the old rules: do not claim success ──────
reset
reset_live
write_spec 1 2 "HTTP Error: 409, Requested entity already exists."
write_live 1 10 "differ firestore"
write_live 2 10 "differ firestore"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 1 "0"
assert_eq "$run_status" "2" "409 on a stale release keeps the firebase exit code"
assert_eq "$(calls)" "1" "a stale 409 is not retried past the cap"
grep -q 'live release matches this commit' "$tmp/stdout" && fail "stale 409 was reported as released"
grep -q 'Hosting will not deploy' "$err" || fail "stale 409 did not keep hosting closed"
RULES_LIVE_BIN="$live_all"

# ── a live read that fails is not proof the release landed ──────────────────
reset
reset_live
write_spec 1 2 "HTTP Error: 409, Requested entity already exists."
write_spec 2 0 "released rules"
write_live 1 10 "differ firestore"
write_live 2 1 "unknown"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 2 "0"
assert_eq "$run_status" "0" "unknown proof read still retries the deploy"
assert_eq "$(calls)" "2" "an unreadable release is not treated as live"
grep -q 'live release matches this commit' "$tmp/stdout" && fail "unreadable release was reported as released"
RULES_LIVE_BIN="$live_all"

# ── compilation error is not rescued by a live file that happens to match ───
reset
reset_live
write_spec 1 1 "Error: Compilation error in firestore.rules:" "[E] 10:1 - Unexpected '}'."
write_live 1 10 "differ firestore"
write_live 2 0 "match"
RULES_LIVE_BIN="$live_seq" LIVE_SEQ_N="$live_seq_n" LIVE_SEQ_DIR="$live_seq_dir" \
  run ohsms-demo custom 4 "0 0 0"
assert_eq "$run_status" "1" "compilation error is not turned into a live match"
assert_eq "$(calls)" "1" "compilation error still is not retried"
assert_eq "$(live_calls)" "1" "compilation error does not re-read the release"
RULES_LIVE_BIN="$live_all"

# ── transport errors, with no HTTP status line ──────────────────────────────
reset
write_spec 1 2 "Error: connect ECONNRESET firebaserules.googleapis.com"
write_spec 2 0 "released rules"
run ohsms-demo custom 3 "0 0"
assert_eq "$run_status" "0" "ECONNRESET is retried"
assert_eq "$(calls)" "2" "ECONNRESET retries once"

# ── a compilation error is the ruleset; retrying cannot fix it ──────────────
reset
write_spec 1 1 "Error: Compilation error in firestore.rules:" "[E] 10:1 - Unexpected '}'."
run ohsms-demo custom 5 "0 0 0 0"
assert_eq "$run_status" "1" "compilation error exits 1"
assert_eq "$(calls)" "1" "compilation error is not retried"
assert_eq "$(wc -l <"$sleeplog" | tr -d ' ')" "0" "compilation error does not sleep"
grep -q 'non-transient' "$err" || fail "compilation error was described as transient"

# ── 503 text buried under a compilation error still must not retry ──────────
reset
write_spec 1 1 "Error: Compilation error in firestore.rules:" "HTTP Error: 503, The service is currently unavailable."
run ohsms-demo custom 4 "0 0 0"
assert_eq "$(calls)" "1" "compilation error wins over a 503 line"
assert_eq "$run_status" "1" "mixed compilation error exits 1"

# ── auth and invalid-argument failures are not the compiler being down ──────
reset
write_spec 1 1 "HTTP Error: 400, Request contains an invalid argument."
run ohsms-demo custom 4 "0 0 0"
assert_eq "$run_status" "1" "400 exits immediately"
assert_eq "$(calls)" "1" "400 is not retried"

reset
write_spec 1 1 "HTTP Error: 403, The caller does not have permission"
run ohsms-demo custom 4 "0 0 0"
assert_eq "$run_status" "1" "403 exits immediately"
assert_eq "$(calls)" "1" "403 is not retried"

# ── an unrecognised failure fails closed on the first attempt ───────────────
reset
write_spec 1 2 "Error: An unexpected CLI failure that is not a transport error."
run ohsms-demo custom 4 "0 0 0"
assert_eq "$run_status" "2" "unknown failure keeps its exit code"
assert_eq "$(calls)" "1" "unknown failure is not retried"

# ── a bad project id never reaches the CLI ──────────────────────────────────
reset
run '../etc' custom 2 "0"
assert_eq "$run_status" "1" "bad project id is rejected"
assert_eq "$(calls)" "0" "bad project id does not invoke firebase"
run '' custom 2 "0"
assert_eq "$run_status" "1" "empty project id is rejected"
assert_eq "$(calls)" "0" "empty project id does not invoke firebase"

# ── live release already matches: do not call the Rules API ─────────────────
reset
write_spec 1 2 "HTTP Error: 503, The service is currently unavailable."
matchbin="$tmp/live-match"
cat >"$matchbin" <<'EOF'
#!/usr/bin/env bash
echo match
exit 0
EOF
chmod +x "$matchbin"
RULES_LIVE_BIN="$matchbin" run ohsms-demo default
assert_eq "$run_status" "0" "matching live release exits 0"
assert_eq "$(calls)" "0" "matching live release does not deploy"
grep -q 'Skipping the Rules API deploy' "$tmp/stdout" || fail "skip was not reported"
RULES_LIVE_BIN="$live_all"

# ── exit 0 without the match line is not a skip ─────────────────────────────
reset
write_spec 1 0 "released rules"
blankbin="$tmp/live-blank"
cat >"$blankbin" <<'EOF'
#!/usr/bin/env bash
echo "not-a-match"
exit 0
EOF
chmod +x "$blankbin"
RULES_LIVE_BIN="$blankbin" run ohsms-demo custom 2 "0"
assert_eq "$(calls)" "1" "exit 0 without match still deploys"
assert_eq "$(cat "$log")" \
  "deploy --only firestore:rules,firestore:indexes,storage --project ohsms-demo --non-interactive" \
  "unconfirmed match deploys every target"
RULES_LIVE_BIN="$live_all"

# ── only the parts that differ are deployed ─────────────────────────────────
reset
write_spec 1 0 "released storage rules"
storagebin="$tmp/live-storage"
cat >"$storagebin" <<'EOF'
#!/usr/bin/env bash
echo "differ storage"
exit 10
EOF
chmod +x "$storagebin"
RULES_LIVE_BIN="$storagebin" run ohsms-demo custom 2 "0"
assert_eq "$run_status" "0" "storage-only difference deploys"
assert_eq "$(cat "$log")" \
  "deploy --only storage --project ohsms-demo --non-interactive" \
  "storage-only target"
RULES_LIVE_BIN="$live_all"

# ── an unread live release deploys everything and can still block hosting ──
reset
write_spec 1 2 "HTTP Error: 503, The service is currently unavailable."
unknownbin="$tmp/live-unknown"
cat >"$unknownbin" <<'EOF'
#!/usr/bin/env bash
echo unknown
exit 1
EOF
chmod +x "$unknownbin"
RULES_LIVE_BIN="$unknownbin" run ohsms-demo custom 1 "0"
assert_eq "$run_status" "2" "unreadable live release keeps the firebase failure"
assert_eq "$(calls)" "1" "unreadable live release does not retry past the cap"
assert_eq "$(cat "$log")" \
  "deploy --only firestore:rules,firestore:indexes,storage --project ohsms-demo --non-interactive" \
  "unknown live release deploys every target"
grep -q 'Hosting will not deploy' "$err" || fail "unreadable live release failed open"
RULES_LIVE_BIN="$live_all"

# ── hosting cannot run unless the rules step succeeded ──────────────────────
assert_hosting_waits() {
  local file="$1"
  local name
  name="$(basename "$file")"
  grep -q 'id: rules' "$file" || fail "$name has no rules step id"
  grep -q 'bash scripts/deploy-rules.sh' "$file" || fail "$name does not retry via deploy-rules.sh"
  grep -Fq "steps.rules.outcome == 'success'" "$file" || fail "$name can deploy hosting without a rules release"
  awk '
    /- name: Deploy rules \+ indexes/ { grab=1; next }
    grab && /^      - name:/ { grab=0 }
    grab && /continue-on-error/ { bad=1 }
    END { exit bad ? 1 : 0 }
  ' "$file" || fail "$name marks the rules deploy continue-on-error"
}

assert_hosting_waits "$root/.github/workflows/deploy.yml"
assert_hosting_waits "$root/.github/workflows/deploy-staging.yml"

echo "deploy-rules: ok"
