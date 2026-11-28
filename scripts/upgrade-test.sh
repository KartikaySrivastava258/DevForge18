#!/usr/bin/env bash
# Upgrade, backup and restore test (release checklist item 7), following docs/deployment.md "Upgrades" and
# "Backups and restore". For each older version of DevForge (a git commit):
#
#   1. extract it with `git archive` into a temporary directory, build its content and start its server on a
#      throwaway database;
#   2. through its HTTP API, as a browser would (cookie jar, X-DevForge-CSRF header, Origin), create an admin
#      (with its `user:create`) and three learners with lesson progress and bookmarks and, where that version has
#      them, a passed and a failed quiz, verified simulation challenges and completed labs; record what each user
#      sees;
#   3. Upgrades: back up with the old version's `db:backup`, stop it, copy the database file, run the current
#      `db:migrate` on the copy, start the current server on it and check that every row of every existing table
#      survived, the same users sign in with the same passwords and see the same progress and bookmarks, and the
#      new features (certificates, cohorts and assignments, data export) work on their old data. A second copy
#      checks the other documented way: the current server applying the migrations at start-up;
#   4. Backups and restore: `db:backup` while the current server runs, a change after the backup, stop, restore
#      as documented (replace the file, delete -wal/-shm), start, and check the data is the backup's;
#   5. roll back as documented: restore the pre-upgrade backup and start the old version on it.
#
#   npm run test:upgrade                            # npm run build is run first (Upgrades step 2)
#   UPGRADE_FROM=eeac236 npm run test:upgrade       # one old version only (space-separated list of commits)
#   KEEP=1 npm run test:upgrade                     # keep the temporary directory (databases, logs)
#
# Needs the old commits in the local history (CI: actions/checkout with fetch-depth: 0), node_modules installed
# (the old versions use it through a symlink), curl and jq. Servers listen on free ports on 127.0.0.1.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# eeac236: Milestone 8 (migrations 0001-0004: quizzes, labs, simulations). 21ad03b: Phase 0, the first commit
# (migration 0001 only: users, sessions, lesson progress, bookmarks, audit log).
OLD_VERSIONS=${UPGRADE_FROM:-"eeac236 21ad03b"}
for tool in git curl jq node npm; do
  command -v "$tool" > /dev/null || { echo "$tool not found" >&2; exit 1; }
