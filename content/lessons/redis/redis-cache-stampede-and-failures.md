---
id: redis-cache-stampede-and-failures
title: Cache stampede and other failure modes
track: redis
order: 7
level: advanced
estimated_minutes: 40
prerequisites: [redis-caching-and-rate-limiting]
learning_objectives:
  - Reproduce a cache stampede — many requests missing the same key at once — and count the database queries it causes.
  - Prevent it with a short-lived lock (SET NX EX) so that one request recomputes and the others wait.
  - Recognise two more failure modes, cache penetration and synchronised expiry, and apply negative caching and TTL jitter.
resources:
  - title: SET — NX and EX options
    url: https://redis.io/docs/latest/commands/set/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: SET key value NX EX seconds — set only if the key does not exist, with an expiry; the basis of a simple lock.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: stampede
    prompt: A product page key with TTL 60 s is read 500 times a second. It expires. What happens without protection?
    options:
      - { id: a, text: "One request rebuilds it and the rest wait" }
      - { id: b, text: "Every request that arrives before the value is rebuilt misses the cache and queries the database — a stampede" }
      - { id: c, text: "Redis rebuilds it automatically" }
    answer: b
    explanation: Cache-aside code checks, misses and queries independently in each request. Until the first one writes the value back, all the others do the same expensive work.
  - id: lock
    prompt: Why does the lock use SET … NX EX 5 rather than SET … NX alone?
    options:
      - { id: a, text: "EX makes it faster" }
      - { id: b, text: "If the request holding the lock crashes, the lock expires by itself after 5 s instead of blocking everyone forever" }
      - { id: c, text: "NX does not work without EX" }
    answer: b
    explanation: A lock must always have a way out. The expiry should be longer than the recomputation normally takes.
  - id: penetration
    prompt: Bots request /products/99999, /products/99998 … — IDs that do not exist. Why does the cache not help, and what does?
    options:
      - { id: a, text: "It does help; nothing to do" }
      - { id: b, text: "Nothing is cached for missing rows, so every request reaches the database; caching a short-lived 'not found' marker stops the repeats" }
      - { id: c, text: "Increase the TTL of existing keys" }
    answer: b
    explanation: That is cache penetration. Negative caching (and rate limiting) keep requests for missing data from hammering the database.
verification:
  method: executed
  details: Every command is run by the test suite against Redis 7 with redis-cli, after the previous lessons, and its output is compared with this lesson. The "database" is a shell function that counts its calls and takes one second, so the counts are the same on every run.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A cache can make things *worse* in a few specific ways — a **stampede** when a hot key expires, **penetration** when requests ask for data that does not exist, and **synchronised expiry** when many keys end together — and each has a small, well-known fix.

## Explain it like I'm twelve

The school canteen's menu board is wiped every hour. The moment it is blank, fifty pupils all run to the kitchen to ask what is for lunch — and the cook can't cook. Better: the first pupil to see the blank board puts up a "being updated" sign and asks once; everyone else waits a moment and reads the new board.

The menu board is the **cache**, the rush to the kitchen is a **stampede**, and the sign is a **lock**.

Where the analogy breaks: in software, the "pupils" arrive within milliseconds, so the rush happens even when nobody is impatient.

## What problem it solves

Caches are added to protect a database — which then *depends* on the cache. If a popular key expires under load, or bots ask for nonsense IDs, the database can get more traffic than it ever saw without a cache, all at once. These failures appear exactly at peak times, which is why they are worth practising.

## How it works

![](media:redis/stampede.svg)

- **Stampede (dog-piling)**: many requests miss the same key at the same moment and all query the database. Fixes: a short **lock** with `SET lock:key token NX EX seconds`, so one request recomputes while the others wait and re-read; or refreshing popular keys *before* they expire.
- **Penetration**: requests for keys that do not exist always miss. Fix: cache a "not found" marker with a short TTL (**negative caching**), and rate-limit.
- **Synchronised expiry (avalanche)**: keys written together with the same TTL expire together. Fix: add random **jitter** to TTLs.

## Try it yourself

> **Local lab** — the Redis server from the earlier lessons and `redis-cli`. The "database" is a shell function that counts its calls and takes one second per query. Every command is run automatically in DevForge's tests.

### 1. A slow database and a plain cache-aside read

```bash run
db_query() {  # pretend database: counts calls, takes one second
  redis-cli INCR stats:db_queries > /dev/null
  sleep 1
  echo "timetable for $1"
}
read_plain() {  # cache-aside, no protection
  local value
  value=$(redis-cli GET "cache:$1")
  if [ -z "$value" ]; then
    value=$(db_query "$1")
    redis-cli SET "cache:$1" "$value" EX 60 > /dev/null
  fi
  echo "$value"
}
redis-cli DEL stats:db_queries cache:week1 > /dev/null
read_plain week1
read_plain week1
echo "database queries: $(redis-cli GET stats:db_queries)"
```

```text output
timetable for week1
timetable for week1
database queries: 1
```

One request at a time, the cache works: one miss, one hit.

### 2. Ten requests at the moment the key is missing

