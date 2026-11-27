# Results API — rate limiter

The college's results API runs on three servers behind a load balancer. On results day, a few scripts that
refresh the page in a loop take most of its capacity, and last term someone tried thousands of roll numbers in
an hour. The API needs a rate limit per client, shared by all three servers — so the counts live in Redis.

## The file

`ratelimit.sh` is **your work**. The API servers call `allow_request <client id>` before every request and answer
`429 Too Many Requests` when it returns non-zero. Keep the function name and its exit status; you may add
helper functions.

## What the limiter must do

1. **Allow at most `RATE_LIMIT` requests per client in any `RATE_WINDOW` seconds.** Read both settings on every
   call (defaults 5 and 60). "Any" matters: a client must not get two full bursts by sending one just before and
   one just after a window boundary — use a sliding window.
2. **Keep clients apart.** One client's requests never block another. Use keys that contain the client id, such
   as `ratelimit:<client id>`.
3. **Hold under concurrency.** Requests from all servers can arrive at the same moment. Twenty simultaneous
   requests from one client with `RATE_LIMIT=5` must allow exactly five.
4. **Clean up after itself.** Every key the limiter writes must expire by itself, at most one window after it was
   last needed — a key that never expires would block a client for ever and use memory for ever.
5. **Count only allowed requests.** A refused request is not recorded, so a client that keeps retrying is allowed
   again as soon as its earlier allowed requests have left the window.

Each call may run in a new process on a different server, so everything the limiter remembers must be in Redis.
