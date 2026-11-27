---
id: kafka-delivery-guarantees-and-idempotence
title: Delivery guarantees and idempotent producers
track: kafka
order: 7
level: advanced
estimated_minutes: 50
prerequisites: [kafka-replication-and-fault-tolerance]
starts_fresh: true
learning_objectives:
  - Show at-most-once and at-least-once processing by crashing a consumer between its work and its offset commit.
  - Explain how idempotent producers use producer IDs and sequence numbers, and inspect them with kafka-transactions.sh.
  - Write records in transactions, and show what read_committed and read_uncommitted consumers see — including the offsets taken by transaction markers.
  - Build an exactly-once consume–transform–produce step that survives a crash, and state where that guarantee ends.
resources:
  - title: Design — message delivery semantics and using transactions
    url: https://kafka.apache.org/44/design/design/
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: At-most-once, at-least-once and exactly-once explained in terms of when the consumer saves its position; the idempotent producer; transactions that write output and input offsets atomically.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Producer and consumer configs (Apache Kafka 4.4)
    url: https://kafka.apache.org/44/configuration/consumer-configs/
    publisher: Apache Software Foundation
    type: reference
    level: advanced
    official: true
    why: isolation.level — read_committed returns only committed transactional records, up to the last stable offset; the Java consumer's default is read_uncommitted.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: librdkafka 2.16.0 configuration properties
    url: https://github.com/confluentinc/librdkafka/blob/v2.16.0/CONFIGURATION.md
    publisher: Confluent (librdkafka project)
    type: reference
    level: advanced
    official: true
    why: The C library under confluent-kafka 2.16.1. Its defaults differ from the Java client's — enable.idempotence false, isolation.level read_committed, acks -1 (all).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: confluent-kafka for Python (2.16.1 on PyPI)
    url: https://pypi.org/project/confluent-kafka/2.16.1/
    publisher: Confluent
    type: reference
    level: intermediate
    official: true
    why: The Apache-licensed Python client used in this lab, released 2026-10-28 and based on librdkafka 2.16.0.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: order
    prompt: A consumer commits its offset, then sends the email. It crashes in between. What happens on restart?
    options:
      - { id: a, text: "The email is sent twice" }
      - { id: b, text: "The email is never sent — the committed offset says the record was handled (at-most-once)" }
      - { id: c, text: "Kafka resends it automatically" }
    answer: b
    explanation: Commit-then-work loses work on a crash; work-then-commit repeats it. The lab shows o3 missing in one case and doubled in the other.
  - id: markers
    prompt: Three committed and two aborted transactional records were written. Why is the end offset 7, not 5?
    options:
      - { id: a, text: "Two records were duplicated" }
      - { id: b, text: "Each commit or abort writes a control record (a transaction marker) that takes an offset but is never delivered to applications" }
      - { id: c, text: "Offsets start at 2" }
    answer: b
    explanation: Another reason never to assume offsets are consecutive.
  - id: scope
    prompt: The billing step is exactly-once. Is the email it triggers from each receipt exactly-once too?
    options:
      - { id: a, text: "Yes, transactions cover everything" }
      - { id: b, text: "No — the guarantee covers Kafka records and offsets written in the transaction; side effects outside Kafka (emails, HTTP calls, database writes) need their own idempotency, such as a unique key" }
      - { id: c, text: "Only with acks=all" }
    answer: b
    explanation: Exactly-once in Kafka means read–process–write within Kafka. Outside it, design idempotent effects.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka 4.4.0 image and python:3.12-slim (both pinned by digest) and confluent-kafka 2.16.1, starting from nothing, and its output is compared with this lesson. Crashes are simulated with os._exit(1) at a fixed record, so every run fails at the same place. Checked against the Apache Kafka 4.4 and librdkafka 2.16.0 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Whether each event is handled **at most once**, **at least once** or **exactly once** depends on when you save your progress relative to doing the work — and Kafka's **idempotent producers** and **transactions** let a read–process–write step inside Kafka commit its output and its progress together, so a crash never doubles or loses a result.

## Explain it like I'm twelve

