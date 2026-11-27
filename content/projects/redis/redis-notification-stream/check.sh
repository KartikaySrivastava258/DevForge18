#!/usr/bin/env bash
# Acceptance check for "Real-time notification stream".
# Usage: bash check.sh path/to/your/project   (the folder with notify.sh)
# Needs Docker. Starts a throwaway Redis 7.4 container, copies your notify.sh into it and drives it like the
# email and push workers would — each call in a new shell, with handlers that succeed or fail on purpose — then
# reads the stream, the groups' pending lists and the dead-letter stream. Prints PASS or FAIL per criterion;
# non-zero exit if any fails. The container and its volume are removed at the end.
set -uo pipefail
dir="${1:-.}"
# redis:7.4.11-bookworm (the Debian variant, like the redis:7 image the lessons use), digest as listed on
# Docker Hub (pushed 2026-10-21).
image="redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b"
name="devforge-check-redis-stream-$$"
[ -f "$dir/notify.sh" ] || { echo "FAIL: $dir/notify.sh is missing"; echo "1 criterion check(s) failed."; exit 1; }

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The tests run inside the container, where redis-cli talks to the container's own Redis.
cat > "$tmp/tests.sh" <<'EOF_TESTS'
set -u
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; }
mkdir -p /work && cd /work
# Handlers the workers would run: one that sends (and records what it got), one whose provider is down.
cat > /check/handlers.sh <<'EOF'
sent() { printf '%s|%s|%s\n' "$1" "$2" "$3" >> "/work/sent-$HANDLER_LOG"; return 0; }
broken() { printf '%s\n' "$1" >> "/work/failed-$HANDLER_LOG"; return 1; }
EOF
# call <log name> <function> <args…>: one call in a new shell, as a worker process would make it.
call() {
  local log="$1"; shift
  HANDLER_LOG="$log" timeout 20 bash -c 'source /project/notify.sh > /dev/null; source /check/handlers.sh; "$@"' _ "$@"
}
lines() { [ -f "/work/$1" ] && wc -l < "/work/$1" | tr -d ' ' || echo 0; }
pending() { redis-cli --raw XPENDING notifications "$1" | head -n 1; }  # how many entries are pending in a group
is_pending() { [ "$(redis-cli --raw XPENDING notifications email "$1" "$1" 1 | head -n 1)" = "$1" ]; }  # in group email

if timeout 20 bash -c 'source /project/notify.sh > /dev/null; for f in setup_groups publish_notification consume recover; do declare -F "$f" > /dev/null || exit 1; done'; then
  pass "notify.sh defines setup_groups, publish_notification, consume and recover"
else
  fail "notify.sh must load with bash and define setup_groups, publish_notification, consume and recover"; echo DONE; exit 0
fi

# 1. Groups: created once, and a second run is harmless.
call x setup_groups > /dev/null 2>&1; first=$?
call x setup_groups > /dev/null 2>&1; second=$?
groups="$(redis-cli --raw XINFO GROUPS notifications 2> /dev/null | grep -xE 'email|push' | sort | tr '\n' ' ')"
if [ "$first" = 0 ] && [ "$second" = 0 ] && [ "$groups" = "email push " ]; then
  pass "setup_groups creates the consumer groups email and push on the stream notifications, and can run twice"
else
  fail "setup_groups must create the groups email and push on notifications and succeed when run again (exit codes $first and $second, groups found: ${groups:-none})"
  echo DONE; exit 0
fi

# 2. Publishing appends an entry with the user and the text (positive control for everything below).
id="$(call x publish_notification S1024 'Your DB201 result is out' 2> /dev/null | tail -n 1)"
fields="$(redis-cli --raw XRANGE notifications "$id" "$id" 2> /dev/null | tail -n +2 | tr '\n' '|')"
if [[ "$id" =~ ^[0-9]+-[0-9]+$ ]] && [ "$fields" = "user|S1024|text|Your DB201 result is out|" ]; then
  pass "publish_notification appends {user, text} to the stream and prints the entry's ID ($id)"
