---
id: redis-memory-and-eviction
title: Memory limits and eviction policies
track: redis
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [redis-caching-and-rate-limiting]
learning_objectives:
  - Set a memory limit and explain what Redis does when it is reached.
  - Choose an eviction policy for a cache, and explain how the volatile policies differ from the allkeys ones.
  - Check whether Redis is evicting keys, and restore safe settings afterwards.
resources:
  - title: Key eviction
    url: https://redis.io/docs/latest/develop/reference/eviction/
    publisher: Redis
    type: documentation
    level: beginner
    official: true
    why: maxmemory, every eviction policy, approximate LRU, and which policy to pick for a cache.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: INFO command
    url: https://redis.io/docs/latest/commands/info/
    publisher: Redis
    type: documentation
    level: intermediate
    official: true
    why: The evicted_keys statistic and the other numbers used to watch memory.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: noeviction
    prompt: Redis is at its memory limit with the noeviction policy. A client runs SET. What happens?
    options:
      - { id: a, text: "Redis deletes an old key to make room" }
      - { id: b, text: "The write is refused with an error; reads of existing data still work" }
      - { id: c, text: "Redis crashes" }
    answer: b
    explanation: You see the OOM error in the lesson. noeviction keeps every key and refuses commands that would store new data.
  - id: cache-policy
    prompt: Redis is used only as a cache in front of a database. Which policy is a good default?
    options:
      - { id: a, text: "noeviction" }
      - { id: b, text: "allkeys-lru — evict the least recently used keys; cache entries are copies, so losing one only costs a database read" }
      - { id: c, text: "volatile-ttl with no TTLs set" }
    answer: b
    explanation: The Redis documentation calls allkeys-lru a good default when you have no reason to prefer another, because a cache's entries are copies of data kept elsewhere.
  - id: volatile
    prompt: With volatile-lru, the memory limit is reached and no key has a TTL. What happens to a new SET?
    options:
      - { id: a, text: "Redis evicts any key" }
      - { id: b, text: "It is refused — volatile policies only evict keys with an expiry, so with none they behave like noeviction" }
      - { id: c, text: "Redis adds a TTL to every key" }
    answer: b
    explanation: The documentation says the volatile policies behave like noeviction if no keys have an associated expiration — the lesson shows it.
verification:
  method: executed
  details: Every command is run by the test suite against a throwaway Redis 7 server (the CI service container); the output shown was recorded from that run. Exact key counts depend on Redis's memory overhead, so they are shown as … where they could differ. Facts about memory limits and eviction were checked against the Redis documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 2
---

## The idea in one sentence

Redis keeps everything in memory, so you give it a **memory limit** (`maxmemory`) and an **eviction policy** that decides what happens when the limit is reached: **refuse new writes**, or **evict** keys — the least recently used, the least frequently used, or only keys that have an expiry.

## Explain it like I'm twelve

Your desk holds a fixed number of books. When it is full, you can refuse to take any more (**noeviction**), put away the book you have not touched for longest (**LRU**), or only ever put away library books that have a due date, never your own (**volatile**).

The desk size is **maxmemory**, and the rule you follow is the **eviction policy**.

Where the analogy breaks: Redis does not check every book to find the oldest — it looks at a few at random and puts away the oldest of those.

## What problem it solves

Without a limit, a cache grows until the machine runs out of memory and the operating system kills Redis — taking every key with it. With a limit and the right policy, a cache stays within its budget by dropping what matters least, while a Redis used as a database refuses writes loudly instead of losing data silently.

## How it works

![](media:redis/eviction.svg)

- `maxmemory` sets the limit (0 means no limit on 64-bit systems). `CONFIG SET` changes it while Redis runs, from the next command on.
- `noeviction` keeps every key and returns an error for commands that would store new data; reads still work.
- `allkeys-lru` evicts the least recently used keys; `allkeys-lfu` the least frequently used; `allkeys-random` any. The `volatile-*` variants only consider keys with a TTL — and if none has one, they behave like `noeviction`.
- LRU is approximate: Redis samples a few keys (`maxmemory-samples`, default 5) and evicts the least recently used of them. `INFO stats` reports `evicted_keys`.

## Try it yourself

> **Local lab** — needs `redis-cli` and a throwaway Redis server, as in the previous lessons. **Never run this against a Redis that holds real data**: it changes the server's memory settings (the last step restores them). Every command is run automatically in DevForge's tests.

### 1. The starting point

```redis run
CONFIG GET maxmemory
CONFIG GET maxmemory-policy
```

```text output
1) "maxmemory"
2) "0"
1) "maxmemory-policy"
2) "noeviction"
```

No limit, and the policy that refuses writes rather than losing data.

### 2. A small limit with noeviction