You are marking a stack of tests and ticking a list as you go.

- Tick first, then mark: if the bell rings in between, that test is ticked but never marked — **at most once**.
- Mark first, then tick: if the bell rings in between, you mark it again next lesson — **at least once**.
- Put the marked test and the tick in one envelope that is either handed in whole or not at all — **exactly once**.

## What problem it solves

Processes crash, get killed during deploys, and lose network connections at the worst moment. Without a clear rule, a payment service either charges twice or forgets to charge. Picking the guarantee deliberately — and knowing what each costs — is one of the main design decisions in event-driven systems.

## How it works

![](media:kafka/delivery-guarantees.svg)

- A consumer's **position** is its committed offset. Committing *before* processing gives at-most-once; *after* gives at-least-once (the usual choice, with idempotent processing).
- An **idempotent producer** gets a producer ID; each batch carries a sequence number per partition, so the broker discards duplicates caused by retries. The Java client turns this on by default; **librdkafka** (used by the Python, Go and .NET clients) does not — set `enable.idempotence=true`.
- A **transactional producer** (`transactional.id`) writes to several partitions and commits consumer offsets atomically. Each commit or abort writes a **marker** into the log.
- `isolation.level=read_committed` consumers see only committed transactional records. The Java consumer defaults to `read_uncommitted`; librdkafka defaults to `read_committed`.
- **Exactly-once** = consume, produce results and `send_offsets_to_transaction` in one transaction. A restarted instance with the same `transactional.id` aborts whatever its crashed predecessor left open.

## Try it yourself

> **Local lab** — needs Docker. A broker runs as in the previous lessons; the Python programs run in a `python:3.12-slim` container on the same network with confluent-kafka 2.16.1 installed. Every command is run automatically in DevForge's tests.

### 1. A broker, a Python client, and six orders

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
PY_IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker pull -q "$PY_IMAGE" > /dev/null
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
docker run -d --name devforge-kafka-py --network devforge-kafka-net -v "$PWD:/lab" -w /lab "$PY_IMAGE" sleep infinity > /dev/null
docker exec devforge-kafka-py pip install -q --root-user-action=ignore --disable-pip-version-check confluent-kafka==2.16.1
client() { docker run --rm -i --network devforge-kafka-net "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
py() { docker exec -i devforge-kafka-py python "$@"; }
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server kafka:9092 --list > /dev/null 2>&1 && break; sleep 1; done
for topic in orders receipts payments; do
  client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic "$topic" --partitions 1 --replication-factor 1 > /dev/null
done
printf 'o1\no2\no3\no4\no5\no6\n' | client kafka-console-producer.sh --bootstrap-server kafka:9092 --topic orders
# a first consumer group makes the broker create its offsets topic, so later programs do not wait for it
client kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic orders --group warm-up --from-beginning --max-messages 1 > /dev/null 2>&1
py -c 'import confluent_kafka; print("librdkafka", confluent_kafka.libversion()[0])'
```

```text output
librdkafka 2.16.0
```

The current folder is mounted at `/lab` in the Python container, so the scripts you write next are visible inside it.

### 2. At-most-once and at-least-once

`worker.py` processes orders one by one, committing each offset either before or after the work, and can crash at a chosen order. `os._exit(1)` stops the process immediately — no clean-up, no final commit — like a power cut.

```bash run
cat > worker.py <<'PYEOF'
"""Process orders one by one; MODE decides whether the offset is committed before or after the work."""
import os, sys
from confluent_kafka import Consumer, KafkaError, TopicPartition
mode, crash_at = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "workers-" + mode, "enable.auto.commit": False,
              "auto.offset.reset": "earliest", "enable.partition.eof": True, "log_level": 3})
