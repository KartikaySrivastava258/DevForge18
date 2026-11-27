# ratelimit.sh — the rate limiter in front of the results API.
# Use it like this:   source ratelimit.sh; allow_request <client id> && echo "200 OK" || echo "429 Too Many Requests"
#
#   allow_request <client id>   returns 0 if the request may go ahead, 1 if it must be refused with 429
#
# Settings, read on every call: RATE_LIMIT (requests, default 5) per RATE_WINDOW (seconds, default 60).
#
# A sliding window, as in the lab "Implement a rate limiter": the sorted set ratelimit:<client> holds one member
# per allowed request, scored by its time in milliseconds. A request is allowed if fewer than RATE_LIMIT allowed
# requests happened in the last RATE_WINDOW seconds — in any window, not just in fixed minutes, so there is no
# double burst at a window boundary.

# The whole read-decide-write runs inside Redis as one atomic step: no other client's command can run between
# counting and adding, so parallel requests cannot all see "room for one more". The time comes from Redis (TIME),
# so every API server uses the same clock.
SLIDING_WINDOW_LUA='
local key, limit, window_ms, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3]
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - window_ms)
if redis.call("ZCARD", key) < limit then
  redis.call("ZADD", key, now, member)
  -- The set disappears by itself one window after the last allowed request.
  redis.call("PEXPIRE", key, window_ms)
  return 1
end
-- A refused request is not recorded, so a client that keeps retrying is not blocked for longer.
return 0'

allow_request() {
  local limit="${RATE_LIMIT:-5}" window="${RATE_WINDOW:-60}"
  # Members must be unique: two requests in the same millisecond would otherwise be one member.
  local member
  member="$(date +%s%N)-$$-$RANDOM"
  [ "$(redis-cli --raw EVAL "$SLIDING_WINDOW_LUA" 1 "ratelimit:$1" "$limit" "$((window * 1000))" "$member")" = 1 ]
}
