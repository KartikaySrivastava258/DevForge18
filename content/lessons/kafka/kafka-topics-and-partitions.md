---
id: kafka-topics-and-partitions
title: Events, topics and partitions
track: kafka
order: 1
level: beginner
estimated_minutes: 35
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain what an event, a topic and a partition are, and why Kafka splits topics into partitions.
  - Run a single-node Kafka broker and create a topic with several partitions.
  - Produce keyed events and show that one key always lands in one partition, in order.
resources:
  - title: Apache Kafka quickstart
    url: https://kafka.apache.org/quickstart
    publisher: The Apache Software Foundation
    type: tutorial
    level: beginner
    official: true
    why: The official first steps, including the apache/kafka Docker image used in this lesson.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Introduction to Apache Kafka (4.4)
    url: https://kafka.apache.org/44/getting-started/introduction/
    publisher: The Apache Software Foundation
    type: documentation
    level: beginner
    official: true
    why: Events, topics, partitions and the ordering guarantee, in Kafka's own words.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Producer configuration (4.4)
    url: https://kafka.apache.org/44/configuration/producer-configs/
    publisher: The Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: How the default partitioner chooses a partition, with and without a key.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: same-key
    prompt: All events for customer asha are sent with the key asha. What does Kafka guarantee about them?
    options:
      - { id: a, text: "They are spread evenly over all partitions" }
      - { id: b, text: "They all go to the same partition, so a consumer reads them in the order they were written" }
      - { id: c, text: "They are stored in a separate topic for that customer" }
    answer: b
    explanation: The default partitioner chooses the partition from a hash of the key, so one key always maps to one partition, and Kafka guarantees that a partition is read in exactly the order it was written.
  - id: cross-partition
    prompt: You read the whole topic and see order-4 (partition 2) printed before order-3 (partition 0), although order-3 was sent first. Is something wrong?
    options:
      - { id: a, text: "Yes — Kafka lost the order" }
      - { id: b, text: "No — order is guaranteed only within a partition; across partitions a consumer may read in any interleaving" }
      - { id: c, text: "Yes — the producer must be restarted" }
    answer: b
    explanation: Kafka orders events per partition. If two events must stay in order, give them the same key so they share a partition.
  - id: why-partitions
    prompt: Why would a topic have several partitions instead of one?
    options:
      - { id: a, text: "So several consumers (and brokers) can work on the topic in parallel, each on its own partitions" }
      - { id: b, text: "So events can be deleted after they are read" }
      - { id: c, text: "Partitions encrypt the data" }
    answer: a
    explanation: A partition is the unit of parallelism. One partition is read by at most one consumer in a group at a time, so more partitions allow more consumers to share the work.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka:4.4.0 image (pinned by digest), running one broker in KRaft mode; the output shown was recorded from that run. Facts about partitioning and ordering were checked against the Kafka 4.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Kafka** stores **events** — small records of something that happened, such as "order 3 was placed" — in named, append-only logs called **topics**, each split into **partitions** that keep their events in the order they were written.

## Explain it like I'm twelve

Imagine a school noticeboard where nobody ever removes a notice; new ones are pinned at the bottom. Anyone can read from the top, and each reader keeps their own bookmark. Because one board would get crowded, there are three boards side by side, and every notice about the same pupil always goes on the same board, so that pupil's notices stay in order.

The boards are **partitions**, the set of boards is a **topic**, and the pupil's name is the **key**.

Where the analogy breaks: Kafka keeps notices for a set time (or size), not forever, and reading a notice never removes it.

## What problem it solves

When one service calls another directly, both must be up at the same moment, and every new service that cares about an event needs a new connection. With Kafka, a service writes an event once; any number of other services read it when they are ready, at their own pace, even hours later. Partitions let that reading be shared between many copies of a service.

## How it works

![](media:kafka/topic-partitions.svg)

- A **producer** sends events to a topic. Each event can have a **key**.
- With a key, the default partitioner chooses the partition from a **hash of the key**, so one key always goes to the same partition. Without a key, the producer fills one partition for a while, then moves on.
- Each partition is an append-only log. Every event gets the next **offset** (0, 1, 2 …) in its partition.
- Kafka guarantees that a partition is read in exactly the order it was written. There is no order *across* partitions.
- A **broker** is a Kafka server. This lab runs one; production clusters run several and copy each partition to more than one broker.

## Try it yourself

> **Local lab** — needs Docker (see the Docker track). Kafka runs in a container, and its command-line tools are run inside it. Every command is run automatically in DevForge's tests on a disposable Docker engine. Run it where nothing else is called `devforge-kafka`; the last lesson of this series removes the container.

### 1. Start a broker