c.assign([TopicPartition("orders", 0)])            # resume from the group's committed offset
while True:
    m = c.poll(10.0)
    if m is None:
        sys.exit("no message and no end of partition within 10 s")
    if m.error() and m.error().code() == KafkaError._PARTITION_EOF:
        break                                      # read everything there is
    if m.error():
        continue                                   # a passing problem (e.g. coordinator not ready); the client retries
    order = m.value().decode()
    if mode == "at-most-once":
        c.commit(message=m, asynchronous=False)    # remember "done" first ...
    if order == crash_at and mode == "at-most-once":
        os._exit(1)                                # ... and crash before doing the work
    with open("processed-" + mode + ".txt", "a") as f:
        f.write(order + "\n")                      # the work
    if order == crash_at:
        os._exit(1)                                # crash after the work, before remembering it
    if mode == "at-least-once":
        c.commit(message=m, asynchronous=False)    # remember "done" after the work
c.close()
PYEOF
for mode in at-most-once at-least-once; do
  py worker.py "$mode" o3 || echo "$mode: crashed at o3"
  py worker.py "$mode"
  echo "$mode processed: $(tr '\n' ' ' < "processed-$mode.txt")"
done
```

```text output
at-most-once: crashed at o3
at-most-once processed: o1 o2 o4 o5 o6 
at-least-once: crashed at o3
at-least-once processed: o1 o2 o3 o3 o4 o5 o6 
```

- **At-most-once** lost `o3`: its offset was committed, so after the restart the worker carried on with `o4`.
- **At-least-once** processed `o3` twice: the work was done but the commit was not, so the restarted worker did it again.

At-least-once with idempotent work — "upsert the order by its ID", "send the email only if not already recorded as sent" — is the usual answer, because losing work is worse than detecting a repeat.

### 3. Transactions, markers and isolation levels

```bash run
cat > transactions.py <<'PYEOF'
from confluent_kafka import Consumer, KafkaError, Producer, TopicPartition
p = Producer({"bootstrap.servers": "kafka:9092", "transactional.id": "payments-writer", "log_level": 3})
p.init_transactions()
p.begin_transaction()
for i in range(3):
    p.produce("payments", value=f"committed-{i}")
p.commit_transaction()                                   # all three become visible together
p.begin_transaction()
for i in range(3, 5):
    p.produce("payments", value=f"aborted-{i}")
p.flush()                                                # they are in the log ...
p.abort_transaction()                                    # ... but marked as aborted
for level in ["read_uncommitted", "read_committed"]:
    c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "audit", "isolation.level": level,
                  "enable.partition.eof": True, "log_level": 3})
    c.assign([TopicPartition("payments", 0, 0)])
    seen = []
    while True:
        m = c.poll(10.0)
        if m is None or (m.error() and m.error().code() == KafkaError._PARTITION_EOF):
            break
        if not m.error():
            seen.append(f"{m.offset()}:{m.value().decode()}")
    print(f"{level:16} sees", " ".join(seen))
    c.close()
PYEOF
py transactions.py
echo "end offset: $(client kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic payments | cut -d: -f3)"
client kafka-transactions.sh --bootstrap-server kafka:9092 describe-producers --topic payments --partition 0 2> /dev/null \
  | awk '{printf "%-14s %-13s %s\n", $2, $4, $6}'
```

```text output
read_uncommitted sees 0:committed-0 1:committed-1 2:committed-2 4:aborted-3 5:aborted-4
read_committed   sees 0:committed-0 1:committed-1 2:committed-2
end offset: 7
ProducerEpoch  LastSequence  CurrentTransactionStartOffset
0              4             None
```

- `read_committed` hides the aborted records; `read_uncommitted` shows them. A Java consumer is `read_uncommitted` unless you say otherwise — set it explicitly on every consumer of transactional topics.
- Offsets 3 and 6 are missing from both: they hold the **commit** and **abort markers**. Five data records, two markers, end offset 7.
- `kafka-transactions.sh describe-producers` shows the broker's state for this partition's producer: `LastSequence 4` — five records numbered 0–4 by the producer, which is how the broker recognises a retried duplicate — and no open transaction.

### 4. Exactly-once: receipt and progress in one transaction

`billing.py` reads each order and writes a receipt. The receipt **and** the consumer's new offset go into one transaction. It crashes after writing the receipt for `o3`, before committing.

```bash run
cat > billing.py <<'PYEOF'
"""Exactly-once within Kafka: write a receipt and commit the input offset in one transaction."""
import os, sys
from confluent_kafka import Consumer, KafkaError, Producer, TopicPartition
crash_at = sys.argv[1] if len(sys.argv) > 1 else None
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "billing", "enable.auto.commit": False,
              "auto.offset.reset": "earliest", "enable.partition.eof": True, "log_level": 3})