```bash run
redis-cli DEL stats:db_queries cache:week1 > /dev/null
for i in $(seq 1 10); do read_plain week1 > /dev/null & done; wait
echo "database queries: $(redis-cli GET stats:db_queries)"
```

```text output
database queries: 10
```

All ten requests looked at the cache before any of them had written the value back — so all ten queried the database. With a real page read hundreds of times a second and a query that takes a second, this is how a cache expiry can overload a database.

### 3. One rebuilds, the others wait

```bash run
read_locked() {
  local value
  for attempt in $(seq 1 50); do
    value=$(redis-cli GET "cache:$1")
    [ -n "$value" ] && { echo "$value"; return; }
    # Only one request gets the lock; it expires by itself if that request dies.
    if [ "$(redis-cli SET "lock:$1" "$$-$attempt" NX EX 5)" = OK ]; then
      # Look again: another request may have rebuilt the value and released the lock just now.
      value=$(redis-cli GET "cache:$1")
      [ -n "$value" ] || { value=$(db_query "$1"); redis-cli SET "cache:$1" "$value" EX 60 > /dev/null; }
      redis-cli DEL "lock:$1" > /dev/null
      echo "$value"; return
    fi
    sleep 0.1
  done
}
redis-cli DEL stats:db_queries cache:week1 lock:week1 > /dev/null
for i in $(seq 1 10); do read_locked week1 > answer-$i.txt & done; wait
echo "database queries: $(redis-cli GET stats:db_queries)"
echo "requests that got the timetable: $(cat answer-*.txt | grep -c 'timetable for week1')"
```

```text output
database queries: 1
requests that got the timetable: 10
```

- `SET lock:week1 … NX EX 5` succeeds for exactly one request (`NX`: only if the key does not exist). That request queries the database; the others see the lock fail, wait 0.1 s and look in the cache again.
- `EX 5` is the safety net: if the lock holder crashed, the lock would vanish after five seconds instead of blocking every request.
- The second `GET`, right after taking the lock, matters. Without it, a request can find the cache empty, then win the lock a moment *after* another request has filled the cache and released it — and query the database again. An earlier version of this lesson had exactly that bug: on a busy CI machine it made two queries instead of one. Checking again after acquiring the lock ("double-checked locking") closes the gap.
- Ten requests, one query — and every request still got its answer, a little later.

### 4. Cache penetration and negative caching

Requests for a week that does not exist:

```bash run
db_lookup() {  # pretend database: only weeks 1 to 12 exist
  redis-cli INCR stats:db_queries > /dev/null
  case "$1" in week[1-9]|week1[0-2]) echo "timetable for $1" ;; *) echo "" ;; esac
}
read_negative() {
  local value
  value=$(redis-cli GET "cache:$1")
  if [ -z "$value" ]; then
    value=$(db_lookup "$1")
    # Cache "not found" too, but only briefly, so a new week appears soon after it is created.
    if [ -n "$value" ]; then redis-cli SET "cache:$1" "$value" EX 60 > /dev/null
    else value="(not found)"; redis-cli SET "cache:$1" "$value" EX 10 > /dev/null; fi
  fi
  echo "$value"
}
redis-cli DEL stats:db_queries cache:week99 > /dev/null
for i in 1 2 3 4 5; do answer=$(read_negative week99); done
echo "answer: $answer"
echo "database queries for 5 requests: $(redis-cli GET stats:db_queries)"
```

```text output
answer: (not found)
database queries for 5 requests: 1
```

Without the "not found" marker, each of the five requests would have reached the database, because there is never a value to cache. The marker's short TTL (10 s) keeps the database protected without hiding a new week for long.

### 5. Jitter: do not let keys expire together

```bash run
for week in 1 2 3 4 5; do
  ttl=$((300 + RANDOM % 60))   # 5 minutes plus up to one minute of jitter
  redis-cli SET "cache:jitter:week$week" "timetable" EX "$ttl" > /dev/null
done
echo "distinct expiry times: $(for w in 1 2 3 4 5; do redis-cli TTL "cache:jitter:week$w"; done | sort -u | wc -l | tr -d ' ') of 5 (usually)"
```

```text output
distinct expiry times: … of 5 (usually)
```

Five keys written at the same moment with the same TTL would all expire in the same second — a small stampede for each, at once. Random jitter spreads the expiries out. (The count is random, so it is shown as `…`.)

## Common mistakes

- **Locks without an expiry.** A crashed lock holder then blocks every request forever.
- **Waiting forever for the lock.** Limit the retries (here 50 × 0.1 s) and fall back to the database or an error.
- **Caching "not found" for too long.** New data stays invisible; keep negative TTLs short.
- **Assuming the cache is always there.** If Redis is down, every request reaches the database; use short timeouts, and consider serving stale data or shedding load rather than overloading the database.

## Where this fits in a real system

The DevForge **Redis** simulation (*A cache under load*) lets you watch a stampede and its fixes over time; **Prometheus** dashboards of cache hit ratio and database query rate show stampedes in production; and the same thundering-herd problem appears in **Kafka** consumers and **Kubernetes** rollouts that all restart at once.
