---
id: kafka-schemas-and-evolution
title: Schemas and evolution
track: kafka
order: 8
level: advanced
estimated_minutes: 50
prerequisites: [kafka-delivery-guarantees-and-idempotence]
starts_fresh: true
learning_objectives:
  - Register Avro schemas in a schema registry and read the compatibility setting of a subject.
  - Explain the registry wire format (a version byte, a 4-byte schema ID, then the Avro data) by producing and inspecting real records.
  - Evolve a schema compatibly by adding a field with a default, and show old records read with the new schema.
  - Show why a new required field is rejected under BACKWARD compatibility, and what would break if it were not.
resources:
  - title: Schema evolution and compatibility
    url: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
    publisher: Confluent
    type: documentation
    level: advanced
    official: true
    why: Compatibility types (BACKWARD, FORWARD, FULL and their TRANSITIVE forms), BACKWARD as Confluent Schema Registry's default, and what to do with a truly incompatible change (often a new topic).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Wire format (formats, serializers and deserializers)
    url: https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/index.html
    publisher: Confluent
    type: reference
    level: advanced
    official: true
    why: Byte 0 is the format version (0), bytes 1–4 the schema ID returned by the registry, then the Avro binary data.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Apache Avro 1.12.0 specification — schema resolution
    url: https://avro.apache.org/docs/1.12.0/specification/
    publisher: Apache Software Foundation
    type: reference
    level: advanced
    official: true
    why: A reader field missing from the writer's schema takes its default; with no default, resolution is an error; writer fields the reader lacks are ignored.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Apicurio Registry 3.3.4 release
    url: https://github.com/Apicurio/apicurio-registry/releases/tag/3.3.4
    publisher: Apicurio (Red Hat-sponsored open-source project)
    type: reference
    level: intermediate
    official: true
    why: The Apache-licensed registry used in this lab; it serves a Confluent-compatible API under /apis/ccompat/v7.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: backward
    prompt: Under BACKWARD compatibility, which change is accepted?
    options:
      - { id: a, text: "Adding a field without a default" }
      - { id: b, text: "Adding a field with a default — a consumer on the new schema can still read old records, filling in the default" }
      - { id: c, text: "Changing a field from int to string" }
    answer: b
    explanation: BACKWARD means "new readers can read old data", so consumers can be upgraded first.
  - id: wire
    prompt: A consumer receives bytes starting 00 00 00 00 02. What does it do?
    options:
      - { id: a, text: "Parses the bytes as JSON" }
      - { id: b, text: "Reads format byte 0, looks up schema ID 2 in the registry (and caches it), then decodes the rest as Avro written with that schema" }
      - { id: c, text: "Uses the latest schema for the topic" }
    answer: b
    explanation: The ID names the writer's schema; the consumer resolves it against its own reader schema.
  - id: default
    prompt: Your registry was installed with compatibility NONE. What is the risk?
    options:
      - { id: a, text: "None — NONE means no problems" }
      - { id: b, text: "Any change is accepted, including one that makes existing records unreadable for upgraded consumers; set BACKWARD (or stricter) explicitly" }
      - { id: c, text: "Schemas cannot be registered" }
    answer: b
    explanation: The lab's registry reports NONE until it is configured; defaults differ between registry products.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka 4.4.0 image, Apicurio Registry 3.3.4 and python:3.12-slim (all pinned by digest) with confluent-kafka 2.16.1 and fastavro 1.13.0, starting from nothing, and its output is compared with this lesson. The registry runs with in-memory storage. Checked against the Confluent and Avro documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Producers and consumers are deployed separately, so the **shape** of events must change carefully: a **schema registry** stores every version of a topic's schema, records carry the **ID** of the schema they were written with, and **compatibility rules** reject changes that would stop existing consumers from reading the data.

## Explain it like I'm twelve

