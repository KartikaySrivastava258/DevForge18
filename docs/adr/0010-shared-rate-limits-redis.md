# ADR 0010 — Shared rate limits in Redis, failing open to per-process limits

- **Status:** Accepted (2026-11-27). Amends the "Consequences" of [ADR 0004](0004-auth-sessions.md).

## Context

ADR 0004 keeps rate-limit counters in memory: per process, reset on restart. With two or more DevForge instances behind Nginx, each instance counts on its own, so the per-account brute-force limit (10 failed logins per 15 minutes) becomes 10 × N, and a client can multiply the per-IP limits by spreading requests. REMAINING_WORK.md §6.4 asks for shared limits in Redis when more than one instance runs. The repository's rule is that no runtime dependency is added without an ADR.

## Problem

1. Where the counters live when several instances run, and how they are updated safely under concurrency.
2. Which Redis client to use.
3. What happens when Redis is unreachable or slow.

## Options considered

### Counters

- **Fixed window in Redis with one Lua script** (`INCR`, then `PEXPIRE` if the key has no TTL, returning count and TTL): atomic on the server, one round trip, the same semantics as the in-memory `FixedWindowLimiter`, so limits and `Retry-After` behave the same.
- `MULTI`/`EXEC` with `INCR` + `PEXPIRE NX`: also atomic, but resets the TTL decision per call and needs `NX` (Redis ≥ 7.0); the script works on any Redis with Lua.
- Sliding window (sorted set per key): smoother, but more memory and commands per hit; not needed for these coarse limits.
- Counters in SQLite: a single shared file does not exist across hosts.

### Client

- **`redis` (node-redis) 5.12.2** (2026-11-11, the newest release at least 14 days old on 2026-11-27; 6.4.0 is from 2026-11-23): `@redis/client` alone adds 2 packages (`@redis/client`, `cluster-key-slot`); the `redis` meta-package adds 4 more modules. Mature, with reconnection, RESP3, cluster and sentinel.
- **`ioredis` 6.0.0** (2026-07-31): similar scope.
- **A minimal RESP2 client over `node:net`/`node:tls`** (`server/src/redis/client.ts`, about 230 lines): the limiter needs `EVAL` and `DEL`, plus `AUTH`/`SELECT` from the URL.

### When Redis is unavailable

- **Fail closed** (answer 429 or 503): the `api` limiter guards every API request, so a Redis outage would become a full DevForge outage, sign-in included.
- **Fail open with no limit**: removes the brute-force defence exactly when something is already wrong.
- **Fail open to the per-process limiter**: each instance enforces the same limits on its own counters, which is exactly ADR 0004's original guarantee (at most N × limit).

## Decision

- With `REDIS_URL` (`redis://` or `rediss://`, optional user, password and database number) all four limiters (`register`, `loginByIp`, `loginFailuresByEmail`, `api`) count in Redis with the Lua fixed-window script. Without it, the in-memory limiters are used exactly as before.
- Keys are `devforge:rl:<limiter>:<sha256 of the limiter key>`: the limiter keys contain IP addresses and e-mail addresses, and Redis never stores them in clear text. (A hash of a low-entropy value is pseudonymous, not anonymous: Redis must stay on a private network, like the database.)
- **Client:** the minimal RESP2 client. It is clearly simpler here: two commands, one connection, no Pub/Sub, cluster or RESP3, and no new supply chain to watch. It is safe because commands are always sent as RESP arrays of bulk strings (no string concatenation of user data into commands), replies are parsed with length checks, a reply buffer above 1 MB closes the connection, and a timed-out command closes the connection so a late reply can never be matched to the next command. The password is never logged (logs show `host:port` only). It is tested with a fake TCP server (AUTH/SELECT, error replies, timeouts, refused connections), with every prefix of a reply, and against a real Redis 7.4.11.
- **Timeouts:** connect 1000 ms, command 500 ms (Redis on the same network answers in well under a millisecond).
- **Redis unavailable → fail open to the per-process limiter**, with a `warn` log line when Redis goes down and an `info` line when it is back (not one per request), and three metrics on `/metrics`: `devforge_rate_limit_store_up` (0/1), `devforge_rate_limit_fallbacks_total`, `devforge_rate_limit_store_errors_total`. After a failure the store does not try Redis again for 5 s, so an outage costs one timeout per 5 s, not one per request. Alert on `devforge_rate_limit_store_up == 0`.

## Positive consequences

- One limit across all instances: tested with two DevForge instances sharing one Redis (the third registration from an IP is refused whichever instance gets it; failed logins spread over both instances lock the account on both).
- No new runtime dependency; the in-memory path is unchanged for single-instance installs.
- A Redis outage degrades protection to the documented single-instance level instead of taking DevForge down.

## Negative consequences

- Each API request makes one Redis round trip.
- Fixed windows allow up to twice the limit across a window boundary (unchanged from ADR 0004's limiter).
- During an outage the limits are per instance (N × limit), and counters from the fallback are not merged into Redis afterwards.
- The minimal client must be maintained by us; it has no cluster, sentinel or RESP3 support.
- Sessions still live in SQLite on one host; running several instances also needs a shared database (ADR 0002's PostgreSQL item in REMAINING_WORK §6.4).

## Revisit when

DevForge needs more from Redis than counters (sessions, caching, queues, Pub/Sub), or Redis Cluster/Sentinel: then adopt `redis` (node-redis) with an exact pin and replace `server/src/redis/client.ts`.
