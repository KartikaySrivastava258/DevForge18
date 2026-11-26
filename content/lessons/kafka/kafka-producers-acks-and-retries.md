---
id: kafka-producers-acks-and-retries
title: Producers, acknowledgements and retries
track: kafka
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [kafka-scaling-consumers]
starts_fresh: true
learning_objectives:
  - Explain acks=0, acks=1 and acks=all, and show that acks=0 never learns the record's offset.
  - Show the producer riding out a broker outage with its default retries, without losing or reordering records.
  - Explain delivery.timeout.ms, and why a send that timed out has an unknown outcome rather than a failed one.
  - Run Kafka clients in their own container on a Docker network, as applications do.
resources:
  - title: Producer configs (Apache Kafka 4.4)
    url: https://kafka.apache.org/44/configuration/producer-configs/
    publisher: Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: acks (default all), enable.idempotence (default true when nothing conflicts), retries, delivery.timeout.ms (default 120000), max.in.flight.requests.per.connection (default 5) and linger.ms (default 5).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Design — the producer and message delivery semantics
    url: https://kafka.apache.org/44/design/design/
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: Why the producer batches, and how acknowledgements and idempotence give at-least-once and exactly-once writes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Apache Kafka Docker image examples (4.4.0)
    url: https://github.com/apache/kafka/tree/4.4.0/docker/examples
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Configuring the official image with KAFKA_… environment variables (all required properties must be set), and the listener settings used in this lab.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: acks
    prompt: A producer sends with acks=0. The broker crashes a moment later. What does the application know about its records?
    options:
      - { id: a, text: "Which ones were stored" }
      - { id: b, text: "Nothing — acks=0 does not wait for any reply, so every send looks successful and the offset is reported as -1" }
      - { id: c, text: "That all of them were lost" }
    answer: b
    explanation: The lab shows offset -1 for every acks=0 record. Use acks=0 only for data you can afford to lose silently, such as some metrics.
  - id: outage
    prompt: Why did all six records arrive, in order and without duplicates, despite a five-second outage?
    options:
      - { id: a, text: "Kafka stores records in the client" }
      - { id: b, text: "The producer kept retrying within delivery.timeout.ms (2 minutes by default), and idempotence — on by default — lets the broker discard retried duplicates and keep the order" }
      - { id: c, text: "The broker was not really paused" }
    answer: b
    explanation: Retries are safe only because of idempotence; without it, retries can duplicate or, with several requests in flight, reorder records.
  - id: timeout
    prompt: Your code gets a TimeoutException for a send. Should it assume the record was not written?
    options:
      - { id: a, text: "Yes" }
      - { id: b, text: "No — the request may have reached the broker and been written after the client gave up; treat the outcome as unknown and make consumers tolerate duplicates (or use transactions)" }
      - { id: c, text: "Only with acks=0" }
    answer: b
    explanation: In this lesson's recording, records reported as timed out were in the log afterwards. A blind resend would have duplicated them.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka 4.4.0 image (pinned by digest), starting from nothing, and its output is compared with this lesson. How many sends time out in step 3 depends on timing, so the lab checks properties of the result rather than exact counts. Configuration defaults and their meaning were checked against the Apache Kafka 4.4 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A Kafka **producer** batches records and sends them to the partition leader, and three settings decide how safe that is: **`acks`** (how many replicas must confirm), **retries** within **`delivery.timeout.ms`** (how long to keep trying), and **idempotence** (so retries never duplicate or reorder).

## Explain it like I'm twelve

You post letters to a friend.

- **acks=0**: drop the letter in the postbox and walk away — you never know if it arrived.
- **acks=1**: the local post office stamps "received" — but if that office burns down before forwarding it, the letter is gone.
- **acks=all**: you wait until every copy office that is keeping up has a copy.

If the post office is closed for a few minutes, you keep trying until a deadline. And each letter has a serial number, so if you post the same letter twice because you weren't sure, the post office throws the second copy away — that is **idempotence**.

