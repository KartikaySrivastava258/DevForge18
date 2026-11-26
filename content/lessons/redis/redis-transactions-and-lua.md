---
id: redis-transactions-and-lua
title: Transactions and Lua scripts
track: redis
order: 5
level: intermediate
estimated_minutes: 35
prerequisites: [redis-data-structures]
learning_objectives:
  - Run several commands as one unit with MULTI and EXEC, and explain why a failing command does not roll the others back.
  - Use WATCH for optimistic locking, and retry when another client changed a watched key.
  - Move a read-decide-write sequence into a Lua script that Redis runs atomically.
resources:
  - title: Redis — Transactions
    url: https://redis.io/docs/latest/develop/using-commands/transactions/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: MULTI, EXEC, DISCARD and WATCH, and why Redis does not roll back transactions.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Scripting with Lua
    url: https://redis.io/docs/latest/develop/programmability/eval-intro/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: EVAL, KEYS and ARGV, and atomic script execution.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: no-rollback
    prompt: Inside MULTI, you queue SET a 1, INCR b (but b holds the text "hello"), and SET c 3. What happens at EXEC?
    options:
      - { id: a, text: "Nothing is applied, because one command failed" }
      - { id: b, text: "SET a and SET c are applied; only INCR b fails — Redis does not roll back a transaction" }
      - { id: c, text: "Redis refuses to queue INCR" }
    answer: b
    explanation: The Redis documentation says Redis does not support rollbacks. A command that fails while executing returns an error inside EXEC's reply; the others still run.
  - id: watch
    prompt: You WATCH a key, read it, and queue a change with MULTI. Another client changes the key before your EXEC. What does EXEC return?
    options:
      - { id: a, text: "OK, and your change overwrites theirs" }
      - { id: b, text: "A null reply: the transaction is not executed, so your client reads the new value and retries" }
      - { id: c, text: "An error that closes the connection" }
    answer: b
    explanation: WATCH turns MULTI/EXEC into a check-and-set. If any watched key changed, EXEC does nothing and returns null.
  - id: lua
    prompt: When is a Lua script better than WATCH and MULTI?
    options:
      - { id: a, text: "When the decision depends on values in Redis and must not race: the script reads, decides and writes in one atomic step, with no retries" }
      - { id: b, text: "When the work takes several seconds" }
      - { id: c, text: "Never: they do the same" }
    answer: a
    explanation: Redis runs a script without running other commands in between. That also means a slow script blocks everyone — keep scripts short.
verification:
  method: executed
  details: Every command is run by the test suite against Redis 7 with redis-cli, after the previous lessons, and its output is compared with this lesson. The second client in step 3 is scripted with short pauses so it always acts between WATCH and EXEC.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

`MULTI`/`EXEC` runs queued commands together with nothing in between (but **never rolls back**), `WATCH` adds a check that the data did not change since you read it, and a **Lua script** moves the whole read-decide-write into Redis as one atomic step.

## Explain it like I'm twelve

Buying the last concert ticket: you look ("1 left"), then say "I'll take it". Between your look and your answer, someone else might buy it. `WATCH` is the seller saying "the number changed since you looked — look again". A Lua script is asking the seller "give me a ticket if there is one" — one question, answered in one go.

Where the analogy breaks: `MULTI` alone is like handing over a list of orders in one envelope — they are carried out together, but one failing does not cancel the others.

## What problem it solves

Many updates need more than one command: take a seat *and* add the student, or check stock *then* decrease it. Run separately, another client can slip in between and both may think the last seat was theirs. Transactions and scripts make such sequences safe under concurrency.

## How it works

![](media:redis/transactions-lua.svg)

- `MULTI` starts queueing; each command answers `QUEUED`; `EXEC` runs them all, one after another, with no other client's command in between. `DISCARD` throws the queue away.
- A command that fails *while running* (for example `INCR` on text) returns an error in `EXEC`'s reply; the other commands still run. Redis does not roll back.
- `WATCH key` before `MULTI` makes `EXEC` succeed only if `key` was not changed by anyone since; otherwise `EXEC` returns a null reply and nothing runs.
- `EVAL script numkeys key … arg …` runs a Lua script atomically; it can read values, decide, and write.

