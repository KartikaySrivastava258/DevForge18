---
id: postgresql-replication-and-pooling
title: Replication and connection pooling
track: postgresql
order: 8
level: advanced
estimated_minutes: 40
prerequisites: [postgresql-backups-restores-migrations]
learning_objectives:
  - Set up a streaming replica with pg_basebackup and watch writes on the primary appear on it.
  - Explain what a hot standby can and cannot do, and what replication does not protect against.
  - Explain why every PostgreSQL connection costs a process, and how a connection pooler helps.
resources:
  - title: PostgreSQL documentation — pg_basebackup
    url: https://www.postgresql.org/docs/16/app-pgbasebackup.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: Copying a running server and -R, which writes the settings a standby needs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — Hot Standby
    url: https://www.postgresql.org/docs/16/hot-standby.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: Running read-only queries on a standby, and standby.signal.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — How Connections Are Established
    url: https://www.postgresql.org/docs/16/connect-estab.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: intermediate
    official: true
    why: The "process per user" model behind the cost of connections.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PgBouncer — Features
    url: https://www.pgbouncer.org/features.html
    publisher: PgBouncer project
    type: documentation
    level: advanced
    official: true
    why: Session, transaction and statement pooling, and what each mode breaks.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: replica-write
    prompt: Your application sends an INSERT to the replica. What happens?
    options:
      - { id: a, text: "The replica forwards it to the primary" }
      - { id: b, text: "It fails: a hot standby only runs read-only queries; writes must go to the primary" }
      - { id: c, text: "The replica stores it and syncs it back later" }
    answer: b
    explanation: The standby replays the primary's write-ahead log and accepts only read-only queries, as the error "cannot execute INSERT in a read-only transaction" shows.
  - id: not-a-backup
    prompt: Someone runs DROP TABLE on the primary. Does the replica save you?
    options:
      - { id: a, text: "Yes, the replica keeps the old data" }
      - { id: b, text: "No: the replica replays the primary's changes, including the DROP, within moments — replication protects against losing a server, not against mistakes; you still need backups" }
      - { id: c, text: "Only if it is a hot standby" }
    answer: b
    explanation: A replica is a copy that follows the primary. Backups (and point-in-time recovery) are what let you go back to before a mistake.
  - id: pooling
    prompt: Why put a connection pooler such as PgBouncer between many application instances and PostgreSQL?
    options:
      - { id: a, text: "It encrypts the data" }
      - { id: b, text: "Each PostgreSQL connection is a separate backend process; a pooler lets many clients share a small number of server connections" }
      - { id: c, text: "It makes queries use indexes" }
    answer: b
    explanation: PostgreSQL uses a process-per-connection model, so thousands of mostly idle connections waste memory and hit max_connections. In transaction pooling, a server connection is lent to a client only for one transaction — which breaks some session features, as PgBouncer's documentation warns.
verification:
  method: executed
  details: The replication and connection steps are run by the test suite with two postgres:16 containers (on a disposable Docker engine), after the previous lessons, and their output is compared with this lesson. Connection pooling with PgBouncer was checked against PgBouncer's documentation (2026-11-26) but is not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Streaming replication** keeps a second, read-only PostgreSQL server continuously up to date by sending it the primary's write-ahead log, and a **connection pooler** lets many clients share a few database connections — one protects availability and read capacity, the other protects the server from too many connections.

## Explain it like I'm twelve

A teacher writes on the main whiteboard, and a helper copies every line onto a second board at the back of a big hall, a moment later. People at the back can read from the second board, but only the teacher writes. If the main board breaks, the second one already has almost everything.

The boards are the **primary** and the **replica**. A **pooler** is the queue at the teacher's desk: a hundred students, but only a few questions answered at a time.

Where the analogy breaks: if the teacher writes something wrong, the helper copies the mistake too — the replica is not a backup.

## What problem it solves

One database server is a single point of failure, and busy applications want more read capacity than one server gives. Replicas take over when the primary fails and serve read-only queries. Separately, many application instances each opening dozens of connections can exhaust the server; a pooler keeps the number of real connections small.

## How it works

![](media:postgresql/replication-pooling.svg)

- The primary records every change in its **write-ahead log** (WAL). A replica, started from a copy made with `pg_basebackup`, connects to the primary and **streams** the WAL, replaying it continuously.
- `pg_basebackup -R` writes `standby.signal` and the connection settings, so the copy starts as a **hot standby**: it accepts read-only queries.
- PostgreSQL uses a **process per connection**. Each idle connection still costs a process and memory, and `max_connections` caps them.
- A pooler such as **PgBouncer** accepts many client connections and lends them a smaller number of server connections — per session, or only for the duration of a transaction.

## Try it yourself

> **Local lab** — needs Docker. Two throwaway `postgres:16` containers on a private Docker network; nothing is published on your computer's ports. The passwords are for this lesson only. Every command is run automatically in DevForge's tests (on a disposable Docker engine).