```bash run
redis-cli CONFIG SET maxmemory 2mb
page=$(head -c 1000 /dev/zero | tr '\0' x)
for i in $(seq 1 3000); do echo "SET page:$i $page"; done | redis-cli | grep . | sort | uniq -c | sed 's/^ *[0-9]* /… /'
redis-cli GET page:1 | cut -c1-10
```

```text output
OK
… OK
… OOM command not allowed when used memory > 'maxmemory'.
xxxxxxxxxx
```

- Each value is 1,000 bytes, so 3,000 of them cannot fit in 2 MB. Redis accepted writes until it reached the limit, then refused every further `SET` with an **OOM** (out of memory) error. The exact counts depend on Redis's memory overhead, so they are shown as `…`.
- Reading an existing key still works.

### 3. Switch to allkeys-lru

```bash run
redis-cli CONFIG SET maxmemory-policy allkeys-lru
for i in $(seq 3001 4000); do echo "SET page:$i $page"; done | redis-cli | grep . | sort | uniq -c | sed 's/^ *[0-9]* /… /'
evicted=$(redis-cli INFO stats | grep '^evicted_keys:' | cut -d: -f2 | tr -d '\r')
echo "keys evicted: $([ "$evicted" -gt 0 ] && echo yes || echo no)"
echo "fewer keys than written: $([ "$(redis-cli DBSIZE)" -lt 4000 ] && echo yes || echo no)"
```

```text output
OK
… OK
keys evicted: yes
fewer keys than written: yes
```

Now every write succeeds: Redis makes room by evicting keys. For a cache that is exactly right — each page can be read from the database again.

Which keys go is only *approximately* "least recently used". Redis samples a few keys and evicts the oldest of them, and its record of when a key was last used is coarse (one second, in Redis's source code). Keys written in the same burst therefore look equally old, and even the page written last can be evicted — DevForge's own tests saw exactly that. What LRU does well over time is keep keys that are read often and drop keys nobody has touched for a while.

### 4. volatile-lru only evicts keys with a TTL

```bash run
redis-cli FLUSHDB > /dev/null
redis-cli CONFIG SET maxmemory-policy volatile-lru
for i in $(seq 1 3000); do echo "SET page:$i $page"; done | redis-cli | grep . | sort | uniq -c | sed 's/^ *[0-9]* /… /'
pages_before=$(redis-cli --scan --pattern 'page:*' | wc -l)
for i in $(seq 1 3000); do echo "SET temp:$i $page EX 600"; done | redis-cli > /dev/null
pages_after=$(redis-cli --scan --pattern 'page:*' | wc -l)
echo "keys without a TTL evicted: $((pages_before - pages_after))"
echo "keys with a TTL stored: $(redis-cli --scan --pattern 'temp:*' | wc -l | tr -d ' ') of 3000"
```

```text output
OK
… OK
… OOM command not allowed when used memory > 'maxmemory'.
keys without a TTL evicted: 0
keys with a TTL stored: … of 3000
```

- Keys without a TTL are never evicted under `volatile-lru`, so once memory is full of them, writes are refused again — just like `noeviction`.
- The second loop writes 3000 keys **with** a TTL (`EX 600`). Not one `page:` key was evicted to make room for them. Only the little memory that happened to be free could take a few `temp:` keys, and from then on each new one could only push out an *older `temp:` key*. That is why the number stored is small and changes from run to run (shown as `…`). This policy only works when the keys you are willing to lose have expiries set.

### 5. Restore the defaults

```bash run
redis-cli FLUSHDB
redis-cli CONFIG SET maxmemory-policy noeviction
redis-cli CONFIG SET maxmemory 0
```

```text output
OK
OK
OK
```

## Try it in the simulation

A minute of traffic with a spike: watch database load when the hot key expires, and keep it under the limit. It is a labelled teaching model with fixed traffic, not a real Redis.

```simulation redis-cache-load scenario=stampede
```

## Common mistakes

- **No memory limit on a cache.** It grows until the operating system kills Redis. Set `maxmemory` with room to spare for Redis's own overhead.
- **`noeviction` on a pure cache.** Writes start failing when it fills up; use `allkeys-lru` (or `allkeys-lfu`).
- **A volatile policy with keys that have no TTL.** Nothing can be evicted, so it behaves like `noeviction`.
- **An eviction policy on data you cannot lose.** If Redis is your database, refuse writes and add memory instead.
- **Not watching `evicted_keys`.** A steadily rising count means the cache is too small for its traffic.

## Where this fits in a real system

A cache in front of **PostgreSQL** uses `allkeys-lru`, and **Prometheus** alerts on memory and evicted keys. Evicted entries are refilled from the database by the cache-aside code of the previous lesson — which is why a key that many requests want at once needs care when it disappears (the simulation shows it).