The school's attendance sheet has columns: name and class. One day the office adds a column "bus route". Old sheets don't have it — so anyone reading an old sheet writes "walks" in that column by default, and nothing breaks. But if the office demanded a "parent's signature" column with no default, every old sheet would suddenly be "invalid". A careful office checks each new column against that rule before printing new sheets — that check is the registry's **compatibility** rule.

## What problem it solves

In a shared Kafka cluster, dozens of services read the same topic. If one team renames a field or changes a type, consumers start crashing at 2 a.m. — often days later, when the first new record arrives. Schemas make the contract explicit; the registry checks every change against it before any producer can use it; and the schema ID in each record lets consumers decode old and new records correctly, side by side in the same topic.

## How it works

![](media:kafka/schema-registry.svg)

- A **subject** (usually `<topic>-value`) holds numbered **versions** of a schema; each distinct schema gets a global **ID**.
- A producer looks up (or registers) its schema, then writes **byte 0 = 0**, **bytes 1–4 = schema ID**, then the Avro-encoded record.
- A consumer reads the ID, fetches that **writer schema** once, and decodes with Avro **schema resolution** into its own **reader schema**: fields missing in the writer get the reader's default; extra writer fields are ignored.
- **Compatibility** is checked when a version is registered: **BACKWARD** (new schema reads old data — the Confluent default; upgrade consumers first), **FORWARD** (old schema reads new data; upgrade producers first), **FULL** (both), and **…_TRANSITIVE** variants that check against every earlier version, not only the latest.

## Try it yourself

> **Local lab** — needs Docker and about 1 GB of downloads. A broker, Apicurio Registry (its Confluent-compatible API at `http://127.0.0.1:8081/apis/ccompat/v7`) and a Python container run on the `devforge-kafka-net` network. The Python programs build the wire format themselves with fastavro, so you can see every byte. Every command is run automatically in DevForge's tests.

