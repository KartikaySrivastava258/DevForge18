---
id: kafka-outbox-pattern
title: The outbox pattern and event-driven design
track: kafka
order: 9
level: advanced
estimated_minutes: 50
prerequisites: [kafka-delivery-guarantees-and-idempotence]
starts_fresh: true
learning_objectives:
  - Show the dual-write problem — a database commit and a Kafka publish that cannot both be guaranteed — by crashing between them.
  - Write a business row and an outbox row in one database transaction, and relay outbox rows to Kafka.
  - Explain why the relay is at-least-once, and make consumers handle each event once using an event ID.
  - Compare a polling relay with log-based change data capture (Debezium), and state the ordering rules.
resources:
  - title: Pattern — Transactional outbox
    url: https://microservices.io/patterns/data/transactional-outbox.html
    publisher: microservices.io (Chris Richardson)
    type: article
    level: advanced
    official: false
    why: The problem ("How to atomically update the database and send messages to a message broker?"), why two-phase commit is usually not an option, and the solution of storing the message in the same transaction and sending it from a separate process.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Debezium — Outbox Event Router
    url: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
    publisher: Debezium (Red Hat-sponsored open-source project)
    type: documentation
    level: advanced
    official: true
    why: Log-based change data capture of an outbox table (columns such as id, aggregatetype, aggregateid, payload) routed to Kafka topics — the production alternative to a polling relay.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL 16 — SELECT … FOR UPDATE SKIP LOCKED
    url: https://www.postgresql.org/docs/16/sql-select.html
    publisher: PostgreSQL Global Development Group
    type: reference
    level: intermediate
    official: true
    why: The locking clause that lets several relay copies take different outbox rows without waiting on each other.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: dualwrite
    prompt: A service commits an order to PostgreSQL, then publishes OrderPlaced to Kafka. Why is that not enough?
    options:
      - { id: a, text: "Kafka is slower than PostgreSQL" }
      - { id: b, text: "The two writes are separate: a crash, deploy or network error between them leaves an order that no other service ever hears about (or, in the other order, an event for an order that was rolled back)" }
      - { id: c, text: "PostgreSQL cannot store events" }
    answer: b
    explanation: The lab loses o2's event exactly this way. There is no transaction spanning both systems.
  - id: relay
    prompt: The relay published two events and crashed before marking them as sent. What happens next?
    options:
      - { id: a, text: "The events are lost" }
      - { id: b, text: "The next relay run publishes them again; consumers see duplicates and must skip event IDs they have already handled" }
      - { id: c, text: "PostgreSQL rolls back the orders" }
    answer: b
    explanation: The outbox makes publishing at-least-once; idempotent consumers turn that into effectively-once handling.
  - id: ordering
    prompt: How do you keep events for the same order in sequence?
    options:
      - { id: a, text: "Run as many relays as possible" }
      - { id: b, text: "Relay rows in outbox order and key each record by the aggregate ID, so all events of one order go to one partition; parallel relays need care, because they can publish rows out of order" }
      - { id: c, text: "Ordering is never needed" }
    answer: b
    explanation: Kafka keeps order within a partition; the key decides the partition.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka 4.4.0, postgres 16.15-alpine3.23 and python:3.12-slim images (all pinned by digest) with confluent-kafka 2.16.1 and psycopg 3.3.7, starting from nothing, and its output is compared with this lesson. Crashes are simulated with os._exit(1) at fixed points. The Debezium alternative is described, not run. Checked against microservices.io, the Debezium and PostgreSQL 16 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A service cannot write to its database and to Kafka in one transaction, so the **outbox pattern** writes the event into an **outbox table in the same database transaction** as the business change, and a separate **relay** publishes outbox rows to Kafka — at least once, so consumers deduplicate by event ID.

## Explain it like I'm twelve

The school office records a new pupil in the register and must also tell the canteen. If the clerk writes in the register and then the phone line is down, the canteen never hears. So instead, the clerk writes the register entry **and** a note in an "outbox" tray in the same moment. A runner empties the tray to the canteen every few minutes. If the runner trips and isn't sure whether a note was delivered, they deliver it again — and the canteen ignores notes with a number it has already seen.

## What problem it solves

Event-driven systems react to changes: an order placed in one service triggers shipping, invoicing and emails elsewhere. If the event can be lost while the order exists — or sent while the order was rolled back — the services drift apart silently. Two-phase commit across a database and a broker is usually unavailable or undesirable. The outbox needs only a normal database transaction.

## How it works

![](media:kafka/outbox.svg)

