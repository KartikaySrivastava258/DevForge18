---
id: kafka-consumer-groups-and-offsets
title: Consumer groups, offsets and lag
track: kafka
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [kafka-topics-and-partitions]
learning_objectives:
  - Read a topic as a consumer group and explain what a committed offset is.
  - Measure consumer lag and watch it rise and fall.
  - Replay a topic by resetting a group's offsets, and explain why that is possible.
resources:
  - title: Kafka design — the consumer (4.4)
    url: https://kafka.apache.org/44/design/design/
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Why Kafka tracks one position per partition per group, and why events are kept after they are read.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: The consumer rebalance protocol (4.4)
    url: https://kafka.apache.org/44/operations/consumer-rebalance-protocol/
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The newer consumer group protocol (KIP-848) used here, and how to enable it.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: lag
    prompt: kafka-consumer-groups.sh shows CURRENT-OFFSET 5 and LOG-END-OFFSET 7 for partition 0. What does that mean?
    options:
      - { id: a, text: "Two events in partition 0 have been written but not yet processed by this group — a lag of 2" }
      - { id: b, text: "Two events were lost" }
      - { id: c, text: "The group read two events twice" }
    answer: a
    explanation: The committed offset is the next event the group will read; the log-end offset is where the next new event will be written. The difference is the lag — work waiting for this group.
  - id: two-groups
    prompt: The billing service and the email service both read the orders topic, each with its own group. Billing has read everything; email has read nothing. What does email see?
    options:
      - { id: a, text: "Nothing — billing already consumed the events" }
      - { id: b, text: "Every event: each group has its own offsets, and reading never removes events" }
      - { id: c, text: "Only the events billing skipped" }
    answer: b
    explanation: Kafka keeps events for the topic's retention period regardless of who has read them, and tracks positions per group. That is how many independent services can read the same stream.
  - id: replay
    prompt: A bug in the billing service wrote wrong invoices for the last hour. After fixing it, how can billing process those events again?
    options:
      - { id: a, text: "Ask the producers to send the events again" }
      - { id: b, text: "Stop the billing consumers and reset the group's offsets to an earlier position (for example by time), then start them again" }
      - { id: c, text: "It cannot: events are deleted once read" }
    answer: b
    explanation: Because events stay in the log, a group can move its offsets back and reprocess. kafka-consumer-groups.sh --reset-offsets supports --to-earliest, --to-datetime and more; the group must have no active members while you do it.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with apache/kafka:4.4.0 (pinned by digest), after the previous lesson; the output shown was recorded from that run. Facts about offsets, retention and the consumer protocol were checked against the Kafka 4.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **consumer group** is a named set of readers that share a topic's work; Kafka remembers, per group and per partition, the **offset** of the next event to read, so a group can stop and resume — or go back and read again.

## Explain it like I'm twelve

Back at the noticeboard, each team of readers keeps one bookmark per board. When a reader finishes a notice, they move the bookmark. If they go home and come back tomorrow, they start from the bookmark. Another team has its own bookmarks and reads at its own speed. And if a team realises it misread last week's notices, it can move its bookmarks back.

Where the analogy breaks: the bookmarks are stored by Kafka itself, so a different reader from the same team can pick up exactly where the last one stopped.

## What problem it solves

A service that processes events must not lose its place when it restarts, and must not force other services to keep pace with it. Per-group offsets give each service its own position. The **lag** — how far a group is behind the newest events — tells you whether it keeps up, and because events stay in the log, a group can replay them after a bug is fixed.

## How it works

```diagram steps=kafka/offsets-and-lag
```

- The **log-end offset** is where the next event will be written in a partition.
- The **committed offset** is a group's bookmark: the next event it will read. Consumers commit as they go.
- **Lag** = log-end offset − committed offset.
- Committed offsets are themselves stored in Kafka, in an internal topic.
- Events are not deleted when they are read; they are kept for the topic's retention time (by default 168 hours — a week) or size limit.

## Try it yourself

> **Local lab** — continue with the `devforge-kafka` container and the `orders` topic from the previous lesson. If you opened a new terminal, define the `kafka` function again (step 1 of the previous lesson). Every command is run automatically in DevForge's tests.

The consumer commands below add `--command-property group.protocol=consumer`. That turns on Kafka's newer consumer group protocol (KIP-848), which is production-ready since Kafka 4.0 but not yet the default for clients.

