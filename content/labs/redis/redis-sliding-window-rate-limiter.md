---
id: redis-sliding-window-rate-limiter
title: Implement a rate limiter
track: redis
level: intermediate
mode: local
estimated_minutes: 35
prerequisites: [redis-caching-and-rate-limiting]
objectives:
  - Show how a fixed-window limiter lets twice the limit through around a window boundary.
  - Build a sliding-window limiter on a sorted set, run atomically as a Lua script.
  - Test a limiter at its edges with chosen timestamps instead of waiting for the clock.
checkpoints:
  - { id: boundary, text: "The fixed window allowed 6 requests within 2 seconds with a limit of 3 per minute" }
  - { id: sliding, text: "The sliding window blocked the request at second 61 and allowed the one at second 120" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Sorted sets
    url: https://redis.io/docs/latest/develop/data-types/sorted-sets/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: ZADD, ZCARD and ZREMRANGEBYSCORE, the commands the sliding window uses.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Scripting with Lua
    url: https://redis.io/docs/latest/develop/programmability/eval-intro/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: How EVAL runs a script atomically, and why keys are passed separately from arguments.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite against Redis 7 with redis-cli, and their output is compared with this page. Times are passed in as numbers, so the results are the same on every run. The check script is also run against an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

The lesson's limiter counts requests per fixed minute. You first make it fail — six requests in two seconds get through a limit of three per minute — then build a **sliding-window** limiter that cannot be fooled this way, make it **atomic** so it is correct with many servers, and test its edges with a check script.

## Before you start

You need Redis and `redis-cli`, as in *Caching and rate limiting*. Use a Redis you can experiment with: the lab writes keys starting with `rl:`.

Every function here takes the time as a number of seconds instead of reading the clock. That is a common trick for testing time-based code: you can try "second 59" and "second 61" right now instead of waiting a minute.

## Steps

### 1. The fixed window and its boundary

```bash run
fixed_window() {  # usage: fixed_window <user> <time in seconds>
  local key="rl:fixed:$1:$(( $2 / 60 ))"
  local count
  count=$(redis-cli --raw INCR "$key")
  [ "$count" -eq 1 ] && redis-cli EXPIRE "$key" 120 > /dev/null
  if [ "$count" -le 3 ]; then echo "t=$2 allowed"; else echo "t=$2 blocked"; fi
}
for t in 59 59 59 61 61 61; do fixed_window asha "$t"; done
```

```text output
t=59 allowed
t=59 allowed
t=59 allowed
t=61 allowed
t=61 allowed
t=61 allowed
```

Six requests in two seconds, all allowed. Seconds 0–59 and 60–119 are different windows (keys `…:0` and `…:1`), and each has a fresh count of three. A client that times its bursts around the boundary gets **twice** the limit.

### 2. A sliding window on a sorted set

Instead of a counter per minute, keep a **log**: one sorted-set member per allowed request, scored by its time. For each new request:

1. remove the entries older than 60 seconds (`ZREMRANGEBYSCORE`),
2. count what is left (`ZCARD`),
3. if there is room, record this request (`ZADD`).

Doing these as three separate commands has a race: two servers could both count 2 and both add a request. A **Lua script** run with `EVAL` executes inside Redis as one atomic step — no other command runs in between.

```bash run
cat > limiter.sh <<'EOF'
# Sliding-window rate limiter: at most LIMIT requests in any WINDOW seconds.
LIMIT=3
WINDOW=60
SLIDING_LUA='
local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - window)
if redis.call("ZCARD", key) < limit then
  redis.call("ZADD", key, now, member)
  redis.call("EXPIRE", key, window)
  return 1
end
return 0'
n=0
allow() {  # usage: allow <user> <time in seconds>; prints allowed or blocked
  n=$((n + 1))
  if [ "$(redis-cli --raw EVAL "$SLIDING_LUA" 1 "rl:sliding:$1" "$2" "$WINDOW" "$LIMIT" "$2-$n")" = 1 ]; then
    echo "t=$2 allowed"
  else
    echo "t=$2 blocked"
  fi
}
EOF
. ./limiter.sh
for t in 59 59 59 61 61 120 125; do allow asha "$t"; done
```

```text output
t=59 allowed
t=59 allowed
t=59 allowed
t=61 blocked
t=61 blocked
t=120 allowed
t=125 allowed
```

- At second 61, the three requests from second 59 are still inside the last 60 seconds, so the limiter refuses.
- At second 120, `ZREMRANGEBYSCORE` removes every entry with a score up to 60 — the three from second 59 — so there is room again.
- Each member is unique (`"$2-$n"`). Two requests in the same second would otherwise be the *same* member, and the second `ZADD` would only update it.

### 3. Look inside

```redis run
ZRANGE rl:sliding:asha 0 -1 WITHSCORES
```

```text output
1) "120-6"
2) "120"
3) "125-7"
4) "125"
```

Only the requests inside the window remain. The key also has an expiry, so a user who stops sending requests does not leave data behind.

The cost of the sliding log is memory: one entry per allowed request per user. For very high limits, teams use approximations (for example, weighting the previous fixed window's count), trading a little accuracy for memory.

## Check your work

Run this in the folder where you saved `limiter.sh`. It uses fresh keys, so you can run it any time.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
u="check-$$"
check "limiter.sh defines allow" '[ -f limiter.sh ] && . ./limiter.sh && type allow'
check "three requests at the same second are allowed" '. ./limiter.sh && for t in 10 10 10; do allow "$u-a" $t; done | grep -c allowed | grep -qx 3'
check "a fourth within 60 seconds is blocked" '. ./limiter.sh && for t in 10 10 10 69; do allow "$u-b" $t; done | tail -n 1 | grep -q blocked'
check "the boundary burst (59, then 61) is blocked" '. ./limiter.sh && for t in 59 59 59 61; do allow "$u-c" $t; done | tail -n 1 | grep -q blocked'
check "requests are allowed again after 60 seconds" '. ./limiter.sh && for t in 10 10 10 71; do allow "$u-d" $t; done | tail -n 1 | grep -q allowed'
redis-cli DEL "rl:sliding:$u-a" "rl:sliding:$u-b" "rl:sliding:$u-c" "rl:sliding:$u-d" > /dev/null 2>&1
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: limiter.sh defines allow
PASS: three requests at the same second are allowed
PASS: a fourth within 60 seconds is blocked
PASS: the boundary burst (59, then 61) is blocked
PASS: requests are allowed again after 60 seconds
All checks passed
```

## Reset

Delete the lab's keys with `redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli DEL`, then start again at step 1.

## What you practised

A limiter is only as good as its edges. Fixed windows are cheap but let bursts through at boundaries; a sliding log is exact but stores every request. Whatever you choose, make the read-check-write sequence atomic — here with one Lua script — so that many servers sharing one Redis still enforce one limit.
