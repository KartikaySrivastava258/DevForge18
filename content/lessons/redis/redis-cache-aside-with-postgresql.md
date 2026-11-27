---
id: redis-cache-aside-with-postgresql
title: Redis in front of PostgreSQL — cache-aside end to end
track: redis
order: 8
level: advanced
estimated_minutes: 40
prerequisites: [redis-cache-stampede-and-failures]
starts_fresh: true
learning_objectives:
  - Build cache-aside reads from a real PostgreSQL table through Redis, and count the database queries they save.
  - Keep the cache correct by deleting the cached copy after every write, and see the stale read you get when a write bypasses that path.
  - Keep serving reads from PostgreSQL when Redis is unavailable, with a short timeout instead of a hang.
resources:
  - title: SET — the EX option
    url: https://redis.io/docs/latest/commands/set/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: SET key value EX seconds stores a value with an expiry in one command.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: who-wins
    prompt: The cached copy of a course says 12 seats left; PostgreSQL says 11. Which is right, and why?
    options:
      - { id: a, text: "Redis, because it was read more recently" }
      - { id: b, text: "PostgreSQL — it is the source of truth; the cache only holds a copy, which is stale until it is deleted or expires" }
      - { id: c, text: "Whichever was written last" }
    answer: b
    explanation: In cache-aside the database owns the data. A disagreement always means the copy is stale, which is why every write must remove it.
  - id: bypass
    prompt: An administrator fixes a course's seats directly in psql. Students still see the old number for up to a minute. Why?
    options:
      - { id: a, text: "PostgreSQL has not committed the change" }
      - { id: b, text: "The change bypassed the application's write path, so nothing deleted the cached copy; it stays until its TTL ends" }
      - { id: c, text: "Redis is down" }
    answer: b
    explanation: Invalidation only happens where the code does it. The TTL is the safety net that bounds how long a missed invalidation can last.
  - id: redis-down
    prompt: Redis stops. What should the read path do?
    options:
      - { id: a, text: "Wait until Redis comes back" }
      - { id: b, text: "Give up on the cache after a short timeout and read PostgreSQL, so the service stays correct and only slower" }
      - { id: c, text: "Return an error for every request" }
    answer: b
    explanation: The cache is an optimisation; the database can answer every read. A short socket timeout keeps a dead cache from turning into a slow service.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with PostgreSQL 16.15, Redis 7.4.11 and Python 3.12 (psycopg 3.3.7, redis-py 8.1.0), all pinned by digest or version, and its output is compared with this lesson. First recorded on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

With **cache-aside**, the application reads Redis first and falls back to PostgreSQL on a miss, writes go to PostgreSQL and then **delete** the cached copy — so PostgreSQL stays the single source of truth and Redis only ever holds copies.

## Explain it like I'm twelve

The school office keeps the official register in a locked cabinet (PostgreSQL). A copy of today's page is pinned to the noticeboard (Redis), so nobody has to unlock the cabinet to check. When the office changes the register, it takes the old copy off the noticeboard; the next person who looks fetches a fresh copy. If someone changes the register and forgets to take the copy down, the noticeboard is wrong until the copy is replaced.

Where the analogy breaks: real copies also expire on their own after a set time (the TTL), which limits how long a forgotten copy can mislead anyone.

## What problem it solves

Earlier lessons cached a pretend database. With a real one you meet the questions that matter in production: how many queries the cache actually saves, what happens to the cache when data changes — through the application or behind its back — and what happens to the service when Redis itself fails. This lesson runs all three against PostgreSQL and Redis side by side.

## How it works

![](media:redis/cache-aside-postgresql.svg)

- **Read**: `GET course:<code>`. On a hit, answer from Redis. On a miss, `SELECT` from PostgreSQL, then `SET course:<code> <json> EX 60` and answer.
- **Write**: change PostgreSQL in a transaction; after the commit, `DEL course:<code>`. The next read misses and loads the new value. (Deleting is simpler and safer than writing the new value into the cache yourself: two concurrent writers cannot leave an older value behind.)
- **TTL**: every copy expires anyway, which bounds how long a missed invalidation — a write that bypassed the application — can serve stale data.
- **Failure**: the Redis client uses a short socket timeout; if Redis does not answer, the read goes straight to PostgreSQL.

