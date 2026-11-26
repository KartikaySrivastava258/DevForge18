---
id: redis-pubsub-and-streams
title: Pub/Sub versus Streams
track: redis
order: 4
level: intermediate
estimated_minutes: 35
prerequisites: [redis-data-structures]
learning_objectives:
  - Publish to a channel and show that a subscriber who was not listening misses the message.
  - Append to a stream and read it with a consumer group, acknowledging processed entries.
  - Recover the work of a consumer that crashed, by claiming its pending entries.
resources:
  - title: Redis Pub/Sub
    url: https://redis.io/docs/latest/develop/pubsub/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: Channels, SUBSCRIBE and PUBLISH, and Pub/Sub's at-most-once delivery.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Redis Streams
    url: https://redis.io/docs/latest/develop/data-types/streams/
    publisher: Redis documentation
    type: documentation
    level: intermediate
    official: true
    why: XADD, consumer groups, XREADGROUP, XACK, the pending entries list and claiming.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: pubsub-missed
    prompt: A worker restarts for two seconds; during that time, three messages are published to its channel. What happens to them?
    options:
      - { id: a, text: "Redis keeps them until the worker reconnects" }
      - { id: b, text: "They are lost for that worker: Pub/Sub delivers only to subscribers connected at that moment — at most once" }
      - { id: c, text: "They are sent to another channel" }
    answer: b
    explanation: The Redis documentation describes Pub/Sub delivery as at-most-once; nothing is stored. Use a stream when every message must be processed.
  - id: pending
    prompt: A consumer reads two entries with XREADGROUP and crashes before XACK. Where are those entries?
    options:
      - { id: a, text: "Gone" }
      - { id: b, text: "Still in the stream, and listed in the group's pending entries list as delivered to that consumer but not acknowledged — another consumer can claim them" }
      - { id: c, text: "Back at the end of the stream" }
    answer: b
    explanation: XACK removes an entry from the pending list. Until then the group remembers who has it, so XPENDING finds it and XCLAIM or XAUTOCLAIM can give it to someone else.
  - id: two-groups
    prompt: Shipping and analytics both need every order. How should they read the stream?
    options:
      - { id: a, text: "As two consumers in the same group" }
      - { id: b, text: "As two separate consumer groups — each group gets every entry and keeps its own position" }
      - { id: c, text: "Analytics should subscribe with Pub/Sub" }
    answer: b
    explanation: Consumers in one group share the work (each entry goes to one of them); separate groups each see every entry.
verification:
  method: executed
  details: Every command is run by the test suite against Redis 7 with redis-cli, after the previous lessons, and its output is compared with this lesson. Delivery semantics were checked against the Redis documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Pub/Sub** pushes each message to whoever is listening at that moment and stores nothing, while a **stream** is an append-only log whose **consumer groups** remember what each group has read and what is still unacknowledged — so work survives disconnects and crashes.

## Explain it like I'm twelve

Pub/Sub is the school loudspeaker: everyone in the building hears the announcement, but if you were outside, you missed it. A stream is the noticeboard: every notice stays pinned in order, each class ticks off the ones it has handled, and a notice someone took but never finished can be handed to someone else.

Where the analogy breaks: in a stream, two different classes (groups) each get every notice, while pupils within one class share them out.

## What problem it solves

Services need to tell each other that something happened — an order was placed, a file was uploaded. For a live "someone is typing" signal, losing a message does not matter. For "charge this card", it matters a lot. Choosing between Pub/Sub and Streams is choosing whether a message may be lost.

## How it works

![](media:redis/pubsub-streams.svg)

- `SUBSCRIBE channel` listens; `PUBLISH channel message` sends to current subscribers and returns how many received it. Nothing is stored — delivery is **at most once**.
- `XADD stream id field value …` appends an entry; IDs grow over time (`*` lets Redis choose one from the clock).
- `XGROUP CREATE` makes a **consumer group**. `XREADGROUP … >` gives each consumer new entries, and the group records each one in its **pending entries list** until `XACK`.
- `XPENDING` lists unacknowledged entries; `XAUTOCLAIM` (or `XCLAIM`) moves entries that have waited too long to another consumer.

## Try it yourself

> **Local lab** — the Redis server from *Keys, values and data structures*, and `redis-cli`. Every command is run automatically in DevForge's tests.

### 1. Pub/Sub: only listeners hear it

```bash run
redis-cli PUBLISH news "before anyone listens"
redis-cli SUBSCRIBE news > listener.log &
listener=$!
for i in $(seq 1 30); do [ "$(redis-cli PUBSUB NUMSUB news | tail -n 1)" = 1 ] && break; sleep 0.1; done
redis-cli PUBLISH news "exam timetable is out"
sleep 0.5
kill "$listener"
cat listener.log
```

