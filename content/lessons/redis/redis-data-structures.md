---
id: redis-data-structures
title: Keys, values and Redis data structures
track: redis
order: 1
level: beginner
estimated_minutes: 30
prerequisites: []
learning_objectives:
  - Explain why Redis is fast and what keeping data in memory costs you.
  - Store and read strings, counters, hashes, lists, sets and sorted sets with redis-cli.
  - Make data expire automatically with EX, EXPIRE and TTL.
  - Choose a suitable data structure for a given problem.
resources:
  - title: Redis documentation
    url: https://redis.io/docs/latest/
    publisher: Redis
    type: documentation
    level: all
    official: true
    why: The official reference for every data type and command used in this lesson.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: memory-tradeoff
    prompt: Why is Redis much faster than a disk-based database for simple reads, and what is the trade-off?
    options:
      - { id: a, text: "It compresses data on disk; the trade-off is slower writes" }
      - { id: b, text: "It keeps the data in RAM; the trade-off is that memory is limited and costly, and recent writes can be lost on a crash depending on persistence settings" }
      - { id: c, text: "It skips network communication entirely" }
    answer: b
    explanation: Serving data from memory avoids disk access, so simple operations are very fast. Memory is smaller and more expensive than disk, and unless persistence is configured carefully, the latest writes may not survive a crash — which is why Redis usually holds copies or short-lived data next to a primary database.
  - id: pick-structure
    prompt: You need a live quiz leaderboard showing the top scorers in order. Which structure fits best?
    options:
      - { id: a, text: "A string holding a comma-separated list" }
      - { id: b, text: "A sorted set: each member has a score, Redis keeps members ordered, and ZINCRBY updates a score atomically" }
      - { id: c, text: "A plain set, sorted in the application" }
    answer: b
    explanation: Sorted sets keep members ordered by score, so the top N is a single ZRANGE … REV command, and score updates are atomic even with many concurrent players.
  - id: ttl-values
    prompt: TTL returns -1 for one key and -2 for another. What is the difference?
    options:
      - { id: a, text: "-1: the key exists but never expires; -2: the key does not exist" }
      - { id: b, text: "They both mean the key has expired" }
      - { id: c, text: "-1 means one second is left; -2 means two seconds" }
    answer: a
    explanation: TTL returns the remaining seconds for a key with an expiry, -1 for a key with no expiry, and -2 when there is no such key (for example, because it already expired).
  - id: incr-atomic
    prompt: Two web servers both run INCR page:views at the same moment. What happens?
    options:
      - { id: a, text: "One increment may be lost, like a read-then-write in application code" }
      - { id: b, text: "Both increments are applied: Redis executes each command atomically, one after the other" }
      - { id: c, text: "Redis returns an error to one of them" }
    answer: b
    explanation: Redis runs commands one at a time, so INCR is atomic. Reading a value, adding one in your code and writing it back would lose updates under concurrency; INCR cannot.
verification:
  method: executed
  details: Every Redis command block is run by the test suite with redis-cli against a throwaway Redis server and its output is compared with this lesson. Confirmed in CI against Redis 7.4.12 (redis-cli 7.0.15) on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Redis** is an in-memory data store: you save values under **keys** and work on them with fast, atomic commands, using data structures such as strings, hashes, lists, sets and sorted sets.

## Explain it like I'm twelve

A database is like the school library: it holds everything safely, but fetching a book takes a walk to the shelves. Redis is like the whiteboard by the classroom door: only a few things fit, and if someone wipes it they are gone — but anyone can read it instantly. You put on the whiteboard what people need *right now*: today's timetable changes, the quiz scores, who is in the room.

Where the analogy breaks: Redis can save its contents to disk and copy them to other servers, so it is less fragile than a whiteboard — but you still choose deliberately what lives there.

## What problem it solves

Some data is read far more often than it changes, or must be updated by many servers at once: page-view counters, sessions, rate limits, leaderboards, recently viewed items, job queues. Asking the main database every time wastes its capacity and adds delay. Redis serves this kind of data from memory and gives you **atomic** operations — `INCR` adds one without the risk of two servers overwriting each other.

## How it works

```text
 key                       type         value
 greeting                  string       "Hello, Redis"
 page:views                string       12            ← INCR treats it as a number
 student:1                 hash         name → "Asha Rao", email → …, year → "2"
 jobs                      list         ["email:reminder"]              (ordered)
 course:CS101:students     set          {asha, meera}                   (unique)
 quiz:leaderboard          sorted set   ravi 92, asha 88, meera 85      (ordered by score)
```

- Every value lives under a **key**. A naming convention such as `object:id:field` (`course:CS101:students`) keeps keys readable.
- Each key holds one **type**, and each type has its own commands.
- Any key can be given an **expiry**: after its time to live (TTL), Redis deletes it automatically.
- Redis runs commands one at a time, so each command is atomic.

## Try it yourself

> **Local lab** — you need a Redis server and `redis-cli`. Every Redis block below is run automatically in DevForge's CI against a throwaway Redis 7 server; see the note at the top for the current verification status.

