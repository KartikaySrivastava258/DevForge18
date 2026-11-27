#!/usr/bin/env bash
# Acceptance check for "API rate limiter".
# Usage: bash check.sh path/to/your/project   (the folder with ratelimit.sh)
# Needs Docker. Starts a throwaway Redis 7.4 container, copies your ratelimit.sh into it and calls allow_request
# the way API servers would — each call in a new shell, some of them in parallel, some timed around a window
# boundary — then reads the keys the limiter left in Redis. Takes about 20 seconds. Prints PASS or FAIL per
# criterion; non-zero exit if any fails. The container and its volume are removed at the end.
set -uo pipefail
dir="${1:-.}"
# redis:7.4.11-bookworm (the Debian variant, like the redis:7 image the lessons use), digest as listed on
# Docker Hub (pushed 2026-10-21).
image="redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b"
name="devforge-check-redis-ratelimit-$$"
[ -f "$dir/ratelimit.sh" ] || { echo "FAIL: $dir/ratelimit.sh is missing"; echo "1 criterion check(s) failed."; exit 1; }

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The tests run inside the container, where redis-cli talks to the container's own Redis.
cat > "$tmp/tests.sh" <<'EOF_TESTS'
set -u
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; }
# req <limit> <window> <client>: one request in a new shell; prints A (allowed) or R (refused).
req() {
  if RATE_LIMIT="$1" RATE_WINDOW="$2" timeout 10 bash -c 'source /project/ratelimit.sh > /dev/null 2>&1; allow_request "$1" > /dev/null 2>&1' _ "$3"; then
    printf A
  else
    printf R
  fi
}
burst() { local i; for i in $(seq 1 "$4"); do req "$1" "$2" "$3"; done; }  # burst <limit> <window> <client> <n>
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

if timeout 10 bash -c 'source /project/ratelimit.sh > /dev/null; declare -F allow_request' > /dev/null 2>&1; then
  pass "ratelimit.sh defines allow_request"
else
  fail "ratelimit.sh must load with bash and define allow_request"; echo DONE; exit 0
fi

# 1. Positive control, then the limit: 5 requests per 60 s.
got="$(burst 5 60 alice 8)"
if [ "$got" = AAAAARRR ]; then pass "with RATE_LIMIT=5, the first 5 requests are allowed and the next 3 refused (AAAAARRR)"
else fail "with RATE_LIMIT=5 and RATE_WINDOW=60, 8 quick requests must give AAAAARRR (A allowed, R refused); got $got"; fi
still="$(burst 5 60 alice 1)"; got="$(burst 5 60 bob 1)"
if [ "$still" != R ]; then fail "not checked: alice is not blocked after 8 requests, so there is no limit to keep apart"
elif [ "$got" = A ]; then pass "each client has its own limit (bob is allowed while alice is blocked)"
else fail "another client must not be blocked by alice's requests (bob got $got)"; fi

# 2. Twenty requests at the same moment, as from several API servers: exactly the limit may pass.
for i in $(seq 1 20); do req 5 60 carol > "/tmp/par-$i" & done; wait
allowed="$(cat /tmp/par-* | tr -cd A | wc -c)"
if [ "$allowed" = 5 ]; then pass "20 parallel requests: exactly 5 allowed (the check-and-record step is atomic)"
else fail "20 parallel requests with RATE_LIMIT=5 must allow exactly 5, but $allowed were allowed — make counting and recording one atomic step (a Lua script)"; fi

# 3. Every key the limiter writes expires by itself.
keys="$(redis-cli --scan --pattern '*alice*'; redis-cli --scan --pattern '*carol*')"
bad=""
for k in $keys; do t="$(redis-cli PTTL "$k")"; { [ "$t" -gt 0 ] && [ "$t" -le 61000 ]; } || bad="$bad $k(PTTL $t)"; done
if [ -z "$keys" ]; then fail "no key in Redis contains the client id (expected keys such as ratelimit:alice)"
elif [ -z "$bad" ]; then pass "every key the limiter writes has an expiry of at most one window"
else fail "these keys never expire or outlive the window:$bad — a missing EXPIRE blocks the client for ever"; fi

# 4. After the window, the client may send again.
got="$(burst 3 2 dan 4)"; sleep 2.3; got="$got $(burst 3 2 dan 1)"
if [ "$got" = "AAAR A" ]; then pass "the limit resets: refused at the 4th request, allowed again after the 2-second window"
else fail "with RATE_LIMIT=3 and RATE_WINDOW=2: 4 quick requests, a pause of 2.3 s, one more must give \"AAAR A\"; got \"$got\""; fi

# 5. A sliding window: at most RATE_LIMIT requests in ANY RATE_WINDOW seconds, also across a boundary.
#    Start 0.2 s after a multiple of 3 seconds, so fixed windows — of either kind — would reset at 3.0 s or 3.2 s.
until [ $(( $(now_ms) % 3000 )) -ge 200 ] && [ $(( $(now_ms) % 3000 )) -lt 400 ]; do sleep 0.02; done
start="$(now_ms)"
a="$(burst 3 3 erin 1)"
until [ $(( $(now_ms) - start )) -ge 1500 ]; do sleep 0.02; done
b="$(burst 3 3 erin 2)"
until [ $(( $(now_ms) - start )) -ge 3300 ]; do sleep 0.02; done
c="$(burst 3 3 erin 3)"
if [ "$a $b $c" = "A AA ARR" ]; then
  pass "sliding window: after requests at 0 s and 1.5 s, only one more is allowed at 3.3 s (no double burst at a boundary)"
else
  fail "with RATE_LIMIT=3 and RATE_WINDOW=3: 1 request at 0 s, 2 at 1.5 s, 3 at 3.3 s must give \"A AA ARR\" — the two from 1.5 s are still inside the last 3 seconds; got \"$a $b $c\" (a fixed window resets and allows a second burst)"
fi

# 6. Refused requests do not count: a client that keeps retrying is not blocked for longer.
start="$(now_ms)"
a="$(burst 2 2 finn 2)"
until [ $(( $(now_ms) - start )) -ge 1000 ]; do sleep 0.02; done
b="$(burst 2 2 finn 4)"
until [ $(( $(now_ms) - start )) -ge 2400 ]; do sleep 0.02; done
c="$(burst 2 2 finn 1)"
if [ "$a $b $c" = "AA RRRR A" ]; then pass "refused requests are not counted: retries at 1 s do not extend the block past the window"
else fail "with RATE_LIMIT=2 and RATE_WINDOW=2: 2 requests at 0 s, 4 retries at 1 s, one at 2.4 s must give \"AA RRRR A\"; got \"$a $b $c\" — record only allowed requests"; fi
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