### 1. A broker, a registry and a Python client

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
REG_IMAGE=quay.io/apicurio/apicurio-registry:3.3.4@sha256:3ee4423c0f212c364d9525f7ab22ae1a009f610f3e6b8fc2cdba8b2ae68de460
PY_IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
for image in "$IMAGE" "$REG_IMAGE" "$PY_IMAGE"; do docker pull -q "$image" > /dev/null; done
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
docker run -d --name devforge-registry --hostname registry --network devforge-kafka-net -p 127.0.0.1:8081:8080 "$REG_IMAGE" > /dev/null
docker run -d --name devforge-kafka-py --network devforge-kafka-net -v "$PWD:/lab" -w /lab "$PY_IMAGE" sleep infinity > /dev/null
docker exec devforge-kafka-py pip install -q --root-user-action=ignore --disable-pip-version-check confluent-kafka==2.16.1 fastavro==1.13.0
client() { docker run --rm -i --network devforge-kafka-net "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
py() { docker exec -i devforge-kafka-py python "$@"; }
R=http://127.0.0.1:8081/apis/ccompat/v7
for i in $(seq 1 90); do curl -sf -o /dev/null "$R/subjects" && break; sleep 1; done
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server kafka:9092 --list > /dev/null 2>&1 && break; sleep 1; done
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic orders --partitions 1 --replication-factor 1
echo "registry compatibility out of the box: $(curl -s "$R/config")"
curl -s -X PUT -H 'Content-Type: application/json' -d '{"compatibility": "BACKWARD"}' "$R/config"; echo
```

```text output
Created topic orders.
registry compatibility out of the box: {"compatibilityLevel":"NONE"}
{"compatibility":"BACKWARD","normalize":false}
```

This registry starts with compatibility **NONE** — any change accepted. Confluent Schema Registry defaults to BACKWARD; defaults differ between products, so set it explicitly, as here.

### 2. Register version 1 and produce with it

```bash run
cat > order-v1.avsc <<'JSON'
{"type": "record", "name": "Order", "namespace": "shop",
 "fields": [{"name": "id", "type": "string"},
            {"name": "amount", "type": "int"}]}
JSON
register() { python3 -c 'import json, sys; print(json.dumps({"schema": open(sys.argv[1]).read()}))' "$1" |
  curl -s -X POST -H 'Content-Type: application/vnd.schemaregistry.v1+json' -d @- "$R/subjects/orders-value/versions"; echo; }
register order-v1.avsc
cat > produce.py <<'PYEOF'
"""Produce orders in the registry wire format: byte 0, a 4-byte schema ID, then Avro."""
import io, json, struct, sys, urllib.request
import fastavro
from confluent_kafka import Producer
REGISTRY = "http://registry:8080/apis/ccompat/v7"
latest = json.load(urllib.request.urlopen(f"{REGISTRY}/subjects/orders-value/versions/latest"))
schema = fastavro.parse_schema(json.loads(latest["schema"]))
p = Producer({"bootstrap.servers": "kafka:9092", "enable.idempotence": True, "log_level": 3})
for order in json.loads(sys.argv[1]):
    body = io.BytesIO()
    fastavro.schemaless_writer(body, schema, order)
    p.produce("orders", value=struct.pack(">bI", 0, latest["id"]) + body.getvalue())
p.flush()
n = len(json.loads(sys.argv[1]))
print(f"wrote {n} order{'s' if n != 1 else ''} with schema ID {latest['id']} (version {latest['version']})")
PYEOF
py produce.py '[{"id": "o1", "amount": 450}, {"id": "o2", "amount": 120}]'
py -c '
from confluent_kafka import Consumer, TopicPartition
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "peek", "log_level": 3})
c.assign([TopicPartition("orders", 0, 0)])
m = c.poll(10.0)
print("first record, first 5 bytes:", m.value()[:5].hex(" "), "then", len(m.value()) - 5, "bytes of Avro")'
```

```text output
{"id":1}
wrote 2 orders with schema ID 1 (version 1)
first record, first 5 bytes: 00 00 00 00 01 then 5 bytes of Avro
```

The record is not JSON: one `00` format byte, the schema ID `00 00 00 01`, then five bytes of Avro — the string `o1` (a length byte and two characters) and the number 450 (a variable-length integer, two bytes). Avro data carries no field names; without the schema it is unreadable, which is why the ID is there.

### 3. Evolve: add a field with a default

```bash run
cat > order-v2.avsc <<'JSON'
{"type": "record", "name": "Order", "namespace": "shop",
 "fields": [{"name": "id", "type": "string"},
            {"name": "amount", "type": "int"},
            {"name": "currency", "type": "string", "default": "INR"}]}
JSON
check() { python3 -c 'import json, sys; print(json.dumps({"schema": open(sys.argv[1]).read()}))' "$1" |
  curl -s -X POST -H 'Content-Type: application/vnd.schemaregistry.v1+json' -d @- "$R/compatibility/subjects/orders-value/versions/latest"; echo; }
echo "v2 compatible with v1? $(check order-v2.avsc)"
register order-v2.avsc
py produce.py '[{"id": "o3", "amount": 99, "currency": "USD"}]'
cat > consume.py <<'PYEOF'
"""Read every order: decode with the writer's schema (from the ID) into the reader's schema."""
import io, json, struct, sys, urllib.request
import fastavro
from confluent_kafka import Consumer, KafkaError, TopicPartition
REGISTRY = "http://registry:8080/apis/ccompat/v7"
reader = fastavro.parse_schema(json.load(open(sys.argv[1])))
writers = {}
c = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "reports", "enable.partition.eof": True, "log_level": 3})
c.assign([TopicPartition("orders", 0, 0)])
while True:
    m = c.poll(10.0)
    if m is None or (m.error() and m.error().code() == KafkaError._PARTITION_EOF):
        break
    fmt, schema_id = struct.unpack(">bI", m.value()[:5])
    if schema_id not in writers:   # fetch each writer schema once
        writers[schema_id] = fastavro.parse_schema(json.loads(json.load(urllib.request.urlopen(f"{REGISTRY}/schemas/ids/{schema_id}"))["schema"]))
    order = fastavro.schemaless_reader(io.BytesIO(m.value()[5:]), writers[schema_id], reader)
    print(f"offset {m.offset()} written with schema {schema_id}: {order}")