### 1. Start Redis and connect

Choose **one** option.

**With Docker** (reachable only from your own computer):

```bash
docker run --name devforge-redis -p 127.0.0.1:6379:6379 -d redis:7
docker exec -it devforge-redis redis-cli
```

**Installed natively:** on Ubuntu or Debian, `sudo apt install redis-server`; on macOS with Homebrew, `brew install redis` then `brew services start redis`. Redis does not officially support Windows directly; Windows users should use Docker or WSL (Windows Subsystem for Linux). Then run `redis-cli`.

Check the connection — the prompt looks like `127.0.0.1:6379>`:

```redis run
PING
```

```text output
PONG
```

> **Use a Redis you can empty.** These lessons create many keys. Never practise on a Redis server that holds real data.

### 2. Strings and counters

```redis run
SET greeting "Hello, Redis"
GET greeting
```

```text output
OK
"Hello, Redis"
```

Strings that hold numbers can be incremented atomically:

```redis run
SET page:views 0
INCR page:views
INCR page:views
INCRBY page:views 10
GET page:views
```

```text output
OK
(integer) 1
(integer) 2
(integer) 12
"12"
```

`(integer)` marks a number returned by the command; `GET` returns the stored string `"12"`. Redis refuses arithmetic on text:

```redis run fails
INCR greeting
```

```text output
(error) ERR value is not an integer or out of range
```

### 3. Expiry: data that deletes itself

A one-time password should only be valid briefly. `EX 3` sets a 3-second time to live:

```redis run
SET otp:asha 482913 EX 3
TTL otp:asha
TTL greeting
```

```text output
OK
(integer) 3
(integer) -1
```

`TTL` shows the seconds left; `-1` means `greeting` never expires. Wait four seconds (in your shell, outside redis-cli):

```bash run
sleep 4
```

Then look again:

```redis run
GET otp:asha
TTL otp:asha
```

```text output
(nil)
(integer) -2
```

The key is gone: `(nil)` means no value, and `-2` means no such key. You never had to delete it.

### 4. Hashes: one object, many fields

```redis run
HSET student:1 name "Asha Rao" email "asha@example.edu" year 2
HGET student:1 name
HGETALL student:1
```

```text output
(integer) 3
"Asha Rao"
1) "name"
2) "Asha Rao"
3) "email"
4) "asha@example.edu"
5) "year"
6) "2"
```

`HSET` returned 3, the number of fields added. Everything Redis stores is text or bytes: the number `2` comes back as `"2"`.

### 5. Lists: a simple queue

```redis run
RPUSH jobs "email:welcome" "email:reminder"
LPOP jobs
LLEN jobs
```

```text output
(integer) 2
"email:welcome"
(integer) 1
```

`RPUSH` adds to the right end, `LPOP` takes from the left: first in, first out.

### 6. Sets: unique members

```redis run
SADD course:CS101:students asha meera
SADD course:CS101:students asha
SISMEMBER course:CS101:students meera
SCARD course:CS101:students
```

```text output
(integer) 2
(integer) 0
(integer) 1
(integer) 2
```

The second `SADD` added nothing (`0`), because Asha was already a member. `SISMEMBER` answers yes (`1`) and `SCARD` counts members.

### 7. Sorted sets: a leaderboard

```redis run
ZADD quiz:leaderboard 78 asha 92 ravi 85 meera
ZRANGE quiz:leaderboard 0 -1 REV WITHSCORES
```

```text output
(integer) 3
1) "ravi"
2) "92"
3) "meera"
4) "85"
5) "asha"
6) "78"
```

`REV` returns highest scores first; `0 -1` means "from the first to the last". Asha answers a bonus question:

```redis run
ZINCRBY quiz:leaderboard 10 asha
ZREVRANK quiz:leaderboard asha
```

```text output
"88"
(integer) 1
```

Her score is now 88, and her rank is 1 — ranks start at 0, so she is second.

## Common mistakes

- **Treating Redis as the only copy of important data.** Depending on persistence settings, recent writes can be lost; keep the source of truth in a database such as PostgreSQL.
- **Running `KEYS *` on a production server.** It walks every key and blocks the server while it does; use `SCAN` to iterate gradually.
- **Forgetting expiries.** Without a TTL, temporary data accumulates until memory runs out.
- **Read-modify-write in application code** (`GET`, add one, `SET`). Two servers can overwrite each other; use atomic commands such as `INCR`, `HINCRBY` or `ZINCRBY`.
- **Exposing Redis to the network without authentication.** Bind it to localhost or a private network and require a password or ACL user.

## Where this fits in a real system

Redis usually sits beside the backend, in front of **PostgreSQL**: caching query results, storing sessions, counting requests and holding leaderboards that many application instances share. Its streams overlap with **Kafka** for simple event flows, though Kafka is built for much larger, longer-lived event logs. Redis changed its licence in 2024; *Valkey*, a community fork, accepts the same commands used in these lessons, so check current licence terms when choosing one for a product.