```bash run
docker run -d --name devforge-kafka -p 127.0.0.1:9092:9092 \
  apache/kafka:4.4.0@sha256:833b867a9585a141da455dc2b57431c65cbccb27f11c91f694444cca9f777e0f > /dev/null
kafka() { docker exec -i devforge-kafka "/opt/kafka/bin/$1" "${@:2}"; }
for i in $(seq 1 60); do
  kafka kafka-topics.sh --bootstrap-server localhost:9092 --list > /dev/null 2>&1 && break
  sleep 1
done
kafka kafka-topics.sh --version
```

```text output
4.4.0
```

- The image is the official one from Kafka's quickstart, pinned to version 4.4.0 *and* its digest, so it cannot change under you.
- `-p 127.0.0.1:9092:9092` makes the broker's port 9092 reachable from your own computer only.
- `kafka() { … }` defines a small shell function: `kafka kafka-topics.sh …` runs Kafka's `kafka-topics.sh` tool inside the container. If you open a new terminal, define it again.
- The loop waits until the broker answers, for at most a minute.
- This broker runs in **KRaft** mode: Kafka manages its own cluster metadata. (Older Kafka needed a separate ZooKeeper service; Kafka 4 removed that.)

### 2. Create a topic with three partitions

```bash run
kafka kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 3 --replication-factor 1
kafka kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders
```

```text output
Created topic orders.
Topic: orders	TopicId: …	PartitionCount: 3	ReplicationFactor: 1	Configs: min.insync.replicas=1,segment.bytes=1073741824
	Topic: orders	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
	Topic: orders	Partition: 1	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
	Topic: orders	Partition: 2	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
```

- `--bootstrap-server` is where the tool finds the cluster.
- `--replication-factor 1` keeps one copy of each partition — the only option with one broker. Production topics often keep three, on three different brokers.
- Each partition has a **leader** (the broker that handles it, here broker 1) and **replicas** (brokers with a copy). `Isr` lists the replicas that are up to date.

### 3. Produce keyed events

Each line is `key:value`. The producer reads lines from its input:

```bash run
printf 'asha:order-1\nravi:order-2\nasha:order-3\nmeera:order-4\nravi:order-5\nasha:order-6\n' |
  kafka kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders \
    --reader-property parse.key=true --reader-property key.separator=:
```

`parse.key=true` tells the producer that each line has a key, and `key.separator=:` where it ends. (Kafka 4.4 calls these *reader properties*; older guides use `--property`, which still works but is deprecated.)

### 4. See where they went

```bash run
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --from-beginning \
  --max-messages 6 --timeout-ms 15000 \
  --formatter-property print.partition=true --formatter-property print.offset=true \
  --formatter-property print.key=true 2>/dev/null | sort
```

```text output
Partition:0	Offset:0	asha	order-1
Partition:0	Offset:1	ravi	order-2
Partition:0	Offset:2	asha	order-3
Partition:0	Offset:3	ravi	order-5
Partition:0	Offset:4	asha	order-6
Partition:2	Offset:0	meera	order-4
```

- `--from-beginning` reads the topic from the first event; `--max-messages 6` stops after six. `2>/dev/null` hides the tool's status messages, and `sort` lines the output up by partition.
- **Every `asha` and `ravi` event is in partition 0** and every `meera` event in partition 2: the key decided. Which partition a key lands in depends on its hash and the number of partitions; partition 1 simply received no key this time.
- Within partition 0, offsets 0 to 4 are in the order the events were sent: `order-1`, `order-3` and `order-6` for asha stay in order.

### 5. Read one partition in order

```bash run
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
  --partition 0 --offset earliest --max-messages 5 --timeout-ms 15000 \
  --formatter-property print.offset=true 2>/dev/null
```

```text output
Offset:0	order-1
Offset:1	order-2
Offset:2	order-3
Offset:3	order-5
Offset:4	order-6
```

Reading a single partition gives exactly the order of writing, as Kafka guarantees. Reading the whole topic interleaves partitions in no particular order — that is why step 4 needed `sort`.

**Keep the `devforge-kafka` container running** for the next lesson.

## Common mistakes

- **Expecting order across a whole topic.** Only each partition is ordered. Use the same key for events that must stay in order (all events of one order, one account, one device).
- **Choosing too few partitions.** A partition is read by one consumer per group at a time, so the number of partitions limits how many consumers can share the work.
- **Changing the number of partitions later and expecting keys to stay put.** The key-to-partition mapping depends on the partition count; adding partitions moves keys.
- **Thinking reading removes events.** Events stay until the topic's retention time or size limit, however many times they are read.
- **Using `localhost` from another container.** Inside another container, `localhost` means that container itself. Reaching the broker from other containers needs a listener the broker advertises on their network — a configuration step beyond this lab.

## Where this fits in a real system

Services publish what happened — an order placed, a payment taken — to Kafka topics, and other services react: shipping, email, analytics. The **outbox** pattern writes such events reliably alongside a **PostgreSQL** transaction; **OpenTelemetry** context can travel in event headers so traces cross the queue. In **Kubernetes**, Kafka can run as a set of brokers managed by an operator.