## Try it yourself

> **Local lab** — needs Docker. PostgreSQL (`db`, user and password `college` — for this lab only), Redis (`cache`) and a Python container run on the `devforge-cache-net` network. Every command is run automatically in DevForge's tests.

### 1. PostgreSQL, Redis and a Python client

```bash run
PG_IMAGE=postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
REDIS_IMAGE=redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b
PY_IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
for image in "$PG_IMAGE" "$REDIS_IMAGE" "$PY_IMAGE"; do docker pull -q "$image" > /dev/null; done
docker network create devforge-cache-net > /dev/null
docker run -d --name devforge-cache-db --hostname db --network devforge-cache-net -e POSTGRES_USER=college -e POSTGRES_PASSWORD=college -e POSTGRES_DB=college "$PG_IMAGE" > /dev/null
docker run -d --name devforge-cache-redis --hostname cache --network devforge-cache-net "$REDIS_IMAGE" > /dev/null
docker run -d --name devforge-cache-py --network devforge-cache-net -w /lab "$PY_IMAGE" sleep infinity > /dev/null
docker exec devforge-cache-py pip install -q --root-user-action=ignore --disable-pip-version-check "psycopg[binary]==3.3.7" redis==8.1.0 > pip.log 2>&1 \
  || { cat pip.log; exit 1; }
sql() { docker exec -i devforge-cache-db psql -X -q -A -t -U college -d college "$@"; }
py() { docker exec -i devforge-cache-py python "$@"; }
for i in $(seq 1 60); do docker exec devforge-cache-db pg_isready -U college -d college -h 127.0.0.1 > /dev/null 2>&1 && break; sleep 1; done
sql <<'SQL'
CREATE TABLE courses (code text PRIMARY KEY, title text NOT NULL, seats_left int NOT NULL CHECK (seats_left >= 0));
INSERT INTO courses VALUES ('CS101', 'Programming Fundamentals', 12), ('CS201', 'Database Systems', 3), ('MA102', 'Discrete Mathematics', 40);
SQL
sql -c "SELECT count(*) || ' courses' FROM courses"
docker exec devforge-cache-redis redis-cli PING
```

```text output
3 courses
PONG
```

### 2. Cache-aside reads, and the queries they save

```bash run
docker exec -i devforge-cache-py sh -c 'cat > /lab/courses.py' <<'PY'
import json
import psycopg
import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

DB = "host=db dbname=college user=college password=college"
# The cache is optional: give up quickly (0.5 s) and do not retry; the database can answer instead.
cache = redis.Redis(host="cache", socket_timeout=0.5, socket_connect_timeout=0.5, retry=Retry(NoBackoff(), 0))
db_queries = 0

def get_course(code):
    """Cache-aside read: Redis first; on a miss (or if Redis fails) PostgreSQL, then keep a copy for 60 s."""
    global db_queries
    key = f"course:{code}"
    try:
        cached = cache.get(key)
        if cached is not None:
            return json.loads(cached), "cache"
    except redis.RedisError:
        cached = None
        source = "database (Redis unavailable)"
    else:
        source = "database"
    with psycopg.connect(DB) as conn:
        db_queries += 1
        row = conn.execute("SELECT code, title, seats_left FROM courses WHERE code = %s", (code,)).fetchone()
    course = {"code": row[0], "title": row[1], "seats_left": row[2]}
    try:
        cache.set(key, json.dumps(course), ex=60)
    except redis.RedisError:
        pass
    return course, source

def register(code):
    """Write path: change PostgreSQL in a transaction, then delete the cached copy."""
    with psycopg.connect(DB) as conn:
        conn.execute("UPDATE courses SET seats_left = seats_left - 1 WHERE code = %s", (code,))
    cache.delete(f"course:{code}")
PY
py <<'PY'
import courses
for i in range(5):
    course, source = courses.get_course("CS101")
    print(f"read {i + 1}: {course['seats_left']} seats from {source}")
print("database queries for 5 reads:", courses.db_queries)
print("TTL of course:CS101 between 1 and 60 s:", 0 < courses.cache.ttl("course:CS101") <= 60)
PY
```

