---
id: redis-persistence-and-replication
title: Persistence and replication
track: redis
order: 6
level: advanced
estimated_minutes: 35
prerequisites: [redis-data-structures]
learning_objectives:
  - Show that a Redis without persistence starts empty after a restart, and one with AOF keeps its data.
  - Compare RDB snapshots and the append-only file, including how much data each can lose.
  - Run a replica, write on the primary, read on the replica, and explain asynchronous replication and WAIT.
resources:
  - title: Redis persistence
    url: https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
    publisher: Redis documentation
    type: documentation
    level: advanced
    official: true
    why: RDB snapshots, the append-only file, fsync policies and their trade-offs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Redis replication
    url: https://redis.io/docs/latest/operate/oss_and_stack/management/replication/
    publisher: Redis documentation
    type: documentation
    level: advanced
    official: true
    why: Asynchronous replication, read-only replicas and the WAIT command.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: everysec
    prompt: Redis runs with appendonly yes and the default appendfsync everysec. The machine loses power. Roughly how much acknowledged data can be lost?
    options:
      - { id: a, text: "None" }
      - { id: b, text: "About the last second of writes" }
      - { id: c, text: "Everything since the last RDB snapshot" }
    answer: b
    explanation: The Redis documentation says that with fsync every second you may lose one second of data in a disaster. appendfsync always loses less but is slower.
  - id: async
    prompt: A client writes to the primary and gets OK; the primary crashes a moment later. Is the write certainly on the replica?
    options:
      - { id: a, text: "Yes, OK means it was copied" }
      - { id: b, text: "No: replication is asynchronous by default, so the write may not have reached the replica yet; WAIT can ask for acknowledgements, but even then Redis is not strongly consistent" }
      - { id: c, text: "Only if the replica is read-only" }
    answer: b
    explanation: The documentation calls asynchronous replication the default and warns that acknowledged writes can still be lost during failover, even with WAIT.
  - id: not-backup
    prompt: Someone runs FLUSHALL on the primary. Does the replica save the data?
    options:
      - { id: a, text: "Yes" }
      - { id: b, text: "No: the replica copies every write, including the FLUSHALL — keep backups (for example copies of RDB files) for mistakes" }
      - { id: c, text: "Only with AOF" }
    answer: b
    explanation: Replication protects against losing a server, not against commands that destroy data.
verification:
  method: executed
  details: Every command is run by the test suite with redis:7 containers on a disposable Docker engine, and its output is compared with this lesson. The data-loss windows were checked against the Redis documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Redis keeps data in memory, so **persistence** (RDB snapshots or an append-only file) decides what survives a restart, and **replication** keeps a read-only copy on another server — asynchronously, so a crash can still lose the most recent writes.

## Explain it like I'm twelve

You do your homework on a whiteboard (memory). A photo every hour is an **RDB snapshot**; writing every line into a notebook as you go is an **AOF**. A friend copying your board onto their own board, a moment behind you, is a **replica**.

Where the analogy breaks: if you wipe the board by mistake, your friend wipes theirs too — copies are not backups.

## What problem it solves

A cache can start empty after a restart; a session store, a rate limiter or a job queue usually cannot. And a single server is a single point of failure. Choosing persistence and replication settings is choosing how much data you can lose, and how quickly you can recover.

## How it works

![](media:redis/persistence-replication.svg)

- **RDB**: a point-in-time snapshot written to `dump.rdb` at intervals (`save` rules) or on `BGSAVE`. Compact and fast to load; loses changes since the last snapshot.
- **AOF**: every write is appended to a log and replayed at start-up. With `appendfsync everysec` (the default), you may lose about one second of writes in a crash.
- **Replication**: `replicaof host port` makes a server copy another. Replicas are read-only by default, and replication is **asynchronous**; `WAIT n timeout` makes a client wait until `n` replicas acknowledged its writes.

## Try it yourself

> **Local lab** — needs Docker. Three throwaway `redis:7` containers on a private network; nothing is published on your computer's ports. Every command is run automatically in DevForge's tests (on a disposable Docker engine).

### 1. Two servers: no persistence, and AOF