## Try it yourself

> **Local lab** — the Redis server from *Keys, values and data structures*, and `redis-cli`. Every command is run automatically in DevForge's tests.

### 1. MULTI and EXEC

```redis run
SET seats:DB201 2
MULTI
DECR seats:DB201
SADD students:DB201 asha
EXEC
SMEMBERS students:DB201
```

```text output
OK
OK
QUEUED
QUEUED
1) (integer) 1
2) (integer) 1
1) "asha"
```

Both commands were queued and then run together — another client could not see the seat taken without the student added.

### 2. No rollback

```redis run
SET label hello
MULTI
SET a 1
INCR label
SET c 3
EXEC
MGET a c
```

```text output
OK
OK
QUEUED
QUEUED
QUEUED
1) OK
2) (error) ERR value is not an integer or out of range
3) OK
1) "1"
2) "3"
```

`INCR label` failed while running, and `SET a` and `SET c` were still applied. Redis rejects *invalid* commands when you queue them, but errors that only appear at run time do not undo the rest — check `EXEC`'s reply.

### 3. WATCH: another client got there first

Two clients want the last seat. The first reads the count, thinks, and then tries to take it; meanwhile the second takes it:

```bash run
redis-cli SET seats:NW301 1 > /dev/null
{ echo "WATCH seats:NW301"; echo "GET seats:NW301"; sleep 1; echo "MULTI"; echo "DECR seats:NW301"; echo "EXEC"; } \
  | redis-cli --no-raw | sed 's/^/client A: /' &
sleep 0.5
echo "client B: $(redis-cli DECR seats:NW301)"
wait
echo "seats left: $(redis-cli GET seats:NW301)"
```

```text output
client B: 0
client A: OK
client A: "1"
client A: OK
client A: QUEUED
client A: (nil)
seats left: 0
```

Client A's lines appear together at the end because its output is printed when it finishes, but they happened in order: A watched the key and read `1`; half a second later client B took the seat. When A ran `EXEC`, Redis saw that the watched key had changed and returned `(nil)`: A's `DECR` never ran, and the count did not go to `-1`. A real client now reads again, sees `0`, and tells its user the course is full.

### 4. The same decision as a Lua script

```redis run
SET seats:NW301 1
EVAL "local seats = tonumber(redis.call('GET', KEYS[1])) if seats > 0 then redis.call('DECR', KEYS[1]) redis.call('SADD', KEYS[2], ARGV[1]) return 'enrolled' end return 'full'" 2 seats:NW301 students:NW301 meera
EVAL "local seats = tonumber(redis.call('GET', KEYS[1])) if seats > 0 then redis.call('DECR', KEYS[1]) redis.call('SADD', KEYS[2], ARGV[1]) return 'enrolled' end return 'full'" 2 seats:NW301 students:NW301 nikhil
SMEMBERS students:NW301
```

```text output
OK
"enrolled"
"full"
1) "meera"
```

- The script reads the seats, decides, and writes — and Redis runs nothing else in between, so there is no window for another client and no retry loop.
- `2` says how many arguments are key names (`KEYS[1]`, `KEYS[2]`); the rest are values (`ARGV[1]`). Passing key names this way lets Redis (and Redis Cluster) know which keys a script touches.
- Clients usually load a script once (`SCRIPT LOAD`) and call it by its hash with `EVALSHA`, instead of sending the text every time.

## Common mistakes

- **Expecting rollback.** Check every reply in `EXEC`'s result; design commands so a partial failure is harmless, or validate first.
- **WATCH without a retry loop.** A null `EXEC` is normal under contention; read again and retry (with a limit).
- **Slow Lua scripts.** While a script runs, Redis serves no one else; keep scripts small and avoid loops over big collections.
- **Building key names inside scripts.** Pass keys through `KEYS`, so the script works with Redis Cluster.

## Where this fits in a real system

Rate limiters (the Redis lab), inventory counters and "only one worker takes this job" locks use exactly these tools; the same race appears in **PostgreSQL** (the isolation lesson), where row locks or SERIALIZABLE play the part of `WATCH`.