c.close()
PYEOF
py consume.py order-v2.avsc
```

```text output
v2 compatible with v1? {"is_compatible":true}
{"id":2}
wrote 1 order with schema ID 2 (version 2)
offset 0 written with schema 1: {'id': 'o1', 'amount': 450, 'currency': 'INR'}
offset 1 written with schema 1: {'id': 'o2', 'amount': 120, 'currency': 'INR'}
offset 2 written with schema 2: {'id': 'o3', 'amount': 99, 'currency': 'USD'}
```

One topic now holds records in two shapes, and the consumer on version 2 reads both: Avro filled `currency` with the default `INR` for the version 1 records, as its schema resolution rules require. A consumer still on version 1 would also read `o3` — it simply ignores `currency` — so producers and consumers can be upgraded in either order for this change.

### 4. A change the registry refuses

Version 3 adds a `customer` field **without** a default:

```bash run
cat > order-v3.avsc <<'JSON'
{"type": "record", "name": "Order", "namespace": "shop",
 "fields": [{"name": "id", "type": "string"},
            {"name": "amount", "type": "int"},
            {"name": "currency", "type": "string", "default": "INR"},
            {"name": "customer", "type": "string"}]}
JSON
echo "v3 compatible with v2? $(check order-v3.avsc)"
register order-v3.avsc | grep -o '"error_code":409\|incompatible diffs: {[0-9]*}, list of diff types: \[[^]]*\]'
echo "versions in the registry: $(curl -s "$R/subjects/orders-value/versions")"
py consume.py order-v3.avsc 2>&1 | grep -o 'SchemaResolutionError: .*' || true
```

```text output
v3 compatible with v2? {"is_compatible":false}
incompatible diffs: {1}, list of diff types: [customer at /fields/3]
"error_code":409
versions in the registry: [1,2]
SchemaResolutionError: No default value for field customer in shop.Order
```

- The registry rejected version 3 with HTTP 409 and named the problem field; the subject still has versions 1 and 2, so no producer can use the bad schema.
- The last command shows *why*: a consumer that adopted version 3 anyway cannot read the existing records — there is no `customer` in them and no default to fall back on. Under BACKWARD rules that is exactly what the registry protects you from.
- To add a required field in practice: add it with a default first, then make every producer send it; or, for a truly incompatible change, publish to a new topic and migrate consumers.

### 5. Clean up

```bash run
docker rm -f devforge-kafka devforge-registry devforge-kafka-py > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Leaving compatibility at the product's default without checking it.** This registry starts at NONE; set BACKWARD, FULL or a TRANSITIVE mode deliberately.
- **Removing a field consumers still read, or renaming one.** For Avro, a rename is a remove plus an add; use aliases and defaults instead.
- **Changing a field's type** (int to string). Not compatible; use a new field, or a new topic for a breaking change.
- **Checking compatibility only against the latest version** when old data stays in the topic for a long time — use `BACKWARD_TRANSITIVE` for long-retention or compacted topics.
- **Letting producers register schemas automatically in production.** Register through CI, where the compatibility check fails the build before deployment.

## Where this fits in a real system

A schema change goes through a pull request and a **GitHub Actions** (or **Jenkins**) job that calls the registry's compatibility endpoint, exactly like step 4, and fails the build on `false`. Data platforms that copy topics into storage (for **Airflow** jobs or **MLflow** training sets) rely on the same schemas to keep old and new partitions readable. The registry itself runs next to the brokers, often in **Kubernetes**.