### 1. Read the topic as a group

```bash run
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
  --group billing --command-property group.protocol=consumer \
  --from-beginning --max-messages 6 --timeout-ms 15000 2>/dev/null | sort
```

```text output
order-1
order-2
order-3
order-4
order-5
order-6
```

`--group billing` makes this consumer a member of the group `billing`. As it reads, it commits its offsets. Partitions are read in no particular order relative to each other, so the output is sorted.

### 2. Look at the group's offsets

```bash run
kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group billing
```

```text output

Consumer group 'billing' has no active members.

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
billing         orders          0          5               5               0               -               -               -
billing         orders          1          0               0               0               -               -               -
billing         orders          2          1               1               0               -               -               -
```

- The consumer has exited, so the group has *no active members* — but its offsets are remembered.
- Partition 0 holds 5 events (offsets 0–4), so the next one to read is 5: `CURRENT-OFFSET 5`, `LOG-END-OFFSET 5`, `LAG 0`. Partition 2 holds `meera`'s one event.

### 3. New events create lag

```bash run
printf 'ravi:order-7\nmeera:order-8\nasha:order-9\n' |
  kafka kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders \
    --reader-property parse.key=true --reader-property key.separator=:
kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group billing
```

```text output

Consumer group 'billing' has no active members.

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
billing         orders          0          5               7               2               -               -               -
billing         orders          1          0               0               0               -               -               -
billing         orders          2          1               2               1               -               -               -
```

`ravi` and `asha` went to partition 0 again (lag 2), `meera` to partition 2 (lag 1). In production, lag that keeps growing means the consumers cannot keep up.

### 4. Catch up

Without `--from-beginning`, a group member starts at the group's committed offsets:

```bash run
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
  --group billing --command-property group.protocol=consumer \
  --max-messages 3 --timeout-ms 15000 2>/dev/null | sort
kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group billing | grep orders
```

```text output
order-7
order-8
order-9

Consumer group 'billing' has no active members.
billing         orders          0          7               7               0               -               -               -
billing         orders          1          0               0               0               -               -               -
billing         orders          2          2               2               0               -               -               -
```

Only the three new events were read, and the lag is back to 0.

### 5. Where the offsets live

```bash run
kafka kafka-topics.sh --bootstrap-server localhost:9092 --list
```

```text output
__consumer_offsets
orders
```

`__consumer_offsets` is the internal topic in which Kafka stores every group's committed offsets. Kafka created it the first time a group committed.

### 6. Replay from the beginning

```bash run
kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group billing \
  --reset-offsets --to-earliest --topic orders --execute
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
  --group billing --command-property group.protocol=consumer \
  --max-messages 9 --timeout-ms 15000 2>/dev/null | wc -l
```

```text output

GROUP           TOPIC           PARTITION  NEW-OFFSET
billing         orders          0          0
billing         orders          1          0
billing         orders          2          0
9
```

- `--reset-offsets --to-earliest --execute` moves the group's bookmarks back to the start of every partition. It only works while the group has no active members. With `--dry-run` instead of `--execute`, it only shows what it would do — a safe first step. (Kafka 4.4 still treats a missing `--execute` as a dry run, but warns that version 5.0 will require one of the two flags.)
- The group then read all 9 events again (`wc -l` counts the lines). Nothing was deleted when it read them the first time.

**Keep the `devforge-kafka` container running** for the next lesson.

## Common mistakes

- **Assuming events disappear once read.** They stay until retention removes them; other groups — and this group after a reset — can read them.
- **Two services sharing one group name.** They then *split* the events between them instead of each seeing all of them. Give every service its own group.
- **Resetting offsets while consumers are running.** Kafka refuses: `Error: Assignments can only be reset if the group 'billing' is inactive, but the current state is Stable.` Stop the consumers first.
- **Ignoring lag.** Monitor it (for example with **Prometheus**); steadily growing lag means more consumers, more partitions or faster processing are needed.
- **Assuming "processed exactly once".** If a consumer crashes after doing the work but before committing, the next member reads that event again. Make processing safe to repeat.

## Where this fits in a real system

Each service — billing, shipping, analytics — reads the same topic with its own group and its own pace. Lag is one of the most watched numbers in event-driven systems, usually exported to **Prometheus** and shown in **Grafana**. Replays let teams fix a bug and reprocess history, or feed a new service with the past events of a topic.