```text output
read 1: 12 seats from database
read 2: 12 seats from cache
read 3: 12 seats from cache
read 4: 12 seats from cache
read 5: 12 seats from cache
database queries for 5 reads: 1
TTL of course:CS101 between 1 and 60 s: True
```

One query, then four answers from memory. Under real traffic the ratio is what decides how much load the database is spared.

### 3. Writes delete the copy

```bash run
py <<'PY'
import courses
courses.register("CS101")
course, source = courses.get_course("CS101")
print(f"after registering: {course['seats_left']} seats from {source}")
course, source = courses.get_course("CS101")
print(f"next read: {course['seats_left']} seats from {source}")
PY
```

```text output
after registering: 11 seats from database
next read: 11 seats from cache
```

The write deleted `course:CS101`, so the next read missed, loaded 11 from PostgreSQL and cached it again.

### 4. A write that bypasses the application

```bash run
sql -c "UPDATE courses SET seats_left = 30 WHERE code = 'CS101'"
py <<'PY'
import courses
course, source = courses.get_course("CS101")
print(f"application shows {course['seats_left']} seats (from {source})")
PY
echo "PostgreSQL has $(sql -c "SELECT seats_left FROM courses WHERE code = 'CS101'") seats"
docker exec devforge-cache-redis redis-cli DEL course:CS101 > /dev/null
py <<'PY'
import courses
course, source = courses.get_course("CS101")
print(f"after deleting the key: {course['seats_left']} seats (from {source})")
PY
```

```text output
application shows 11 seats (from cache)
PostgreSQL has 30 seats
after deleting the key: 30 seats (from database)
```

The administrator's change went straight to PostgreSQL, so nothing deleted the copy: readers see 11 until the key is deleted or its TTL runs out. Every write path — scripts, admin tools, migrations — must invalidate, or you must accept staleness up to the TTL.

### 5. Redis fails; reads carry on

```bash run
docker stop devforge-cache-redis > /dev/null
py <<'PY'
import time
import courses
start = time.monotonic()
course, source = courses.get_course("CS201")
print(f"read: {course['seats_left']} seats from {source}")
print("answered within 1 s:", time.monotonic() - start < 1)
PY
docker start devforge-cache-redis > /dev/null
```

```text output
read: 3 seats from database (Redis unavailable)
answered within 1 s: True
```

The short timeouts and no retries turned a dead cache into an immediate fall-back, not an error or a hang. Retries matter as much as timeouts: redis-py 8.1 retries a failed command by default, and with the same 0.5-second timeouts but the default retries this read took 3.8 seconds when we measured it while preparing this lesson. For a cache you can do without, fail fast.

### 6. Clean up

```bash run
docker rm -f -v devforge-cache-py devforge-cache-redis devforge-cache-db > /dev/null
docker network rm devforge-cache-net
```

```text output
devforge-cache-net
```

## Common mistakes

- **Writing the new value into the cache instead of deleting it.** Two writers can finish in a different order than they started and leave the older value cached; deleting lets the next read load the truth.
- **Invalidating in one code path only.** Admin scripts, migrations and other services that change the table bypass it; keep TTLs short enough that a missed invalidation is tolerable.
- **No timeout, or default retries, on the cache client.** A cache that does not answer becomes the slowest part of every request.
- **Caching everything.** Values that change on almost every read (here, seats during registration) gain little from a cache and add staleness; measure the hit rate.

## Where this fits in a real system

This is the read path of most web applications (see the "Web application with a cache behind a reverse proxy" architecture). **PostgreSQL** constraints keep the data right, **Redis** keeps popular reads cheap, **Nginx** spreads requests over several application instances, and **Prometheus** dashboards watch the hit rate and the database load so you know whether the cache still earns its keep.