else
  fail "publish_notification S1024 'Your DB201 result is out' must print the new entry's ID and store the fields user and text (printed \"$id\", fields: \"$fields\")"
fi

# 3. Fan-out: each group gets every notification.
for n in 1 2 3; do call x publish_notification "S20$n" "Timetable change $n" > /dev/null 2>&1; done
call fanout-email consume email mailer-1 sent > /dev/null 2>&1
call fanout-push consume push pusher-1 sent > /dev/null 2>&1
e="$(cut -d'|' -f2,3 /work/sent-fanout-email 2> /dev/null | tr '\n' ';')"; p="$(cut -d'|' -f2,3 /work/sent-fanout-push 2> /dev/null | tr '\n' ';')"
want="S1024|Your DB201 result is out;S201|Timetable change 1;S202|Timetable change 2;S203|Timetable change 3;"
if [ "$e" = "$want" ] && [ "$p" = "$want" ]; then
  pass "both groups receive every notification, in order, with the user and text passed to the handler"
else
  fail "consume email … and consume push … must each hand all 4 notifications to the handler as <id> <user> <text> (email got \"$e\", push got \"$p\")"
fi
if [ "$(pending email)" = 0 ] && [ "$(pending push)" = 0 ] && [ "$(lines sent-fanout-email)" = 4 ]; then
  pass "entries the handler sent are acknowledged (nothing pending)"
else
  fail "after successful handlers nothing may be pending (pending: email $(pending email), push $(pending push)) — XACK each entry after its handler succeeds"
fi

# 4. Within one group, consumers share the work: no entry is handled twice.
for n in 1 2 3 4; do call x publish_notification "S30$n" "Fee reminder $n" > /dev/null 2>&1; done
BATCH=2 call share consume email mailer-1 sent > /dev/null 2>&1
BATCH=2 call share consume email mailer-2 sent > /dev/null 2>&1
handled="$(cut -d'|' -f1 /work/sent-share 2> /dev/null | sort | uniq | wc -l | tr -d ' ')"
if [ "$(lines sent-share)" = 4 ] && [ "$handled" = 4 ]; then
  pass "two consumers in one group share the entries: with BATCH=2, 4 notifications are handled once each"
else
  fail "with BATCH=2, mailer-1 and mailer-2 in group email must handle the 4 new notifications once each ($(lines sent-share) handled, $handled distinct)"
fi

# 5. A failing handler leaves the entry pending; recovery hands it to another consumer.
fid="$(call x publish_notification S401 'Library book overdue' 2> /dev/null | tail -n 1)"
call fail1 consume email mailer-1 broken > /dev/null 2>&1
owner="$(redis-cli --raw XPENDING notifications email - + 10 mailer-1 | head -n 1)"
if [ "$(lines failed-fail1)" = 1 ] && [ "$owner" = "$fid" ]; then
  pass "when the handler fails, the entry is not acknowledged: it stays pending with mailer-1"
else
  fail "a failed handler must leave its entry pending with the consumer that received it (handler calls: $(lines failed-fail1), pending with mailer-1: ${owner:-nothing})"
fi
call idle recover email mailer-2 60000 sent > /dev/null 2>&1
if ! is_pending "$fid"; then
  fail "not checked: no entry was pending, so there was nothing for recover to leave alone"
elif [ "$(lines sent-idle)" = 0 ]; then
  pass "recover leaves entries alone that have been pending for less than the minimum idle time"
else
  fail "recover email mailer-2 60000 must not take an entry that has been pending for less than 60 s (the handler was called $(lines sent-idle) time(s))"
fi
call rec recover email mailer-2 0 sent > /dev/null 2>&1
if [ "$(cat /work/sent-rec 2> /dev/null)" = "$fid|S401|Library book overdue" ] && ! is_pending "$fid"; then
  pass "recover hands the unacknowledged entry to mailer-2, whose handler sends it, and acknowledges it"