done
[ -d "$ROOT/node_modules" ] || { echo "Run npm ci first (node_modules is missing)" >&2; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/devforge-upgrade.XXXXXX")
mkdir -p "$WORK/logs"
SERVER_PID=""
STARTED_AT=$SECONDS
checks=0
failures=0
FAILED=()
TAG=""

cleanup() {
  local status=$?
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2> /dev/null || true; wait "$SERVER_PID" 2> /dev/null || true; fi
  if [ "$status" -ne 0 ]; then
    for log in "$WORK"/logs/*.log; do
      [ -f "$log" ] || continue
      echo "--- $(basename "$log") (last 25 lines)"
      tail -n 25 "$log"
    done
  fi
  if [ "${KEEP:-0}" = 1 ]; then echo "Kept $WORK"; else rm -rf "$WORK"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---- checks ---------------------------------------------------------------------------------------------------
pass() { checks=$((checks + 1)); echo "PASS  ${TAG}$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); FAILED+=("${TAG}$1"); echo "FAIL  ${TAG}$1"; }
check() { # check <description> <command...>
  local what=$1
  shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}
need() { # need <description> <command...>: like check, but returns non-zero on failure so the caller can stop
  local what=$1
  shift
  if "$@"; then pass "$what"; else fail "$what"; return 1; fi
}
note() { echo "      $*"; }
# A command that must succeed; its output is in $WORK/out.txt and is shown if it fails.
cmd_ok() {
  "$@" > "$WORK/out.txt" 2>&1 || { sed 's/^/        | /' "$WORK/out.txt" | tail -n 20; return 1; }
}
out_has() { grep -F -- "$1" "$WORK/out.txt" > /dev/null; }
same_json() { # same_json <expected file> <actual file>: equal after sorting keys; prints the difference if not
  diff <(jq -S . "$1") <(jq -S . "$2") > "$WORK/diff.txt" && return 0
  sed 's/^/        | /' "$WORK/diff.txt" | head -n 40
  return 1
}

# ---- processes --------------------------------------------------------------------------------------------------
# Every server and script gets the same, explicit environment: nothing from the caller's shell (Redis, tracing,
# GitHub, another DATABASE_PATH) may leak in. PASSWORD_HASH_LOG_N=14 keeps scrypt fast; TRUST_PROXY stays off.
UNSET=(-u REDIS_URL -u OTEL_EXPORTER_OTLP_ENDPOINT -u OTEL_EXPORTER_OTLP_TRACES_ENDPOINT -u OTEL_SERVICE_NAME
  -u GITHUB_TOKEN -u GITHUB_REPOSITORY -u GITHUB_API_URL -u CONTENT_PATH -u WEB_ROOT -u DATABASE_PATH -u PORT)
in_dir() { # in_dir <dir> <database> <command...>: run a command in a checkout with DATABASE_PATH=<database>
  local dir=$1 db=$2
  shift 2
  (cd "$dir" && exec env "${UNSET[@]}" NODE_ENV=production PASSWORD_HASH_LOG_N=14 TRUST_PROXY=false LOG_LEVEL=info \
    DATABASE_PATH="$db" "$@")
}
free_port() {
  node -e 'const s = require("node:net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });'
}
start_server() { # start_server <checkout dir> <database> <log name>: sets BASE, ORIGIN, SERVER_PID, SERVER_LOG
  local dir=$1 db=$2 port
  port=$(free_port)
  BASE="http://127.0.0.1:${port}"
  ORIGIN=$BASE
  SERVER_LOG="$WORK/logs/$3.log"
  # exec all the way down, so that $! is the server process itself and SIGTERM reaches it (= npm start).
  (cd "$dir" && exec env "${UNSET[@]}" NODE_ENV=production PASSWORD_HASH_LOG_N=14 TRUST_PROXY=false LOG_LEVEL=info \
    DATABASE_PATH="$db" HOST=127.0.0.1 PORT="$port" PUBLIC_ORIGIN="$ORIGIN" COOKIE_SECURE=false \
    node --disable-warning=ExperimentalWarning server/src/main.ts) > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 80); do
    curl -fsS "$BASE/api/ready" > /dev/null 2>&1 && return 0
    kill -0 "$SERVER_PID" 2> /dev/null || { SERVER_PID=""; echo "        server exited during start-up" >&2; return 1; }
    sleep 0.25
  done
  return 1
}
stop_server() { # SIGTERM, as a process manager would; succeeds only on a clean exit (status 0)
  local pid=$SERVER_PID status=0
  SERVER_PID=""
  kill -TERM "$pid" 2> /dev/null || return 1
  wait "$pid" || status=$?
  [ "$status" -eq 0 ] || { echo "        server exited with status $status" >&2; return 1; }
}

# ---- HTTP, as the browser does it ---------------------------------------------------------------------------------
# api <user> <METHOD> <path> [json]: one cookie jar per user. State-changing requests carry the CSRF header and
# the page's Origin (server/src/http/security.ts csrfProblem). Sets STATUS; the body is in $WORK/body.json.
api() {
  local jar="$WORK/jar-$1" method=$2 path=$3
  touch "$jar"
  local args=(-sS --max-time 30 -o "$WORK/body.json" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method")
  if [ "$method" != GET ]; then args+=(-H "Origin: $ORIGIN" -H "X-DevForge-CSRF: 1" -H "Sec-Fetch-Site: same-origin"); fi
  if [ $# -ge 4 ]; then args+=(-H "Content-Type: application/json" --data-binary "$4"); fi
  STATUS=$(curl "${args[@]}" "$BASE$path") || STATUS=000
}
api_ok() { # api_ok <expected status> <user> <METHOD> <path> [json]
  local want=$1
  shift
  api "$@"
  [ "$STATUS" = "$want" ] && return 0
  echo "        $2 $3 → HTTP $STATUS (expected $want): $(head -c 300 "$WORK/body.json")"
  return 1
}
body_has() { jq -e "$@" "$WORK/body.json" > /dev/null; } # body_has [--arg k v ...] <jq filter>
jq_true() { jq -e "$@" > /dev/null; }                     # jq_true [options] <jq filter> [file]
session_is() { # session_is <session token> <user>: the token alone (no jar) is a session of <user>
  STATUS=$(curl -sS --max-time 30 -o "$WORK/body.json" -w '%{http_code}' -b "df_session=$1" "$BASE/api/auth/me") || STATUS=000
  [ "$STATUS" = 200 ] && body_has --arg e "${EMAIL[$2]}" '.user.email == $e'
}
log_has() { grep -F -- "$1" "$SERVER_LOG" | grep -F -- "$2" > /dev/null; } # one server log line with both strings

# ---- users and content ------------------------------------------------------------------------------------------
declare -A EMAIL NAME PASS
EMAIL=([admin]=ada.admin@example.edu [alice]=alice.learner@example.edu [bob]=bob.learner@example.edu
  [carol]=carol.learner@example.edu [dave]=dave.after-backup@example.edu)
NAME=([admin]="Ada Admin" [alice]="Alice Learner" [bob]="Bob Learner" [carol]="Carol Learner" [dave]="Dave Late")
PASS=([admin]="mangrove-kettle-7319" [alice]="tangerine-otter-4821" [bob]="basalt-heron-0557"
  [carol]="velvet-quarry-2290" [dave]="pewter-lantern-6604")
LEARNERS=(alice bob carol)
login_json() { jq -nc --arg e "${EMAIL[$1]}" --arg p "${PASS[$1]}" '{email: $e, password: $p}'; }
register_json() { jq -nc --arg e "${EMAIL[$1]}" --arg n "${NAME[$1]}" --arg p "${PASS[$1]}" '{email: $e, displayName: $n, password: $p}'; }
login() { api_ok 200 "$1" POST /api/auth/login "$(login_json "$1")" && body_has --arg e "${EMAIL[$1]}" '.user.email == $e'; }

# Answers come from the built content.json of the version whose server is running ($CONTENT).
lesson_answers() { # lesson_answers <lesson> right|wrong
  jq -c --arg id "$1" --arg how "$2" '.lessons[] | select(.id == $id) | .self_check
    | map({(.id): (if $how == "right" then .answer else ([.options[].id] - [.answer])[0] end)}) | add | {answers: .}' "$CONTENT"
}
pass_lesson() {
  api_ok 200 "$1" POST "/api/lessons/$2/check" "$(lesson_answers "$2" right)" &&
    body_has '.passed and .saved and .progress.status == "completed"'
}
fail_lesson() {
  api_ok 200 "$1" POST "/api/lessons/$2/check" "$(lesson_answers "$2" wrong)" &&
    body_has '(.passed | not) and .saved and .progress.status == "in_progress"'
}
quiz_answers() { # quiz_answers <track> right|wrong ("z" is never a correct answer)
  jq -c --arg t "$1" --arg how "$2" '.quizzes[] | select(.track == $t) | .questions
    | map({(.id): (if $how == "right" then (.answer // .answers // .order // .pairs) else "z" end)}) | add | {answers: .}' "$CONTENT"
}

# snapshot <user> <file>: what the user sees through the API, normalised to the fields both versions return.
snapshot() {
  local user=$1 out=$2 parts="$WORK/snapshot"
  rm -rf "$parts" && mkdir "$parts"
  api_ok 200 "$user" GET /api/auth/me && jq '.user | {id, email, displayName, role}' "$WORK/body.json" > "$parts/1" || return 1
  api_ok 200 "$user" GET /api/me/progress &&
    jq '[.lessons[] | {lessonId, track, status, attempts, bestScore, startedAt, completedAt, updatedAt}] | sort_by(.lessonId)' \
      "$WORK/body.json" > "$parts/2" || return 1
  api_ok 200 "$user" GET /api/me/bookmarks &&
    jq '[.bookmarks[] | {type, id, createdAt, available}] | sort_by(.type, .id)' "$WORK/body.json" > "$parts/3" || return 1
  if [ "$FULL" = 1 ]; then
    api_ok 200 "$user" GET /api/me/labs && jq '.labs | sort_by(.labId)' "$WORK/body.json" > "$parts/4" || return 1
    api_ok 200 "$user" GET /api/me/quizzes && jq '.quizzes' "$WORK/body.json" > "$parts/5" || return 1
    api_ok 200 "$user" GET "/api/simulations/$SIM" && jq '.completed | sort' "$WORK/body.json" > "$parts/6" || return 1
  else
    for n in 4 5 6; do echo null > "$parts/$n"; done
  fi
  jq -s '{user: .[0], lessons: .[1], bookmarks: .[2], labs: .[3], quizzes: .[4], simulationChallenges: .[5]}' \
    "$parts/1" "$parts/2" "$parts/3" "$parts/4" "$parts/5" "$parts/6" > "$out"
}
user_list() { # user_list <file>: every account as the admin sees it
  api_ok 200 admin GET "/api/admin/users?limit=100" &&
    jq '{total, users: ([.users[] | {id, email, displayName, role}] | sort_by(.email))}' "$WORK/body.json" > "$1"
}
snapshot_all() { # snapshot_all <prefix>: <prefix>-<user>.json for every user, <prefix>-users.json for the admin view
  local u
  for u in admin "${LEARNERS[@]}"; do snapshot "$u" "$1-$u.json" || return 1; done
  user_list "$1-users.json"
}
same_snapshots() { # same_snapshots <expected prefix> <actual prefix>
  local u ok=0
  for u in admin "${LEARNERS[@]}" users; do same_json "$1-$u.json" "$2-$u.json" || { echo "        ($u differs)"; ok=1; }; done
  return "$ok"
}

# ---- the database, read directly ---------------------------------------------------------------------------------
cat > "$WORK/db-tool.mjs" << 'EOF'
// node db-tool.mjs <tables|dump|versions|check> <database> [table...]
import { DatabaseSync } from "node:sqlite";
const [cmd, path, ...rest] = process.argv.slice(2);
const db = new DatabaseSync(path);
const tables = () => db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
let out;
if (cmd === "tables") out = tables();
else if (cmd === "dump") out = Object.fromEntries(rest.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all().map((r) => JSON.stringify(r)).sort()]));
else if (cmd === "versions") out = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r) => r.version);
else if (cmd === "check") out = { integrity: db.prepare("PRAGMA integrity_check").get().integrity_check, foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length };
else throw new Error(`unknown command ${cmd}`);
db.close();
console.log(JSON.stringify(out));
EOF
db_tool() { node --disable-warning=ExperimentalWarning "$WORK/db-tool.mjs" "$@"; }
db_healthy() { [ "$(db_tool check "$1")" = '{"integrity":"ok","foreignKeyViolations":0}' ]; }
restore_backup() { # restore_backup <backup> <database>: docs/deployment.md "Backups and restore", with the server stopped
  cp "$1" "$2" && rm -f "$2-wal" "$2-shm"
}

# ---- the current version ----------------------------------------------------------------------------------------
echo "== current version: npm run build (Upgrades step 2)"
TAG="[current] "
need "npm run build" cmd_ok bash -c "cd '$ROOT' && npm run build" || exit 1
NEW_CONTENT="$ROOT/build/content.json"
NEW_MIGRATIONS=$(cd "$ROOT/server/src/db/migrations" && ls -- *.sql)
backup_refuses_missing_database() {
  ! in_dir "$ROOT" "$WORK/missing/devforge.db" npm run --silent db:backup -- "$WORK/missing-backup.db" > "$WORK/out.txt" 2>&1 &&
    out_has "No database at" && [ ! -e "$WORK/missing/devforge.db" ] && [ ! -e "$WORK/missing-backup.db" ]
}
check "db:backup refuses a DATABASE_PATH with no database and creates nothing there" backup_refuses_missing_database

# ---- one old version ----------------------------------------------------------------------------------------------
test_version() {
  local commit=$1 V="$WORK/$1" OLD="$WORK/$1/devforge" u
  TAG="[$commit] "
  mkdir -p "$OLD"
  local OLD_DB="$V/old/devforge.db" UP_DB="$V/upgraded/devforge.db" STARTUP_DB="$V/startup/devforge.db" RB_DB="$V/rollback/devforge.db"
  mkdir -p "$V/old" "$V/upgraded" "$V/startup" "$V/rollback"

  echo "== [$commit] old version: $(git -C "$ROOT" log -1 --format='%h %ad %s' --date=short "$commit" 2> /dev/null || echo 'not in this clone')"
  if ! git -C "$ROOT" cat-file -e "${commit}^{commit}" 2> /dev/null; then
    fail "commit $commit is in the local history (in CI, check out with fetch-depth: 0)"
    return
  fi
  git -C "$ROOT" archive "$commit" | tar -x -C "$OLD"
  ln -s "$ROOT/node_modules" "$OLD/node_modules"
  need "old version extracted with git archive; its content builds" cmd_ok bash -c "cd '$OLD' && npm run --silent content:build" || return 0
  CONTENT="$OLD/build/content.json"
  local OLD_MIGRATIONS PENDING
  OLD_MIGRATIONS=$(cd "$OLD/server/src/db/migrations" && ls -- *.sql)
  PENDING=$(comm -13 <(echo "$OLD_MIGRATIONS") <(echo "$NEW_MIGRATIONS"))
  note "old schema: $(echo "$OLD_MIGRATIONS" | tr '\n' ' ')"
  note "to apply:   $(echo "$PENDING" | tr '\n' ' ')"
  check "the old migrations are a prefix of the current ones" test -n "$PENDING" -a "$(comm -23 <(echo "$OLD_MIGRATIONS") <(echo "$NEW_MIGRATIONS"))" = ""

  # What this version has (quizzes, labs and simulations arrived with migrations 0002-0004).
  FULL=0
  if [ -f "$OLD/server/src/routes/labs.ts" ] && jq -e '(.quizzes // []) | length > 0' "$CONTENT" > /dev/null; then FULL=1; fi
  # Content items that exist in both versions, so progress on them must still count after the upgrade.
  local L1 L2 L3 T1 P1 QT="" RT=""
  read -r L1 L2 L3 < <(jq -r --slurpfile new "$NEW_CONTENT" \
    '[.lessons[] | select((.self_check | length) > 0) | .id as $id | select([$new[0].lessons[].id] | index($id)) | $id][:3] | join(" ")' "$CONTENT")
  T1=$(jq -r --arg id "$L1" '.lessons[] | select(.id == $id) | .track' "$CONTENT")
  P1=$(jq -r '.paths[0].slug' "$CONTENT")
  if [ "$FULL" = 1 ]; then
    QT=$(jq -r '.quizzes[0].track' "$CONTENT")
    SIM=$(jq -r --arg t "$QT" '[.simulations[] | select(.track == $t)][0].id' "$CONTENT")
    RT=$(jq -r --slurpfile new "$NEW_CONTENT" \
      '[.labs[] | select(.mode == "read-through") | .id as $id | select([$new[0].labs[].id] | index($id)) | $id][0] // ""' "$CONTENT")
  fi

  echo "== [$commit] old server: create users and data through its API"
  need "old server starts on a new database" start_server "$OLD" "$OLD_DB" "$commit-old" || return 0
  check "admin created with the old user:create" \
    cmd_ok in_dir "$OLD" "$OLD_DB" env DEVFORGE_NEW_PASSWORD="${PASS[admin]}" \
    npm run --silent user:create -- --email "${EMAIL[admin]}" --name "${NAME[admin]}" --role admin
  check "admin signs in" login admin
  for u in "${LEARNERS[@]}"; do
    check "$u registers (session cookie set)" api_ok 201 "$u" POST /api/auth/register "$(register_json "$u")"
  done
  check "alice passes the self-check of $L1" pass_lesson alice "$L1"
  check "alice fails the self-check of $L2 (in progress)" fail_lesson alice "$L2"
  check "alice bookmarks track $T1" api_ok 200 alice PUT "/api/me/bookmarks/track/$T1"
  check "alice bookmarks lesson $L2" api_ok 200 alice PUT "/api/me/bookmarks/lesson/$L2"
  check "alice bookmarks path $P1" api_ok 200 alice PUT "/api/me/bookmarks/path/$P1"
  check "bob passes the self-check of $L1" pass_lesson bob "$L1"
  check "bob starts $L2" api_ok 200 bob POST "/api/lessons/$L2/start"
  check "bob bookmarks lesson $L1" api_ok 200 bob PUT "/api/me/bookmarks/lesson/$L1"
  note "carol only registers (an account with no activity)"
  if [ "$FULL" = 1 ]; then
    check "alice passes the $QT quiz" api_ok 200 alice POST "/api/tracks/$QT/quiz/grade" "$(quiz_answers "$QT" right)"
    check "  … graded as passed and saved" body_has '.passed and .saved'
    check "bob fails the $QT quiz" api_ok 200 bob POST "/api/tracks/$QT/quiz/grade" "$(quiz_answers "$QT" wrong)"
    check "  … graded as not passed and saved" body_has '(.passed | not) and .saved'
    local c lab
    for c in $(jq -r --arg s "$SIM" '.simulations[] | select(.id == $s) | .challenges[].id' "$CONTENT"); do
      check "alice's $SIM/$c challenge is verified by replay on the server" \
        api_ok 200 alice POST "/api/simulations/$SIM/challenges/$c/verify" \
        "$(jq -c --arg s "$SIM" --arg c "$c" '.simulations[] | select(.id == $s) | .challenges[] | select(.id == $c) | {actions: .solution}' "$CONTENT")"
      check "  … passed and saved" body_has '.passed and .saved'
    done
    for lab in $(jq -r --arg t "$QT" '.labs[] | select(.track == $t and .mode == "local") | .id' "$CONTENT"); do
      check "alice completes local lab $lab (self-reported)" api_ok 200 alice POST "/api/labs/$lab/complete" \
        "$(jq -c --arg id "$lab" '.labs[] | select(.id == $id) | {checkpoints: [.checkpoints[].id]}' "$CONTENT")"
    done
    if [ -n "$RT" ]; then
      check "alice completes read-through lab $RT (graded: verified)" api_ok 200 alice POST "/api/labs/$RT/complete" \
        "$(jq -c --arg id "$RT" '.labs[] | select(.id == $id) | {answers: (.questions | map({(.id): .answer}) | add)}' "$CONTENT")"
      check "  … recorded as verified" body_has '.completed and .progress.evidence == "verified"'
    fi
  fi
  check "snapshot of what every user sees on the old server" snapshot_all "$V/old"
  check "the snapshot holds the data created (alice: 2 lessons, 3 bookmarks; bob: 2 lessons, 1 bookmark; carol: none; 4 accounts)" \
    jq_true -n --slurpfile a "$V/old-alice.json" --slurpfile b "$V/old-bob.json" --slurpfile c "$V/old-carol.json" --slurpfile l "$V/old-users.json" \
    '($a[0].lessons | map(.status) | sort) == ["completed", "in_progress"] and ($a[0].bookmarks | length) == 3
     and ($b[0].lessons | map(.status) | sort) == ["completed", "in_progress"] and ($b[0].bookmarks | length) == 1
     and ($c[0].lessons | length) == 0 and ($c[0].bookmarks | length) == 0 and $l[0].total == 4
     and ([$l[0].users[] | select(.role == "admin")] | length) == 1'
  if [ "$FULL" = 1 ]; then
    check "  … and alice's quiz pass, labs and simulation challenges; bob's failed quiz" \
      jq_true -n --slurpfile a "$V/old-alice.json" --slurpfile b "$V/old-bob.json" --argjson rt "$([ -n "$RT" ] && echo 1 || echo 0)" \
      '$a[0].quizzes[0].passed and ($a[0].simulationChallenges | length) >= 1 and ($a[0].labs | length) >= 1 + $rt
       and ($b[0].quizzes[0].passed | not) and ($b[0].quizzes[0].attempts == 1)'
  fi
  local alice_old_token=""
  alice_old_token=$(awk '$6 == "df_session" {print $7}' "$WORK/jar-alice" | tail -n 1)

  echo "== [$commit] Upgrades step 1: back up with the old version, stop it, copy the database"
  check "old db:backup while its server runs (integrity ok)" \
    cmd_ok in_dir "$OLD" "$OLD_DB" npm run --silent db:backup -- "$V/pre-upgrade.db"
  check "  … reports integrity ok and 4 users" out_has "(integrity ok, 4 user(s))"
  check "old server stops cleanly on SIGTERM" stop_server
  check "no -wal file left beside the database (WAL checkpointed at shutdown)" test ! -e "$OLD_DB-wal"
  cp "$OLD_DB" "$UP_DB"
  cp "$OLD_DB" "$STARTUP_DB"
  local TABLES
  TABLES=$(db_tool tables "$UP_DB" | jq -r '.[] | select(. != "schema_migrations")')
  db_tool dump "$UP_DB" $TABLES > "$V/rows-before.json"
  note "existing tables: $(echo $TABLES)"

  echo "== [$commit] Upgrades step 3: current db:migrate on the copy, then the current server"
  check "current db:migrate on the copy" cmd_ok in_dir "$ROOT" "$UP_DB" npm run --silent db:migrate
  check "  … applies exactly the newer migrations ($(echo $PENDING))" \
    out_has "Applied $(echo "$PENDING" | wc -l) migration(s) to $UP_DB: $(echo "$PENDING" | paste -sd, | sed 's/,/, /g')"
  check "schema_migrations lists every current migration" \
    test "$(db_tool versions "$UP_DB" | jq -r '.[]')" = "$NEW_MIGRATIONS"
  check "a second db:migrate has nothing to do" cmd_ok in_dir "$ROOT" "$UP_DB" npm run --silent db:migrate
  check "  … says the database is up to date" out_has "is up to date"
  db_tool dump "$UP_DB" $TABLES > "$V/rows-after.json"
  check "every row of every pre-existing table is unchanged" same_json "$V/rows-before.json" "$V/rows-after.json"
  check "integrity_check ok, no foreign key violations" db_healthy "$UP_DB"

  # The other documented route: the current server applies pending migrations at start-up.
  check "current server starts on a second copy and migrates it at start-up" start_server "$ROOT" "$STARTUP_DB" "$commit-startup"
  check "  … its log lists the applied migrations" log_has "migrations applied" "$(echo "$PENDING" | tail -n 1)"
  check "  … alice signs in there" login alice
  check "  … and it stops cleanly" stop_server

  CONTENT=$NEW_CONTENT
  need "current server starts on the migrated copy" start_server "$ROOT" "$UP_DB" "$commit-upgraded" || return 0
  if [ -n "$alice_old_token" ]; then
    check "alice's session from the old server is still valid" session_is "$alice_old_token" alice
  fi
  check "a wrong password is still refused" api_ok 401 alice POST /api/auth/login \
    "$(jq -nc --arg e "${EMAIL[alice]}" '{email: $e, password: "not-alices-password-1"}')"
  for u in admin "${LEARNERS[@]}"; do
    check "$u signs in with the same password" login "$u"
  done
  check "snapshot of what every user sees on the current server" snapshot_all "$V/new"
  check "same accounts and roles; same progress, bookmarks$([ "$FULL" = 1 ] && echo ", quiz attempts, labs, simulation challenges") for every user" \
    same_snapshots "$V/old" "$V/new"

  echo "== [$commit] newer features on the upgraded data"
  check "alice's data export holds her old progress and bookmarks" api_ok 200 alice GET /api/me/export
  check "  … same lessons, statuses, bookmarks and account" body_has --slurpfile s "$V/old-alice.json" \
    '([.lessonProgress[] | {lessonId: .lesson_id, status, completedAt: .completed_at}] | sort_by(.lessonId)) == ($s[0].lessons | map({lessonId, status, completedAt}))
     and ([.bookmarks[] | {type: .item_type, id: .item_id, createdAt: .created_at}] | sort_by(.type, .id)) == ($s[0].bookmarks | map({type, id, createdAt}))
     and .account.email == $s[0].user.email and .account.id == $s[0].user.id'
  if [ "$FULL" = 1 ]; then
    check "  … and her quiz attempt, labs and simulation challenges" body_has \
      '(.quizAttempts | length) == 1 and (.labProgress | length) >= 1 and (.simulationProgress | length) >= 1'
    check "alice's certificate status for $QT" api_ok 200 alice GET /api/me/certificates
    check "  … is eligible from the quiz and challenges she did on the old version" \
      body_has --arg t "$QT" '.tracks[] | select(.track == $t) | .eligible and .quiz.passed and .certificate == null'
    check "alice is issued the $QT certificate" api_ok 201 alice POST "/api/me/certificates/$QT"
    CERT=$(jq -r '.certificate.id' "$WORK/body.json")
    check "  … anyone can verify it" api_ok 200 carol GET "/api/certificates/$CERT"
    check "  … in alice's name" body_has --arg n "${NAME[alice]}" '.certificate.holder == $n and .certificate.revokedAt == null'
    check "bob (failed quiz) is not eligible" api_ok 409 bob POST "/api/me/certificates/$QT"
  fi
  check "admin creates a cohort" api_ok 201 admin POST /api/cohorts '{"name":"Upgrade test cohort"}'
  local COHORT CODE
  COHORT=$(jq -r '.cohort.id' "$WORK/body.json")
  CODE=$(jq -r '.cohort.joinCode' "$WORK/body.json")
  check "admin assigns lesson $L1" api_ok 201 admin POST "/api/cohorts/$COHORT/assignments" \
    "$(jq -nc --arg id "$L1" '{kind: "lesson", itemId: $id, dueAt: "2099-01-01T00:00:00Z"}')"
  for u in "${LEARNERS[@]}"; do
    check "$u joins with the code" api_ok 200 "$u" POST /api/cohorts/join "$(jq -nc --arg c "$CODE" '{code: $c}')"
  done
  check "alice's assignments" api_ok 200 alice GET /api/me/assignments
  check "  … show $L1 done, at the completion time recorded by the old version" body_has --slurpfile s "$V/old-alice.json" --arg id "$L1" \
    '.assignments | length == 1 and .[0].itemId == $id and .[0].status.state == "done"
     and .[0].status.completedAt == ($s[0].lessons[] | select(.lessonId == $id) | .completedAt)'
  check "carol's assignments" api_ok 200 carol GET /api/me/assignments
  check "  … show it not started" body_has '.assignments | length == 1 and .[0].status.state == "not_started"'
  check "alice passes $L2 on the current server (old in-progress row updated)" pass_lesson alice "$L2"
  check "  … second attempt recorded" body_has '.progress.attempts == 2'

  echo "== [$commit] Backups and restore with the current version"
  check "snapshot before the backup" snapshot_all "$V/before-backup"
  check "db:backup while the server runs" cmd_ok in_dir "$ROOT" "$UP_DB" npm run --silent db:backup -- "$V/backup.db"
  check "  … integrity ok, 4 users" out_has "(integrity ok, 4 user(s))"
  check "after the backup: alice bookmarks lesson $L3" api_ok 200 alice PUT "/api/me/bookmarks/lesson/$L3"
  check "after the backup: bob passes $L2" pass_lesson bob "$L2"
  check "after the backup: dave registers" api_ok 201 dave POST /api/auth/register "$(register_json dave)"
  check "server stops cleanly" stop_server
  check "restore: replace the database file with the backup, delete -wal/-shm" restore_backup "$V/backup.db" "$UP_DB"
  need "server starts on the restored database" start_server "$ROOT" "$UP_DB" "$commit-restored" || return 0
  for u in admin "${LEARNERS[@]}"; do check "$u signs in" login "$u"; done
  check "snapshot after the restore" snapshot_all "$V/restored"
  check "every user sees exactly the state at backup time" same_snapshots "$V/before-backup" "$V/restored"
  check "alice's post-backup bookmark is gone" jq_true --arg id "$L3" '[.bookmarks[] | select(.id == $id)] | length == 0' "$V/restored-alice.json"
  check "dave (registered after the backup) does not exist" api_ok 401 dave POST /api/auth/login "$(login_json dave)"
  if [ "$FULL" = 1 ]; then
    check "the certificate issued before the backup still verifies" api_ok 200 carol GET "/api/certificates/$CERT"
  fi
  check "server stops cleanly" stop_server
  check "restored database: integrity ok, no foreign key violations" db_healthy "$UP_DB"

  echo "== [$commit] Roll back: restore the pre-upgrade backup and run the old version"
  check "restore the pre-upgrade backup" restore_backup "$V/pre-upgrade.db" "$RB_DB"
  CONTENT="$OLD/build/content.json"
  need "old server starts on it" start_server "$OLD" "$RB_DB" "$commit-rollback" || return 0
  for u in admin "${LEARNERS[@]}"; do check "$u signs in" login "$u"; done
  check "snapshot on the rolled-back old server" snapshot_all "$V/rollback"
  check "every user sees exactly the pre-upgrade state" same_snapshots "$V/old" "$V/rollback"
  check "old server stops cleanly" stop_server
}

for version in $OLD_VERSIONS; do test_version "$version"; done

TAG=""
echo
echo "== summary: $((checks - failures))/$checks checks passed in $((SECONDS - STARTED_AT)) s (old versions: $OLD_VERSIONS)"
if [ "$failures" -ne 0 ]; then
  printf 'FAILED  %s\n' "${FAILED[@]}"
  exit 1
fi