## What problem it solves

Networks drop packets, brokers restart for upgrades, and leaders move. An application that sends payments or orders must not lose them, must not write them twice, and must keep each key's events in order. The producer's defaults (`acks=all`, idempotence on, retries for up to two minutes) handle short outages transparently; knowing them tells you what still reaches your code — and what a timeout really means.

## How it works

![](media:kafka/producer-acks.svg)

- `send()` puts the record in a **batch** for its partition; batches go out when full or after `linger.ms` (5 ms by default).
- The leader appends the batch, waits for the replicas that `acks` demands, and returns the **offset** — or an error.
- **Retriable errors** (timeouts, leader changes, a broker restarting) are retried automatically until `delivery.timeout.ms` (120 000 ms) runs out. Then your callback gets the error.
- **Idempotence** (`enable.idempotence`, on by default unless conflicting settings are made) gives the producer an ID and each batch a sequence number; the broker drops duplicates and keeps order with up to 5 requests in flight.
- A **timeout is ambiguous**: the client stopped waiting, but the request may still be processed.

## Try it yourself

> **Local lab** — needs Docker. This time the broker is told to advertise itself as `kafka` on a private Docker network, and every client runs in its own short-lived container on that network — so pausing the broker does not pause the client too. Every command is run automatically in DevForge's tests. Run it where nothing else is called `devforge-kafka`.

### 1. A broker and a separate client

```bash run
IMAGE=apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f
docker pull -q "$IMAGE" > /dev/null
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
# Run a Kafka tool in a fresh client container on the same network.
client() { docker run --rm -i --network devforge-kafka-net -v "$PWD:/work:ro" "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server kafka:9092 --list > /dev/null 2>&1 && break; sleep 1; done
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic acks-demo --partitions 1 --replication-factor 1
```

```text output
Created topic acks-demo.
```

- When any `KAFKA_…` variable is set, the image uses only those settings, so all required ones are listed (`broker.env`). The names are Kafka properties in capitals with dots as underscores: `KAFKA_ADVERTISED_LISTENERS` is `advertised.listeners`.
- `advertised.listeners` is the address the broker tells clients to use. Here it is `kafka:9092`, a name only containers on `devforge-kafka-net` can resolve.
- `client` mounts the current folder read-only at `/work`, for configuration files later.

### 2. What each acks setting tells you

`kafka-verifiable-producer.sh` is a test tool shipped with Kafka that prints one JSON line per record it gets a reply for. `--acks -1` means `all`.

```bash run
for acks in -1 1 0; do
  offsets=$(client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic acks-demo --max-messages 2 --acks "$acks" \
    | grep -o '"offset":-\{0,1\}[0-9]*' | cut -d: -f2 | tr '\n' ' ')
  echo "acks=$acks → offsets reported: $offsets"
done
```

```text output
acks=-1 → offsets reported: 0 1
acks=1 → offsets reported: 2 3
acks=0 → offsets reported: -1 -1
```

With `acks=0` the producer does not wait for any reply, so it never learns where (or whether) its records were stored — the documentation says the offset "will always be set to -1". `acks=1` and `acks=all` look the same here because this broker has no replicas; the difference appears in *Replication and fault tolerance*.

### 3. A five-second outage, with the default settings

Send six payments at one per second, and pause the broker for five seconds after the first one is stored:

```bash run
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic payments --partitions 1 --replication-factor 1 > /dev/null
client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic payments --max-messages 6 --throughput 1 --acks -1 > outage.jsonl 2>&1 &
producer=$!
for i in $(seq 1 150); do grep -q '"offset"' outage.jsonl && break; sleep 0.2; done
docker pause devforge-kafka > /dev/null
sleep 5
docker unpause devforge-kafka > /dev/null
wait "$producer"
grep -o '"value":"[0-9]*","partition":0,"offset":[0-9]*' outage.jsonl | sed 's/"value":"\([0-9]*\)".*"offset":/payment \1 → offset /'
grep -o '"sent":[0-9]*,"acked":[0-9]*' outage.jsonl
```

