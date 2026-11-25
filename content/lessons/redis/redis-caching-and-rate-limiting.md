---
id: redis-caching-and-rate-limiting
title: Caching and rate limiting with Redis
track: redis
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [redis-data-structures]
learning_objectives:
  - Implement the cache-aside pattern and explain cache hits, misses and TTLs.
  - Explain why cached data goes stale and invalidate it when the source changes.
  - Build a fixed-window rate limiter with INCR and EXPIRE.
  - Explain why a rate limiter shared by several servers needs Redis rather than in-process memory.
resources:
  - title: PEXPIRE command (expiry options NX, XX, GT, LT)
    url: https://redis.io/docs/latest/commands/pexpire/
    publisher: Redis
    type: reference
    level: intermediate
    official: true
    why: Documents the NX option (set an expiry only when none exists, Redis 7.0+) used to repair the INCR/EXPIRE gap; EXPIRE accepts the same options.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Redis documentation
    url: https://redis.io/docs/latest/
    publisher: Redis
    type: documentation
    level: all
    official: true
    why: Command reference for SET with EX, INCR, EXPIRE (including the NX option) and TTL.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: stale
    prompt: A course title is changed in PostgreSQL, but the site keeps showing the old title for a minute. Why?
    options:
      - { id: a, text: "PostgreSQL needs a minute to save changes" }
      - { id: b, text: "The old title is still cached in Redis until its TTL expires; the update should also delete (invalidate) the cached key" }
      - { id: c, text: "Browsers cannot display new data for 60 seconds" }
    answer: b
    explanation: A cache is a copy. Until the copy expires or is deleted, readers see the old value. Deleting the key when the source changes makes the next read a miss that loads fresh data; the TTL limits how stale data can ever get if an invalidation is missed.
  - id: shared-limiter
    prompt: DevForge's own rate limiter keeps counters in the server's memory. What goes wrong if the college runs three DevForge servers behind a load balancer?
    options:
      - { id: a, text: "Nothing; each server sees every request" }
      - { id: b, text: "Each server counts only the requests it receives, so a client can make up to three times the limit; a shared Redis counter fixes this" }
      - { id: c, text: "The servers crash" }
    answer: b
    explanation: In-process counters are per server. A shared Redis key gives every server the same count, which is exactly why DevForge's decision record names Redis as the next step if it is scaled out.
  - id: incr-expire-gap
    prompt: The limiter runs INCR and then, only for the first request, EXPIRE. What can go wrong between those two commands?
    options:
      - { id: a, text: "Nothing; two commands are always atomic together" }
      - { id: b, text: "If the client crashes after INCR but before EXPIRE, the key never expires and the user stays blocked forever; use EXPIRE … NX on every request, a transaction or a script" }
      - { id: c, text: "Redis rejects EXPIRE on counters" }
    answer: b
    explanation: Each command is atomic, but a pair of commands is not. EXPIRE with the NX option (Redis 7+) sets an expiry only when none exists, so running it after every INCR heals a missing expiry. MULTI/EXEC transactions or Lua scripts make the pair atomic.
verification:
  method: executed
  details: Every Redis and shell block is run by the test suite against a throwaway Redis server, after the previous lesson, and its output is compared with this lesson. Confirmed in CI against Redis 7.4.12 (redis-cli 7.0.15) on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Cache-aside** keeps a short-lived copy of slow-to-fetch data in Redis and loads it from the source only on a miss, and a **rate limiter** uses a shared Redis counter to cap how often each client can act.

## Explain it like I'm twelve

Every morning, students ask the office for today's timetable. The first time, the clerk walks to the archive (slow), then pins a copy on the noticeboard with "valid until 10:00" written on it. Everyone else reads the noticeboard (fast). When the timetable changes, the clerk must take the old copy down — or people read the wrong one until 10:00.

A rate limiter is the canteen rule "three snacks per person per break", tracked on a tally sheet everyone shares. Where the analogies break: Redis applies the "valid until" automatically, and the tally can be shared by hundreds of servers at once.

## What problem it solves

Popular data — course pages, product details, dashboards — is read far more often than it changes. Fetching it from the database every time wastes capacity and adds delay. Caching the result for a short time removes most of that load.

Login forms, APIs and expensive operations need limits on how often one client can call them, to stop brute-force attacks and abuse. When an application runs on several servers, the count must be **shared**, or each server enforces the limit separately.

## How it works