else
  fail "recover email mailer-2 0 sent must hand $fid (S401, Library book overdue) to the handler and acknowledge it (handler got \"$(cat /work/sent-rec 2> /dev/null)\", still pending: $(is_pending "$fid" && echo yes || echo no))"
fi

# 6. Dead letters: after DEAD_AFTER failed deliveries, the entry is parked and acknowledged.
did="$(call x publish_notification S402 'Hostel form due' 2> /dev/null | tail -n 1)"
DEAD_AFTER=3 call dead consume email mailer-1 broken > /dev/null 2>&1
DEAD_AFTER=3 call dead recover email mailer-2 0 broken > /dev/null 2>&1
after_two="$(redis-cli XLEN notifications:dead)"; pending_two="$(is_pending "$did" && echo yes || echo no)"
DEAD_AFTER=3 call dead recover email mailer-2 0 broken > /dev/null 2>&1
dead="$(redis-cli --raw XRANGE notifications:dead - + | tr '\n' '|')"
if [ "$(lines failed-dead)" = 3 ] && [ "$after_two" = 0 ] && [ "$pending_two" = yes ] && ! is_pending "$did" &&
  [[ "$dead" == *"|original_id|$did|"* ]] && [[ "$dead" == *"|S402|"* ]] && [[ "$dead" == *"|Hostel form due|"* ]]; then
  pass "after 3 failed deliveries the entry moves to notifications:dead (with original_id, user and text) and is acknowledged"
else
  fail "with DEAD_AFTER=3, an entry whose handler fails 3 times must stay pending after 2 failures, then go to notifications:dead with original_id, user and text and be acknowledged (handler calls $(lines failed-dead), dead entries after 2 failures: $after_two, pending after 2 failures: $pending_two, pending now: $(is_pending "$did" && echo yes || echo no), dead stream: ${dead:-empty})"
fi

# 7. Nothing new: consume returns without calling the handler.
call none consume email mailer-1 sent > /dev/null 2>&1; status=$?
if [ "$status" = 0 ] && [ "$(lines sent-none)" = 0 ]; then pass "consume with nothing new returns 0 without calling the handler"
else fail "consume must return 0 and not call the handler when there is nothing new (status $status, handler calls $(lines sent-none))"; fi

# 8. The stream does not grow without limit.
STREAM_MAXLEN=50 timeout 60 bash -c 'source /project/notify.sh > /dev/null; for n in $(seq 1 300); do publish_notification "S5$n" "Bulk $n" > /dev/null; done'
len="$(redis-cli XLEN notifications)"
if [ "$len" -ge 50 ] && [ "$len" -le 200 ]; then pass "with STREAM_MAXLEN=50, publishing trims the stream (XLEN $len after 300 more entries)"
else fail "with STREAM_MAXLEN=50, publishing 300 entries must trim the stream to about 50 — XADD … MAXLEN ~ (XLEN is $len)"; fi
echo DONE
EOF_TESTS

docker run -d --name "$name" "$image" > /dev/null || { echo "FAIL: could not start Redis in Docker"; echo "1 criterion check(s) failed."; exit 1; }
for _ in $(seq 1 50); do [ "$(docker exec "$name" redis-cli PING 2> /dev/null)" = PONG ] && break; sleep 0.2; done
docker exec "$name" mkdir -p /check /project
docker cp "$tmp/." "$name:/check/" > /dev/null
docker cp "$dir/." "$name:/project/" > /dev/null
docker exec "$name" bash /check/tests.sh > "$tmp/out" 2>&1
grep -v '^DONE$' "$tmp/out"
failures="$(grep -c '^FAIL:' "$tmp/out")"
if ! grep -q '^DONE$' "$tmp/out"; then echo "FAIL: the tests stopped before the end"; failures=$((failures + 1)); fi
if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
echo "All criteria pass."