```text output
payment 0 → offset 0
payment 1 → offset 1
payment 2 → offset 2
payment 3 → offset 3
payment 4 → offset 4
payment 5 → offset 5
"sent":6,"acked":6
```

Nothing reached the application but success: the producer kept retrying behind the scenes, well inside its two-minute `delivery.timeout.ms`, and the broker stored every payment once, in order. `docker pause` freezes the broker's processes without closing its network, which is what a long garbage-collection pause or an overloaded machine looks like to a client.

### 4. The same outage with a three-second deadline

Now give up after 3 seconds (`delivery.timeout.ms=3000`, with `request.timeout.ms=1000` and `linger.ms=0`, which the deadline must be at least the sum of):

```bash run
printf 'delivery.timeout.ms=3000\nrequest.timeout.ms=1000\nlinger.ms=0\n' > short-deadline.properties
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic payments-short --partitions 1 --replication-factor 1 > /dev/null
client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic payments-short --max-messages 6 --throughput 1 --acks -1 \
  --command-config /work/short-deadline.properties > deadline.jsonl 2>&1 &
producer=$!
for i in $(seq 1 150); do grep -q '"offset"' deadline.jsonl && break; sleep 0.2; done
docker pause devforge-kafka > /dev/null
sleep 6
docker unpause devforge-kafka > /dev/null
wait "$producer" || true
acked=$(grep -c producer_send_success deadline.jsonl || true)
failed=$(grep -c producer_send_error deadline.jsonl || true)
stored=$(client kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic payments-short | cut -d: -f3)
echo "reported to the application: $acked acknowledged, $failed failed"
echo "at least one send failed: $([ "$failed" -ge 1 ] && echo yes)"
echo "every failure is a TimeoutException: $(grep producer_send_error deadline.jsonl | grep -vc 'errors.TimeoutException' | sed 's/^0$/yes/')"
echo "records in the log ≥ records acknowledged: $([ "$stored" -ge "$acked" ] && echo yes)"
```

```text output
reported to the application: … acknowledged, … failed
at least one send failed: yes
every failure is a TimeoutException: yes
records in the log ≥ records acknowledged: yes
```

This time the producer gave up on the records it could not deliver within 3 seconds and reported `TimeoutException` to the application. How many fail depends on timing, so the counts are shown as `…` here.

The important part is what a timeout means. When this lesson was recorded, two records reported as failed were nonetheless in the log afterwards: the requests had reached the paused broker's network buffer, and the broker wrote them when it woke up — after the client had stopped waiting. A timeout tells you **"I don't know"**, not **"not written"**. If the application simply sends those records again, they are stored twice. That is why the defaults retry for two minutes with idempotence on, why consumers should tolerate duplicates, and why *Delivery guarantees and idempotent producers* introduces transactions.

### 5. Clean up

```bash run
docker rm -f devforge-kafka > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Lowering `delivery.timeout.ms` "to fail fast"** and then resending on timeout — this turns a short outage into duplicates.
- **Turning idempotence off by accident.** Setting `acks=1`, `retries=0` or more than 5 in-flight requests disables it silently (unless you set `enable.idempotence=true`, which then rejects the conflict).
- **`acks=0` or `acks=1` for business data.** One broker failure can lose acknowledged records.
- **Ignoring the send callback or future.** Errors arrive asynchronously; an unchecked `send()` loses them.
- **Advertising `localhost`.** Clients in other containers or machines then try to connect to themselves; advertise an address they can reach.

## Where this fits in a real system

Applications in **Kubernetes** run as Pods that reach brokers through advertised addresses, exactly like the client containers here. Producer errors and retries are worth exporting as **Prometheus** metrics (the Java client reports `record-error-rate` and `record-retry-rate`), and a producer span from **OpenTelemetry** shows a slow send as a long `publish` span.
