---
id: kafka-tracing-with-opentelemetry
title: One trace across a Kafka hop with OpenTelemetry
track: kafka
order: 10
level: advanced
estimated_minutes: 35
prerequisites: [kafka-outbox-pattern]
starts_fresh: true
learning_objectives:
  - Carry the trace context from a producer to a consumer in a Kafka message header, with OpenTelemetry's propagator.
  - Create PRODUCER and CONSUMER spans with the messaging attributes, and check that the consumer's span joins the producer's trace.
  - See what happens to the trace when the header is missing.
resources:
  - title: OpenTelemetry — Context propagation
    url: https://opentelemetry.io/docs/concepts/context-propagation/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Why context must be passed between services, and the role of propagators such as W3C Trace Context.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-header
    prompt: An HTTP call between two services joins one trace automatically with OpenTelemetry's HTTP instrumentation. Why does a Kafka message need extra code here?
    options:
      - { id: a, text: "Kafka deletes trace IDs" }
      - { id: b, text: "Nothing carries the context unless someone puts it in the message — here the producer injects a traceparent header and the consumer extracts it" }
      - { id: c, text: "Kafka messages cannot have headers" }
    answer: b
    explanation: Instrumentation libraries do this for many messaging clients; without one, inject and extract yourself — the same idea as the traceparent HTTP header.
  - id: missing
    prompt: A message arrives without the traceparent header. What does the consumer's span look like?
    options:
      - { id: a, text: "It joins the producer's trace anyway" }
      - { id: b, text: "It starts a new trace of its own, with no parent — the link to the request that caused the message is lost" }
      - { id: c, text: "No span is created" }
    answer: b
    explanation: Extracting from an empty carrier gives an empty context, so the new span becomes a root span.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Apache Kafka 4.4.0 and Python 3.12 (confluent-kafka 2.16.1, opentelemetry-api and opentelemetry-sdk 1.45.2), and its output is compared with this lesson. Trace and span IDs are random, so the lesson compares them instead of printing them. First recorded on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

To keep one trace across a Kafka hop, the producer **injects** the current trace context into the message's headers (a `traceparent` header) and the consumer **extracts** it before starting its own span — so the order request and the e-mail it caused minutes later appear as one trace.

## Explain it like I'm twelve

A parcel goes from the post office to the sorting centre to your door. Each place stamps a log, but only if the parcel carries its tracking number can anyone connect the three stamps into one journey. The tracking label is the `traceparent` header: stick it on when the parcel leaves, read it when it arrives.

Where the analogy breaks: a real parcel keeps its label automatically; a Kafka message carries one only if the producer's code adds it.

## What problem it solves

In an event-driven system the work for one user action is split: the orders service answers quickly and publishes an event; consumers do the rest later. When an e-mail is slow or fails, you want to see it in the same trace as the order that caused it. Tracing libraries connect HTTP calls automatically, but a message is just bytes in a topic — unless the context travels with it.

## How it works

![](media:kafka/tracing-across-kafka.svg)

- The producer starts a span of kind **PRODUCER** (`orders publish`) and calls `propagate.inject(carrier)`, which writes a `traceparent` entry (W3C Trace Context) into a dictionary; those entries become the message's headers.
- The consumer turns the message's headers back into a dictionary, calls `propagate.extract(carrier)` and starts a span of kind **CONSUMER** (`orders process`) with that context as its parent.
- Both spans carry the messaging attributes, for example `messaging.system = kafka` and `messaging.destination.name = orders`.
- In this lab each program writes its finished spans to a JSON-lines file, so the two programs' spans can be compared; in production they would be exported to a Collector, as in the OpenTelemetry track.

## Try it yourself

> **Local lab** — needs Docker. A broker and a Python container run on the `devforge-kafka-net` network. Every command is run automatically in DevForge's tests.

### 1. A broker and a Python client with OpenTelemetry

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
PY_IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker pull -q "$PY_IMAGE" > /dev/null
docker network create devforge-kafka-net > /dev/null
docker run -d --name devforge-kafka --hostname kafka --network devforge-kafka-net \
  -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092 \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093 -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR=1 \
  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 "$IMAGE" > /dev/null
docker run -d --name devforge-kafka-py --network devforge-kafka-net -w /lab "$PY_IMAGE" sleep infinity > /dev/null
docker exec devforge-kafka-py pip install -q --root-user-action=ignore --disable-pip-version-check \
  confluent-kafka==2.16.1 opentelemetry-api==1.45.2 opentelemetry-sdk==1.45.2 > pip.log 2>&1 || { cat pip.log; exit 1; }
client() { docker exec devforge-kafka "/opt/kafka/bin/$1" "${@:2}"; }
py() { docker exec -i devforge-kafka-py python "$@"; }
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server localhost:9092 --list > /dev/null 2>&1 && break; sleep 1; done
client kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 1 --replication-factor 1
```

```text output
Created topic orders.
```

### 2. Tracing set-up shared by both programs

```bash run
docker exec -i devforge-kafka-py sh -c 'cat > /lab/tracing.py' <<'PY'
"""OpenTelemetry for this lab: spans go to a JSON-lines file per service, so we can compare them."""
import json
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult

class FileExporter(SpanExporter):
    def __init__(self, path):
        self.path = path
    def export(self, spans):
        with open(self.path, "a") as f:
            for s in spans:
                f.write(json.dumps({
                    "name": s.name, "kind": s.kind.name,
                    "trace_id": format(s.context.trace_id, "032x"), "span_id": format(s.context.span_id, "016x"),
                    "parent_id": format(s.parent.span_id, "016x") if s.parent else None,
                    "attributes": dict(s.attributes),
                }) + "\n")
        return SpanExportResult.SUCCESS

def tracer(service):
    provider = TracerProvider(resource=Resource.create({"service.name": service}))
    provider.add_span_processor(SimpleSpanProcessor(FileExporter(f"/lab/{service}-spans.jsonl")))
    trace.set_tracer_provider(provider)
    return trace.get_tracer(service)
PY
echo "tracing.py written"
```

```text output
tracing.py written
```

### 3. The producer injects the context into the message headers

```bash run
py <<'PY'
from confluent_kafka import Producer
from opentelemetry import propagate
from opentelemetry.trace import SpanKind
from tracing import tracer

tr = tracer("orders")
producer = Producer({"bootstrap.servers": "kafka:9092"})
with tr.start_as_current_span("POST /orders", kind=SpanKind.SERVER):
    with tr.start_as_current_span("orders publish", kind=SpanKind.PRODUCER,
                                  attributes={"messaging.system": "kafka", "messaging.destination.name": "orders"}):
        carrier = {}
        propagate.inject(carrier)                      # adds "traceparent" from the current span
        producer.produce("orders", key=b"o-1001", value=b'{"order": "o-1001"}',
                         headers=list(carrier.items()))
        producer.flush(10)
        print("headers sent:", sorted(carrier))
# A second message without any trace context, to compare.
producer.produce("orders", key=b"o-1002", value=b'{"order": "o-1002"}')
producer.flush(10)
PY
```

```text output
headers sent: ['traceparent']
```

### 4. The consumer extracts it and joins the trace

```bash run
py <<'PY'
from confluent_kafka import Consumer
from opentelemetry import propagate
from opentelemetry.trace import SpanKind
from tracing import tracer

tr = tracer("email")
consumer = Consumer({"bootstrap.servers": "kafka:9092", "group.id": "email", "auto.offset.reset": "earliest"})
consumer.subscribe(["orders"])
handled = 0
while handled < 2:
    m = consumer.poll(10.0)
    if m is None or m.error():
        continue
    carrier = {k: v.decode() for k, v in (m.headers() or [])}
    context = propagate.extract(carrier)               # empty context when there is no traceparent
    with tr.start_as_current_span("orders process", context=context, kind=SpanKind.CONSUMER,
                                  attributes={"messaging.system": "kafka", "messaging.destination.name": "orders"}):
        handled += 1
consumer.close()
print("messages handled:", handled)
PY
```

```text output
messages handled: 2
```

### 5. Compare the spans

```bash run
py <<'PY'
import json
orders = [json.loads(l) for l in open("/lab/orders-spans.jsonl")]
email = [json.loads(l) for l in open("/lab/email-spans.jsonl")]
publish = next(s for s in orders if s["name"] == "orders publish")
first, second = email
print("producer span kind:", publish["kind"], "| consumer span kind:", first["kind"])
print("message with a header — same trace:", first["trace_id"] == publish["trace_id"])
print("message with a header — parent is the publish span:", first["parent_id"] == publish["span_id"])
print("message without a header — same trace:", second["trace_id"] == publish["trace_id"])
print("message without a header — parent:", second["parent_id"])
print("attributes:", first["attributes"])
PY
```

```text output
producer span kind: PRODUCER | consumer span kind: CONSUMER
message with a header — same trace: True
message with a header — parent is the publish span: True
message without a header — same trace: False
message without a header — parent: None
attributes: {'messaging.system': 'kafka', 'messaging.destination.name': 'orders'}
```

The first message carried the context, so the e-mail's span joined the order's trace as a child of `orders publish`. The second message carried nothing: its span started a trace of its own, and the connection to the request that caused it is lost.

### 6. Clean up

```bash run
docker rm -f -v devforge-kafka devforge-kafka-py > /dev/null
docker network rm devforge-kafka-net
```

```text output
devforge-kafka-net
```

## Common mistakes

- **Starting the consumer span without the extracted context.** It becomes a new root, and the trace stops at the broker.
- **Dropping headers on the way.** A relay, a dead-letter step or a retry that republishes only the key and value loses the trace; copy the headers too.
- **One long span from publish to processing.** The time a message waits in the topic is not work; separate PRODUCER and CONSUMER spans, joined by the context, show the wait as the gap between them.
- **Putting personal data in baggage to "help debugging".** Baggage travels to every consumer; keep it to identifiers you are allowed to share.

## Where this fits in a real system

This is how the orders and fulfilment services of the event-driven architecture appear as one trace. The **OpenTelemetry Collector** receives both services' spans, **Jaeger** shows them as one waterfall, and **Prometheus** alerts on consumer lag — while the trace tells you which message, and which request, a slow e-mail belongs to. Together with the outbox (previous lesson), carry the headers through the outbox table so the relay can publish them.