- **Write side**: `INSERT INTO orders …` and `INSERT INTO outbox …` in one transaction. Either both exist or neither does.
- **Relay**: reads unpublished outbox rows in order, publishes them (key = aggregate ID, so one order's events share a partition), then marks them published. A crash between publish and mark means they are published again on the next run.
- **Consumers** keep track of handled event IDs (or make the effect idempotent) — the at-least-once rule from the previous lesson.
- **Polling relay** vs **change data capture**: a CDC tool such as Debezium reads the database's write-ahead log instead of polling, which adds no query load and keeps commit order, at the cost of running Kafka Connect.

## Try it yourself

> **Local lab** — needs Docker. A broker, PostgreSQL 16 (`db`, user and password `shop` — for this lab only) and a Python container run on the `devforge-kafka-net` network. Every command is run automatically in DevForge's tests.

### 1. Kafka, PostgreSQL and a Python client

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
PG_IMAGE=postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
PY_IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
for image in "$IMAGE" "$PG_IMAGE" "$PY_IMAGE"; do docker pull -q "$image" > /dev/null; done
docker network create devforge-kafka-net > /dev/null
cat > broker.env <<'ENV'
KAFKA_NODE_ID=1
KAFKA_PROCESS_ROLES=broker,controller
KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093
KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1
KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1
KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1
KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR=1
KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR=1
KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0
ENV
docker run -d --name devforge-kafka --hostname kafka --network devforge-kafka-net --env-file broker.env "$IMAGE" > /dev/null
docker run -d --name devforge-shop-db --hostname db --network devforge-kafka-net -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=shop -e POSTGRES_DB=shop "$PG_IMAGE" > /dev/null
docker run -d --name devforge-kafka-py --network devforge-kafka-net -v "$PWD:/lab" -w /lab "$PY_IMAGE" sleep infinity > /dev/null
docker exec devforge-kafka-py pip install -q --root-user-action=ignore --disable-pip-version-check confluent-kafka==2.16.1 "psycopg[binary]==3.3.7"
client() { docker run --rm -i --network devforge-kafka-net "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
py() { docker exec -i devforge-kafka-py python "$@"; }
sql() { docker exec -i devforge-shop-db psql -X -q -U shop -d shop "$@"; }
for i in $(seq 1 60); do docker exec devforge-shop-db pg_isready -U shop -d shop -h 127.0.0.1 > /dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server kafka:9092 --list > /dev/null 2>&1 && break; sleep 1; done
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic order-events --partitions 1 --replication-factor 1
sql <<'SQL'
CREATE TABLE orders (id text PRIMARY KEY, amount int NOT NULL);
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,            -- relay order
  event_id     uuid NOT NULL UNIQUE,             -- what consumers deduplicate on
  aggregate_id text NOT NULL,                    -- becomes the Kafka key
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz                       -- NULL until the relay has sent it
);
SQL
echo "tables: $(sql -At -c "SELECT string_agg(tablename, ' ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'")"
```

```text output
Created topic order-events.
tables: orders outbox
```

`pg_isready` asks PostgreSQL whether it accepts connections — the condition to wait for before creating tables.

### 2. The dual-write problem

`shop.py` places an order. In `dual-write` mode it commits the order, then publishes the event — and can crash in between.

```bash run
cat > shop.py <<'PYEOF'
"""Place an order. dual-write: commit to PostgreSQL, then publish to Kafka. outbox: one database transaction."""
import json, os, sys, uuid
import psycopg
from confluent_kafka import Producer
mode, order_id, crash = sys.argv[1], sys.argv[2], len(sys.argv) > 3
order = {"order_id": order_id, "amount": 450}
with psycopg.connect("host=db user=shop password=shop dbname=shop") as db:
    if mode == "dual-write":
        db.execute("INSERT INTO orders (id, amount) VALUES (%s, %s)", (order_id, 450))
        db.commit()                                   # the order exists ...
        if crash:
            os._exit(1)                               # ... and the process dies before publishing
        p = Producer({"bootstrap.servers": "kafka:9092", "enable.idempotence": True, "log_level": 3})
        p.produce("order-events", key=order_id, value=json.dumps({"type": "OrderPlaced", **order}))
        p.flush()
    else:
        with db.transaction():                        # both rows, or neither
            db.execute("INSERT INTO orders (id, amount) VALUES (%s, %s)", (order_id, 450))
            event_id = uuid.uuid5(uuid.NAMESPACE_URL, "order-placed/" + order_id)
            db.execute("INSERT INTO outbox (event_id, aggregate_id, type, payload) VALUES (%s, %s, %s, %s)",
                       (event_id, order_id, "OrderPlaced", json.dumps(order)))
            if crash:
                os._exit(1)                           # dies inside the transaction: nothing is committed
PYEOF
cat > consumer.py <<'PYEOF'
"""The shipping service: read order events and handle each event ID once."""
from confluent_kafka import Consumer, KafkaError, TopicPartition
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "shipping", "enable.partition.eof": True, "log_level": 3})
c.assign([TopicPartition("order-events", 0, 0)])
seen, handled, skipped = set(), [], 0
while True:
    m = c.poll(10.0)
    if m is None or (m.error() and m.error().code() == KafkaError._PARTITION_EOF):
        break
    if m.error():
        continue
    event_id = dict(m.headers() or []).get("event_id", b"").decode() or None
    if event_id and event_id in seen:     # a real service stores handled IDs in its own database
        skipped += 1
        continue
    seen.add(event_id)
    handled.append(m.key().decode())