```bash run
docker network create devforge-redis-net > /dev/null
docker run -d --name devforge-redis-volatile --network devforge-redis-net redis:7 redis-server --save "" --appendonly no > /dev/null
docker run -d --name devforge-redis-durable --network devforge-redis-net redis:7 redis-server --appendonly yes > /dev/null
for c in volatile durable; do for i in $(seq 1 30); do docker exec "devforge-redis-$c" redis-cli PING > /dev/null 2>&1 && break; sleep 0.5; done; done
V() { docker exec devforge-redis-volatile redis-cli "$@"; }
D() { docker exec devforge-redis-durable redis-cli "$@"; }
V SET session:asha "signed in"
D SET session:asha "signed in"
```

```text output
OK
OK
```

`--save ""` turns RDB snapshots off and `--appendonly no` keeps AOF off: this server keeps data only in memory. The other writes every change to an append-only file.

### 2. Restart both

```bash run
docker restart devforge-redis-volatile devforge-redis-durable > /dev/null
for c in volatile durable; do for i in $(seq 1 30); do docker exec "devforge-redis-$c" redis-cli PING > /dev/null 2>&1 && break; sleep 0.5; done; done
echo "volatile after restart: '$(V GET session:asha)'"
echo "durable after restart:  '$(D GET session:asha)'"
echo "durable fsync policy:   $(D CONFIG GET appendfsync | tail -n 1)"
docker exec devforge-redis-durable ls /data/appendonlydir
```

```text output
volatile after restart: ''
durable after restart:  'signed in'
durable fsync policy:   everysec
appendonly.aof.1.base.rdb
appendonly.aof.1.incr.aof
appendonly.aof.manifest
```

- The volatile server came back empty — fine for a pure cache, a disaster for sessions.
- The durable server replayed its log. Redis 7 keeps the AOF as a *base* file plus *incremental* files, listed in a manifest.
- `everysec`: the log is flushed to disk every second, so a power cut can lose about one second of writes.

### 3. A replica

```bash run
docker run -d --name devforge-redis-replica --network devforge-redis-net redis:7 redis-server --replicaof devforge-redis-durable 6379 > /dev/null
R() { docker exec devforge-redis-replica redis-cli "$@"; }
for i in $(seq 1 60); do R INFO replication 2> /dev/null | grep -q 'master_link_status:up' && break; sleep 0.5; done
D SET exam:DB201 "12 December" > /dev/null
echo "replicas that acknowledged: $(D WAIT 1 2000)"
echo "read on the replica: $(R GET exam:DB201)"
R SET exam:DB201 "13 December" || true
echo "primary's view: $(D INFO replication | grep -E '^(role|connected_slaves):' | tr -d '\r' | tr '\n' ' ')"
```

```text output
replicas that acknowledged: 1
read on the replica: 12 December
READONLY You can't write against a read only replica.

primary's view: role:master connected_slaves:1
```

- The replica connected, copied the data, and from then on receives every write.
- `WAIT 1 2000` waited (at most 2000 ms) until one replica acknowledged the write — useful for important writes, though the documentation is clear that it does not make Redis strongly consistent.
- Writing to the replica is refused: replicas are read-only by default. (Redis still uses the older words *master* and *slave* in some outputs.)

### 4. Clean up

```bash run
docker rm -f devforge-redis-volatile devforge-redis-durable devforge-redis-replica > /dev/null
docker network rm devforge-redis-net > /dev/null && echo "removed"
```

```text output
removed
```

## Common mistakes

- **Treating Redis as durable by default.** Check `save` and `appendonly` for anything you cannot afford to lose.
- **appendfsync always "to be safe".** It writes to disk on every command and is much slower; `everysec` is the usual compromise.
- **Reading your own write from a replica.** Asynchronous replication means a replica can be slightly behind.
- **Replication instead of backups.** Copy RDB files somewhere else on a schedule; mistakes replicate in milliseconds.

## Where this fits in a real system

Caches often run without persistence; session stores and queues use AOF plus a replica, and **Kubernetes** operators or Redis Sentinel promote a replica when the primary fails. **Prometheus** alerts on replication lag and on failed background saves — the same ideas as **PostgreSQL** replication, with different trade-offs.
