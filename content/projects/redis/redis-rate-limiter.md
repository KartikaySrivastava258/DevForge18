---
id: redis-rate-limiter
track: redis
title: API rate limiter
level: intermediate
estimated_hours: 6
prerequisites: [redis-caching-and-rate-limiting, redis-transactions-and-lua]
related_tracks: [nginx, postman]
user_stories:
  - As a student checking results, I want the API to stay responsive on results day so that a few scripts refreshing in a loop cannot crowd me out.
  - As an operator of the API, I want one limit per client shared by all three API servers so that adding a server does not raise the limit.
  - As a developer of a client app, I want a refused request to stop counting against me so that my app can retry once the window has passed.
acceptance_criteria:
  - With RATE_LIMIT=5, eight quick requests from one client give five allowed and three refused, while another client is still allowed.
  - Twenty parallel requests from one client with RATE_LIMIT=5 allow exactly five.
  - Every key the limiter writes has an expiry of at most one window.
  - After the window has passed, the client is allowed again.
  - "The window slides: with RATE_LIMIT=3 and RATE_WINDOW=3, one request at 0 s and two at 1.5 s leave room for only one more at 3.3 s."
  - Refused requests are not counted, so retries do not extend a block beyond the window.
rubric:
  - { criterion: "Correctness of the window", excellent: "A sliding log on a sorted set with unique members, times from one clock (Redis TIME or one shared source), and a comment on why a fixed window allows a double burst.", good: "A sliding window that passes the boundary test.", needs_work: "A fixed window, or a window whose members collide when two requests share a timestamp." }
  - { criterion: "Atomicity", excellent: "The trim, count and record happen in one Lua script with keys passed through KEYS, and the README explains the race it prevents.", good: "Atomic under the concurrency test.", needs_work: "Separate commands with a gap in which parallel requests all see room." }
  - { criterion: "Resource use", excellent: "Every key expires one window after its last allowed request, refused requests write nothing, and memory per client is bounded by RATE_LIMIT members.", good: "Every key has an expiry.", needs_work: "Keys without an expiry, or a log that grows with refused requests." }
  - { criterion: "Fit for an API", excellent: "Settings read per call, a clear 0/1 contract, and a stretch goal such as Retry-After implemented or designed.", good: "The function can be dropped into a request handler as is.", needs_work: "Hard-coded limits or output that a caller has to parse." }
hints:
  - Start from the lab "Implement a rate limiter" — its sliding window is a sorted set with one member per allowed request, scored by time. Here the window is set in seconds, but use milliseconds for the scores so that requests a fraction of a second apart stay in order.
  - ZREMRANGEBYSCORE, ZCARD and ZADD as three separate redis-cli calls have a gap between counting and recording. Put all three in one EVAL script; Redis runs nothing else while a script runs.
  - Members must be unique. Two requests in the same millisecond with the same member would be stored once — add the process id or a random number to the time.
  - Inside a script, redis.call("TIME") returns seconds and microseconds from the Redis server, so all API servers use one clock.
  - "Test the boundary yourself: RATE_LIMIT=3 RATE_WINDOW=3, then one request, wait 1.5 s, two requests, wait 1.8 s, three requests. Only one of the last three may pass."
stretch_goals:
  - Add retry_after <client id>, which prints how many seconds until the client may send again (the age of the oldest entry in the window), for a Retry-After header.
  - Load the script once with SCRIPT LOAD and call it with EVALSHA, falling back to EVAL when Redis answers NOSCRIPT.
  - Compare memory use of the sliding log with a sliding-window counter (two fixed windows weighted by overlap) for a limit of 1,000 requests per hour.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college's results API runs on three servers behind a load balancer. On results day a few scripts that
refresh the results page in a loop take most of its capacity, and last term someone tried thousands of roll
numbers in an hour. The API needs a limit per client that all three servers share, so the counts must live in
Redis.

You will write `allow_request`, the function each server calls before handling a request. It must be correct
in the ways that matter in production: a **sliding** window (no double burst at a boundary), **atomic** under
parallel requests, keys that **expire** by themselves, and refused requests that do not extend a block. The
lesson *Caching and rate limiting* shows a fixed window; the lab *Implement a rate limiter* and *Transactions and
Lua scripts* give you the sliding window and the atomic step.

The starter's `ratelimit.sh` allows everything. The README in the starter is the specification.

## Getting started

1. Start a throwaway Redis as in *Keys, values and data structures*:

   ```bash
   docker run --name devforge-redis -p 127.0.0.1:6379:6379 -d redis:7
   ```

   You also need `redis-cli` on your computer, or work inside the container (`docker cp` the folder in, then
   `docker exec -it devforge-redis bash`).
2. Copy the starter into a folder and try it:

   ```bash
   source ratelimit.sh
   for i in 1 2 3 4 5 6 7; do allow_request asha && echo "200 OK" || echo "429 Too Many Requests"; done
   ```

3. Implement the limiter and watch what it stores: `redis-cli ZRANGE ratelimit:asha 0 -1 WITHSCORES`,
   `redis-cli PTTL ratelimit:asha`. Try twenty requests at once:
   `for i in $(seq 1 20); do (allow_request carol && echo A || echo R) & done; wait`.
4. Run the check. It needs Docker, starts its own Redis container and takes about 20 seconds, because it waits for
   windows to pass:

   ```bash
   bash check.sh path/to/your/project
   ```

5. When you are done: `docker rm -f -v devforge-redis`.