print("records:", len(handled) + skipped, "| handled:", " ".join(handled), "| duplicates skipped:", skipped)
PYEOF
py shop.py dual-write o1
py shop.py dual-write o2 crash || echo "shop crashed after committing o2"
echo "orders in the database: $(sql -At -c 'SELECT string_agg(id, $$ $$ ORDER BY id) FROM orders')"
py consumer.py
```

```text output
shop crashed after committing o2
orders in the database: o1 o2
records: 1 | handled: o1 | duplicates skipped: 0
```

Order `o2` exists, but shipping never heard of it — and nothing will ever retry, because the code that would have published is gone. Swapping the steps (publish first, then commit) only moves the problem: a failed commit leaves an event for an order that does not exist.

### 3. Write the event into the outbox, in the same transaction

```bash run
py shop.py outbox o3
py shop.py outbox o4 crash || echo "shop crashed inside the transaction for o4"
py shop.py outbox o5
echo "orders in the database: $(sql -At -c 'SELECT string_agg(id, $$ $$ ORDER BY id) FROM orders')"
sql -c 'SELECT id, aggregate_id, type, published_at IS NOT NULL AS published FROM outbox ORDER BY id'
```

```text output
shop crashed inside the transaction for o4
orders in the database: o1 o2 o3 o5
 id | aggregate_id |    type     | published 
----+--------------+-------------+-----------
  1 | o3           | OrderPlaced | f
  3 | o5           | OrderPlaced | f
(2 rows)
```

- `o4` crashed inside its transaction, so neither its order nor its outbox row exists — the database rolled both back. Every order that exists has its event waiting.
- Outbox `id` 2 is missing: the rolled-back transaction had already taken that number from the sequence, and sequences never go backwards. The relay only needs the order, not consecutive numbers.

### 4. The relay — and what its crash means

```bash run
cat > relay.py <<'PYEOF'
"""Publish unpublished outbox rows in order, then mark them. Several copies can run (SKIP LOCKED)."""
import json, os, sys
import psycopg
from confluent_kafka import Producer
crash_after_publish = len(sys.argv) > 1
p = Producer({"bootstrap.servers": "kafka:9092", "enable.idempotence": True, "log_level": 3})
with psycopg.connect("host=db user=shop password=shop dbname=shop") as db:
    with db.transaction():
        rows = db.execute("SELECT id, event_id, aggregate_id, type, payload FROM outbox WHERE published_at IS NULL "
                          "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100").fetchall()
        for _id, event_id, aggregate_id, type_, payload in rows:
            p.produce("order-events", key=aggregate_id, value=json.dumps(payload),
                      headers={"event_id": str(event_id), "type": type_})
        p.flush()                                     # every event is in Kafka ...
        if crash_after_publish:
            os._exit(1)                               # ... but the rows are not marked yet
        db.execute("UPDATE outbox SET published_at = now() WHERE id = ANY(%s)", ([r[0] for r in rows],))
    print(f"relayed {len(rows)} event(s)")
PYEOF
py relay.py crash || echo "relay crashed after publishing, before marking"
py relay.py
sql -c 'SELECT aggregate_id, published_at IS NOT NULL AS published FROM outbox ORDER BY id'
py consumer.py
```

```text output
relay crashed after publishing, before marking
relayed 2 event(s)
 aggregate_id | published
--------------+-----------
 o3           | t
 o5           | t
(2 rows)

records: 5 | handled: o1 o3 o5 | duplicates skipped: 2
```

- The first relay run published `o3` and `o5`, then crashed before its `UPDATE` committed — so the rows still looked unpublished, and the second run published them again. Five records are in the topic for three orders.
- The consumer recognised the repeated `event_id`s and handled each order once. That is the deal: the outbox guarantees **no lost events**; consumers guarantee **no double effects**.
- `FOR UPDATE SKIP LOCKED` lets two relay copies run without taking the same rows. With more than one relay, rows can be published out of order across copies; keep one relay per partition key range, or rely on per-aggregate keys and idempotent consumers.

### 5. Clean up

```bash run
docker rm -f devforge-kafka devforge-shop-db devforge-kafka-py > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Publishing inside the database transaction** ("send, then commit"). If the commit fails, the event describes something that never happened.
- **Deleting outbox rows before the publish is confirmed.** Mark (or delete) only after `flush()` succeeded.
- **Random event IDs generated at publish time.** A republish then gets a new ID and cannot be deduplicated; create the ID with the outbox row, as here.
- **Never cleaning the outbox.** Delete or archive published rows on a schedule, or the table grows forever.
- **Events that are just table rows.** Publish domain events (`OrderPlaced` with what consumers need), not internal columns that change with every refactor.

## Where this fits in a real system

The order service writes to **PostgreSQL**; the relay — or **Debezium** reading PostgreSQL's write-ahead log through Kafka Connect — publishes to **Kafka** with keys by order ID and a schema from the previous lesson. Shipping, invoicing and an **n8n** notification workflow consume the topic, each with its own record of handled event IDs. **OpenTelemetry** context stored in the outbox row (a `traceparent` column) lets the trace continue through the relay.