p = Producer({"bootstrap.servers": "kafka:9092", "transactional.id": "billing-1", "log_level": 3})
c.assign([TopicPartition("orders", 0)])
p.init_transactions()          # also aborts whatever a crashed earlier instance left open
while True:
    m = c.poll(10.0)
    if m is None:
        sys.exit("no message and no end of partition within 10 s")
    if m.error() and m.error().code() == KafkaError._PARTITION_EOF:
        break
    if m.error():
        continue
    order = m.value().decode()
    p.begin_transaction()
    p.produce("receipts", value="receipt-" + order)
    p.send_offsets_to_transaction([TopicPartition("orders", 0, m.offset() + 1)], c.consumer_group_metadata())
    if order == crash_at:
        p.flush()
        os._exit(1)            # the receipt is in the log, but its transaction never commits
    p.commit_transaction()
c.close()
PYEOF
cat > read.py <<'PYEOF'
import sys
from confluent_kafka import Consumer, KafkaError, TopicPartition
topic, level = sys.argv[1], sys.argv[2]
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "reader", "isolation.level": level,
              "enable.partition.eof": True, "log_level": 3})
c.assign([TopicPartition(topic, 0, 0)])
seen = []
while True:
    m = c.poll(10.0)
    if m is None or (m.error() and m.error().code() == KafkaError._PARTITION_EOF):
        break
    if not m.error():
        seen.append(m.value().decode())
print(" ".join(seen))
c.close()
PYEOF
py billing.py o3 || echo "billing: crashed at o3"
py billing.py
echo "receipts, read_committed:   $(py read.py receipts read_committed)"
echo "receipts, read_uncommitted: $(py read.py receipts read_uncommitted)"
```

```text output
billing: crashed at o3
receipts, read_committed:   receipt-o1 receipt-o2 receipt-o3 receipt-o4 receipt-o5 receipt-o6
receipts, read_uncommitted: receipt-o1 receipt-o2 receipt-o3 receipt-o3 receipt-o4 receipt-o5 receipt-o6
```

The crashed run left `receipt-o3` in the log inside an open transaction, with the offset commit for `o3` in the same transaction. On restart, `init_transactions()` with the same `transactional.id` aborted it, the group's offset was still before `o3`, and `o3` was processed again — this time committed. A `read_committed` reader sees every receipt exactly once; the `read_uncommitted` view shows the aborted attempt that made this possible.

### 5. Clean up

```bash run
docker rm -f devforge-kafka devforge-kafka-py > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Assuming client defaults are the same everywhere.** librdkafka-based clients have idempotence off and `read_committed` on; the Java client the opposite. Set both explicitly.
- **Auto-commit with slow processing.** `enable.auto.commit=true` commits on a timer, independent of your work — at-most-once or at-least-once depending on timing.
- **Calling transactions "exactly-once delivery" end to end.** The guarantee covers what is written to Kafka in the transaction. An email, an HTTP call or a database insert made inside the loop can still repeat; give it an idempotency key.
- **Sharing a `transactional.id` between live instances.** The newer one fences the older one; each instance (or each input partition) needs its own stable ID.
- **Long transactions.** `read_committed` consumers cannot read past an open transaction, so a stuck producer stalls everyone (until `transaction.timeout.ms` aborts it).

## Where this fits in a real system

A payment service reading orders from **Kafka** and writing to **PostgreSQL** usually chooses at-least-once with a unique constraint on the order ID, while Kafka-to-Kafka steps (Kafka Streams, Flink) use transactions. **Prometheus** alerts on consumer lag and on producer error rates; **OpenTelemetry** spans with the order ID make a repeated order easy to find. The next lesson takes the database side: the outbox pattern.