```text
 cache-aside read
   app ──GET key──▶ Redis ── hit ──▶ return cached value
                      │
                     miss
                      ▼
                  database ── value ──▶ app ──SET key value EX 60──▶ Redis

 fixed-window rate limit (3 requests per 60 seconds)
   request ──INCR ratelimit:asha──▶ count
                 count == 1 → EXPIRE ratelimit:asha 60   (start the window)
                 count <= 3 → allow
                 count  > 3 → reject with 429 Too Many Requests
```

- **Hit**: the value was in the cache. **Miss**: it was not, so the app loads it and stores it.
- The **TTL** bounds how stale a cached value can become.
- **Invalidation**: when the source changes, delete the cached key so the next read reloads it.
- The limiter's window starts with the first request and ends when the key expires.

## Try it yourself

> **Local lab** — continue with the Redis server from the previous lesson. These steps use your shell and `redis-cli`; on Windows, run them inside WSL, or open a shell in the container with `docker exec -it devforge-redis sh`. Every block is run automatically in DevForge's CI against a throwaway Redis 7 server. Use a Redis you can empty.

### 1. A slow data source and a cache-aside function

Paste these shell functions into your terminal. `slow_db_lookup` stands in for a database query that takes a second:

```bash run
slow_db_lookup() {
  sleep 1
  echo "Programming Basics"
}

get_course_title() {
  local key="course:$1:title"
  local cached
  cached=$(redis-cli --raw GET "$key")
  if [ -n "$cached" ]; then
    echo "cache hit: $cached"
    return
  fi
  local value
  value=$(slow_db_lookup "$1")
  redis-cli SET "$key" "$value" EX 60 > /dev/null
  echo "cache miss, loaded: $value"
}
```

`--raw` prints plain values without quotes, which is what scripts want. A missing key prints an empty line, so `cached` is empty on a miss.

### 2. Miss, then hit

```bash run
get_course_title CS101
get_course_title CS101
```

```text output
cache miss, loaded: Programming Basics
cache hit: Programming Basics
```

The first call took about a second; the second returned immediately from Redis. Inspect the cached copy:

```redis run
GET course:CS101:title
TTL course:CS101:title
```

```text output
"Programming Basics"
(integer) 60
```

### 3. Invalidate when the source changes

Suppose the title is edited in the database. Until the key expires, readers would still get the old copy. The code that updates the database should also delete the cached key:

```redis run
DEL course:CS101:title
```

```text output
(integer) 1
```

The next read is a miss and loads fresh data:

```bash run
get_course_title CS101
```

```text output
cache miss, loaded: Programming Basics
```

### 4. A rate limiter: three requests per minute

```bash run
allow_request() {
  local key="ratelimit:$1"
  local count
  count=$(redis-cli --raw INCR "$key")
  if [ "$count" -eq 1 ]; then
    redis-cli EXPIRE "$key" 60 > /dev/null
  fi
  if [ "$count" -le 3 ]; then
    echo "request $count allowed"
  else
    echo "request $count blocked (429)"
  fi
}

for i in 1 2 3 4 5; do allow_request asha; done
```

```text output
request 1 allowed
request 2 allowed
request 3 allowed
request 4 blocked (429)
request 5 blocked (429)
```

The window started with the first request:

```redis run
GET ratelimit:asha
TTL ratelimit:asha
```

```text output
"5"
(integer) 60
```

When the key expires, the count starts again from zero. Because every server would call `INCR` on the same key, the limit holds across all of them — unlike DevForge's own limiter, which keeps counts in each server's memory and is documented as suitable for a single server only.

## Common mistakes

- **Caching without a TTL.** If an invalidation is ever missed, stale data stays forever.
- **Forgetting to invalidate on writes.** Users see old data until the TTL expires.
- **Caching everything.** Data that is rarely read, or must always be exact (account balances), gains little and risks errors.
- **Cache stampede.** When a popular key expires, hundreds of requests miss at once and all hit the database. Mitigations include short locks so only one request reloads, or refreshing before expiry.
- **A gap between `INCR` and `EXPIRE`.** If the client crashes in between, the key never expires and the user is blocked forever. Running `EXPIRE key 60 NX` after every `INCR` (Redis 7+) repairs a missing expiry; a transaction (`MULTI`/`EXEC`) or a script makes the pair atomic.

## Where this fits in a real system

In a backend, the cache-aside function lives in the service layer, between the API handlers and **PostgreSQL**. The rate limiter sits in front of sensitive endpoints such as sign-in, often alongside **Nginx**'s own edge limits. Cache hit ratio, Redis memory use and the number of `429` responses are exactly the metrics you would chart in **Prometheus and Grafana** to see whether the cache and limits are doing their job.
