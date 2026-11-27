# ratelimit.sh — the rate limiter in front of the results API.
# Use it like this:   source ratelimit.sh; allow_request <client id> && echo "200 OK" || echo "429 Too Many Requests"
#
#   allow_request <client id>   returns 0 if the request may go ahead, 1 if it must be refused with 429
#
# Settings, read on every call: RATE_LIMIT (requests, default 5) per RATE_WINDOW (seconds, default 60).
#
# TODO: every request is allowed. Implement the limiter described in the README.

allow_request() {
  return 0
}