```text output
0
1
subscribe
news
1
message
news
exam timetable is out
```

- The first `PUBLISH` returned `0`: nobody was subscribed, so the message went nowhere — it is not waiting anywhere for a future listener.
- The second reached one subscriber (`1`). The listener printed its subscription confirmation, then the message: type, channel, text.

### 2. A stream keeps every entry

Entries normally get IDs from the clock with `*`; here they are given explicit IDs (`1-0`, `2-0`, …) so the output is the same every time.

```redis run
XADD orders 1-0 item book qty 1
XADD orders 2-0 item pen qty 3
XADD orders 3-0 item lamp qty 1
XLEN orders
XRANGE orders - + COUNT 1
```

```text output
"1-0"
"2-0"
"3-0"
(integer) 3
1) 1) "1-0"
   2) 1) "item"
      2) "book"
      3) "qty"
      4) "1"
```

The entries stay in the stream, in order, after they are read — unlike a list, where reading usually removes, and unlike Pub/Sub, where nothing is kept.

### 3. A consumer group shares the work

```redis run
XGROUP CREATE orders shipping 0
XREADGROUP GROUP shipping worker-1 COUNT 2 STREAMS orders >
XACK orders shipping 1-0
XPENDING orders shipping
```

```text output
OK
1) 1) "orders"
   2) 1) 1) "1-0"
         2) 1) "item"
            2) "book"
            3) "qty"
            4) "1"
      2) 1) "2-0"
         2) 1) "item"
            2) "pen"
            3) "qty"
            4) "3"
(integer) 1
1) (integer) 1
2) "2-0"
3) "2-0"
4) 1) 1) "worker-1"
      2) "1"
```

- `0` made the group start from the beginning of the stream; `>` asks for entries this group has not delivered to anyone yet.
- `worker-1` got two orders, finished the first and acknowledged it with `XACK`.
- `XPENDING` shows one entry, `2-0`, still pending with `worker-1` — delivered, but never acknowledged.

### 4. worker-1 crashes; worker-2 takes over

```redis run
XAUTOCLAIM orders shipping worker-2 0 0-0 COUNT 10
XREADGROUP GROUP shipping worker-2 COUNT 10 STREAMS orders >
XACK orders shipping 2-0 3-0
XPENDING orders shipping
```

```text output
1) "0-0"
2) 1) 1) "2-0"
      2) 1) "item"
         2) "pen"
         3) "qty"
         4) "3"
3) (empty array)
1) 1) "orders"
   2) 1) 1) "3-0"
         2) 1) "item"
            2) "lamp"
            3) "qty"
            4) "1"
(integer) 2
1) (integer) 0
2) (nil)
3) (nil)
4) (nil)
```

- `XAUTOCLAIM … 0 0-0` moved every pending entry idle for at least 0 ms (in real systems, use something like 60000) to `worker-2`. The pen order was not lost when `worker-1` disappeared.
- `worker-2` then read the remaining new entry and acknowledged both. Nothing is pending: every order was processed exactly by someone.

### 5. A second group sees everything again

```redis run
XGROUP CREATE orders analytics 0
XREADGROUP GROUP analytics reporter COUNT 10 STREAMS orders >
```

```text output
OK
1) 1) "orders"
   2) 1) 1) "1-0"
         2) 1) "item"
            2) "book"
            3) "qty"
            4) "1"
      2) 1) "2-0"
         2) 1) "item"
            2) "pen"
            3) "qty"
            4) "3"
      3) 1) "3-0"
         2) 1) "item"
            2) "lamp"
            3) "qty"
            4) "1"
```

The analytics group has its own position, so it receives all three orders even though shipping already handled them.

## Common mistakes

- **Pub/Sub for work that must not be lost.** A restarting subscriber silently misses messages; use a stream (or Kafka) instead.
- **Forgetting XACK.** Unacknowledged entries pile up in the pending list, and memory grows.
- **One group for different jobs.** Consumers in one group *share* entries; give each kind of processing its own group.
- **Streams that grow forever.** Trim with `XADD … MAXLEN ~ n` or `XTRIM` according to how long entries are needed.

## Where this fits in a real system

Streams cover many job-queue and event cases inside one Redis; when events must be kept for days, replayed by many teams or partitioned across machines, **Kafka** — whose consumer groups and offsets work much like these — is the usual next step. Pub/Sub suits live notifications, such as pushing updates to WebSocket servers behind **Nginx**.