### 1. A primary, and a user for replication

```bash run
docker network create devforge-pg-repl > /dev/null
docker run -d --name devforge-pg-primary --network devforge-pg-repl -e POSTGRES_PASSWORD=lesson-only postgres:16 > /dev/null
for i in $(seq 1 60); do docker exec devforge-pg-primary pg_isready -U postgres -q && break; sleep 1; done
sleep 2
P() { docker exec devforge-pg-primary psql -U postgres -X -A -t "$@"; }
P -q -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replica-lesson-only'"
docker exec devforge-pg-primary sh -c 'echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"'
P -c "SELECT pg_reload_conf()"
```

```text output
t
```

- `REPLICATION` lets the role stream the WAL — nothing else.
- `pg_hba.conf` decides who may connect, and how. The new line allows the `replicator` role to make *replication* connections, with a password. `pg_reload_conf()` applies it without a restart.

### 2. A replica from a base backup

```bash run
docker run -d --name devforge-pg-replica --network devforge-pg-repl --user postgres \
  -e PGPASSWORD=replica-lesson-only postgres:16 \
  bash -c 'pg_basebackup -h devforge-pg-primary -U replicator -D /tmp/replica -R -X stream && chmod 700 /tmp/replica && exec postgres -D /tmp/replica' > /dev/null
for i in $(seq 1 60); do docker exec devforge-pg-replica pg_isready -q 2> /dev/null && break; sleep 1; done
R() { docker exec devforge-pg-replica psql -U postgres -X -A -t "$@"; }
echo "replica in recovery (a standby): $(R -c 'SELECT pg_is_in_recovery()')"
echo "primary sees: $(P -c 'SELECT state FROM pg_stat_replication')"
```

```text output
replica in recovery (a standby): t
primary sees: streaming
```

`pg_basebackup` copied the running primary, `-R` marked the copy as a standby, and `postgres` started it. The primary's `pg_stat_replication` shows one replica, **streaming**.

### 3. Writes flow to the replica; the replica refuses writes

```bash run
P -q -c "CREATE TABLE notices (id serial PRIMARY KEY, body text); INSERT INTO notices (body) VALUES ('Exams start on 12 December')"
for i in $(seq 1 20); do [ -n "$(R -c 'SELECT body FROM notices' 2> /dev/null)" ] && break; sleep 0.5; done
echo "read on the replica: $(R -c 'SELECT body FROM notices')"
R -c "INSERT INTO notices (body) VALUES ('from the replica')" 2>&1 || true
```

```text output
read on the replica: Exams start on 12 December
ERROR:  cannot execute INSERT in a read-only transaction
```

The table and the row reached the replica within moments, by replaying the WAL. Writing there is refused: all writes go to the primary. Applications send writes to the primary and may send some reads to replicas — remembering that a replica can be a moment behind.

### 4. Every connection is a process

```bash run
echo "max_connections: $(P -c 'SHOW max_connections')"
for i in $(seq 1 10); do P -q -c "SELECT pg_sleep(3)" > /dev/null & done
for i in $(seq 1 20); do
  n=$(P -c "SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND query LIKE 'SELECT pg_sleep%'")
  [ "$n" -ge 10 ] && break; sleep 0.2
done
echo "sleeping client connections: at least $n, each served by its own server process (pid)"
P -c "SELECT count(*) = count(DISTINCT pid) AS one_process_each FROM pg_stat_activity WHERE backend_type = 'client backend'"
wait
```

```text output
max_connections: 100
sleeping client connections: at least 10, each served by its own server process (pid)
t
```

Ten clients, ten backend processes on the server: in `pg_stat_activity`, every client connection has its own process ID. With the default `max_connections` of 100, a few application instances that each keep a large connection pool can exhaust the server. A pooler such as PgBouncer sits in between: in *transaction pooling* mode a server connection is lent to a client only while it runs a transaction, so many clients share a few processes — but, as PgBouncer's documentation warns, session features such as `SET` and session-level prepared statements behave differently.

### 5. Clean up

```bash run
docker rm -f devforge-pg-primary devforge-pg-replica > /dev/null
docker network rm devforge-pg-repl > /dev/null && echo "removed"
```

```text output
removed
```

## Common mistakes

- **Treating a replica as a backup.** Mistakes replicate in moments; keep backups and test restores (previous lesson).
- **Reading your own write from a replica.** A user saves a change and immediately reads from a replica that has not replayed it yet. Read from the primary when freshness matters.
- **Unbounded connection pools in every instance.** Ten instances × 50 connections already exceeds the default limit; size pools from the server's limit down, or add a pooler.
- **Using transaction pooling with session features.** `SET`, advisory locks and session-level prepared statements can leak between clients; check the pooler's documentation for your driver.

## Where this fits in a real system

**Kubernetes** operators and managed services (Amazon RDS, Cloud SQL) automate replicas and failover; **Prometheus** watches replication lag and connection counts; and **Redis** caches take reads off the database before replicas are needed.
