---
id: kafka-offsets-retention-and-replay
title: Offsets, retention and replay in depth
track: kafka
order: 5
level: intermediate
estimated_minutes: 45
prerequisites: [kafka-producers-acks-and-retries]
starts_fresh: true
learning_objectives:
  - Move a consumer group's offsets to replay events — to an offset, by a relative shift, or to a point in time — and preview with --dry-run.
  - Explain why offsets can only be reset while the group has no active members.
  - Show that time-based retention compares record timestamps with the current time, and what happens to committed offsets that fall behind the log start.
  - Use log compaction to keep the latest value per key, and explain why offsets then have gaps.
resources:
  - title: Topic configs (Apache Kafka 4.4)
    url: https://kafka.apache.org/44/configuration/topic-configs/
    publisher: Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: retention.ms (default 7 days), retention.bytes (per partition, default unlimited), segment.ms, cleanup.policy (delete, compact or both) and min.cleanable.dirty.ratio.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Consumer configs (Apache Kafka 4.4)
    url: https://kafka.apache.org/44/configuration/consumer-configs/
    publisher: Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: auto.offset.reset (earliest, latest, by_duration, none) applies when a group has no offset or its offset no longer exists.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Design — log compaction
    url: https://kafka.apache.org/44/design/design/
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: Compaction keeps at least the last value for each key; offsets of kept records never change, so compacted logs have gaps.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: replay
    prompt: A bug in the reporting service miscounted clicks since 10:42. How do you recompute them?
    options:
      - { id: a, text: "Ask producers to send the events again" }
      - { id: b, text: "Deploy the fix, stop the group's consumers, reset the group's offsets --to-datetime just before 10:42 (preview with --dry-run), then start them again — the events are still in the log" }
      - { id: c, text: "Delete the topic" }
    answer: b
    explanation: Replay works only while the events are still retained, and only for a group with no active members.
  - id: retention
    prompt: A topic keeps 7 days. You import events whose timestamps are from last month. What happens?
    options:
      - { id: a, text: "They are kept for 7 days from now" }
      - { id: b, text: "They can be deleted almost at once — time-based retention compares the record timestamps (CreateTime by default) with the current time" }
      - { id: c, text: "Kafka rejects them" }
    answer: b
    explanation: The lab shows five January-dated records disappear within seconds. Set message.timestamp.type=LogAppendTime on the topic if arrival time should count instead.
  - id: compaction
    prompt: After compaction, the prices topic starts at offset 3. Did something go wrong?
    options:
      - { id: a, text: "Yes, records were lost" }
      - { id: b, text: "No — older values for the same keys were removed, and the kept records keep their original offsets, so the log has gaps" }
      - { id: c, text: "The topic was recreated" }
    answer: b
    explanation: Consumers must not assume consecutive offsets; they read whatever offsets exist.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/kafka 4.4.0 image (pinned by digest), starting from nothing, and its output is compared with this lesson. The broker checks retention and compaction every second instead of every 5 minutes and 15 seconds, so the lab does not wait long; waits are for conditions, not fixed times. Checked against the Apache Kafka 4.4 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A Kafka topic is a log that **keeps events after they are read**, so a consumer group can **rewind** its offsets and process them again — for as long as **retention** keeps them, or, with **compaction**, keeping the latest value of every key indefinitely.

## Explain it like I'm twelve

A class diary is never torn up after reading. If you copied the homework wrong yesterday, you go back to yesterday's page and copy it again — that is **replay**. The school throws away diaries older than a week to save shelf space — **retention**. And the noticeboard of lunch prices only needs the latest price of each item: when tea goes from 10 to 12 to 14, the old cards are thrown away and only "tea: 14" stays — **compaction**.

## What problem it solves

Bugs in consumers are inevitable. With a queue that deletes messages once read, a bug means lost or wrong results. With Kafka, you fix the consumer and replay. The same property lets a brand-new service read the full history, and lets you rebuild a cache or a search index from a compacted topic. Retention and compaction keep disks from filling up while preserving what matters.

## How it works

![](media:kafka/retention-and-compaction.svg)

- A partition is stored as **segments**. Only closed segments are deleted or compacted; the newest (active) segment is left alone until it rolls (`segment.ms`, `segment.bytes`).
- **Retention by time** (`retention.ms`, 7 days by default) deletes a closed segment once its newest record's timestamp is older than that. Retention by size (`retention.bytes`) is per partition and off by default.
- **Compaction** (`cleanup.policy=compact`) keeps at least the latest record for each key; kept records keep their offsets.
- A group's **committed offset** is just a number per partition. `kafka-consumer-groups.sh --reset-offsets` changes it — only while the group has no active members.
- If a committed offset no longer exists (retention deleted it), the consumer falls back to `auto.offset.reset`.

## Try it yourself

> **Local lab** — needs Docker. Like the previous lesson, the broker runs on the `devforge-kafka-net` network and every tool runs in its own client container. Two settings make the broker check retention and compaction every second instead of every few minutes, so you do not wait; production keeps the defaults. Every command is run automatically in DevForge's tests.

### 1. A broker, a topic, and a group that has read everything

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
# lab only: check retention and compaction every second (defaults: 5 minutes and 15 seconds)
KAFKA_LOG_RETENTION_CHECK_INTERVAL_MS=1000
KAFKA_LOG_CLEANER_BACKOFF_MS=1000
ENV
docker run -d --name devforge-kafka --hostname kafka --network devforge-kafka-net --env-file broker.env "$IMAGE" > /dev/null
client() { docker run --rm -i --network devforge-kafka-net "$IMAGE" "/opt/kafka/bin/$1" "${@:2}"; }
for i in $(seq 1 60); do client kafka-topics.sh --bootstrap-server kafka:9092 --list > /dev/null 2>&1 && break; sleep 1; done
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic clicks --partitions 1 --replication-factor 1 > /dev/null
# two batches of five clicks, two seconds apart, so they have clearly different timestamps
client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic clicks --max-messages 5 --value-prefix 1 > /dev/null 2>&1
sleep 2
client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic clicks --max-messages 5 --value-prefix 2 > /dev/null 2>&1
client kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic clicks --group reports --from-beginning --max-messages 10 2> /dev/null | tr '\n' ' '; echo
client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group reports 2>&1 \
  | awk '$1 == "GROUP" || $1 == "reports" {printf "%-8s %-7s %-10s %-15s %-15s %s\n", $1, $2, $3, $4, $5, $6}'
```

```text output
1.0 1.1 1.2 1.3 1.4 2.0 2.1 2.2 2.3 2.4 
GROUP    TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
reports  clicks  0          10              10              0
```

Values are `batch.number`. The group `reports` has committed offset 10 — it has read everything — and its consumer has exited. `awk` keeps the first six columns of the table.

### 2. Offsets can only move while the group is idle

Start a consumer that stays in the group, then try to rewind:

```bash run fails
docker run -d --name devforge-kafka-reader --network devforge-kafka-net "$IMAGE" /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic clicks --group reports > /dev/null
for i in $(seq 1 60); do client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group reports --members 2> /dev/null | grep console-consumer > /dev/null && break; sleep 1; done
client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group reports --topic clicks --reset-offsets --to-offset 0 --execute 2>&1 | grep Error
```

```text output
Error: Assignments can only be reset if the group 'reports' is inactive, but the current state is Stable.
```

Kafka refuses because a running consumer would immediately overwrite the new offsets with its own commits. Stop it — `docker stop` lets it leave the group cleanly — and wait until the group is empty:

```bash run
docker stop -t 10 devforge-kafka-reader > /dev/null
docker rm devforge-kafka-reader > /dev/null
for i in $(seq 1 60); do client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group reports 2>&1 | grep 'no active members' > /dev/null && break; sleep 1; done
client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group reports 2>&1 | grep 'no active members'
```

```text output
Consumer group 'reports' has no active members.
```

### 3. Three ways to rewind

```bash run
reset() { client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group reports --topic clicks --reset-offsets "$@" 2> /dev/null | awk 'NF && $1 != "GROUP" {print "new offset:", $4}'; }
echo "--to-offset 0 --dry-run:"; reset --to-offset 0 --dry-run
client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group reports 2> /dev/null | awk '$1 == "reports" {print "still committed:", $4}'
echo "--shift-by -3 --execute:"; reset --shift-by -3 --execute
# when did the second batch start? read the timestamp of its first record (offset 5)
t=$(client kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic clicks --partition 0 --offset 5 --max-messages 1 \
      --formatter-property print.timestamp=true 2> /dev/null | sed 's/CreateTime:\([0-9]*\).*/\1/')
when=$(date -u -d "@$((t / 1000)).$(printf %03d $((t % 1000)))" +%Y-%m-%dT%H:%M:%S.%3N)
echo "--to-datetime <start of batch 2> --execute:"; reset --to-datetime "$when" --execute
client kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic clicks --group reports --max-messages 5 2> /dev/null | tr '\n' ' '; echo
```

```text output
--to-offset 0 --dry-run:
new offset: 0
still committed: 10
--shift-by -3 --execute:
new offset: 7
--to-datetime <start of batch 2> --execute:
new offset: 5
2.0 2.1 2.2 2.3 2.4 
```

- `--dry-run` shows the plan and changes nothing; `--execute` commits it.
- `--shift-by -3` moves back three records from the committed offset.
- `--to-datetime` finds, in each partition, the first record whose timestamp is at or after the given time (UTC here) — the usual choice after a bad deploy: "replay everything since 10:42". The group then re-read the second batch. (On macOS, `date -d` is spelled `date -r`; the lab uses the Linux form.)

Other options include `--to-earliest`, `--to-latest`, `--by-duration PT10M` and `--from-file` with exact offsets per partition.

### 4. Retention is about record timestamps

Produce five records stamped **15 January 2026** into a topic with the default 7-day retention:

```bash run
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic old-clicks --partitions 1 --replication-factor 1 > /dev/null
client kafka-configs.sh --bootstrap-server kafka:9092 --describe --all --entity-type topics --entity-name old-clicks 2> /dev/null \
  | grep -oE '(^|[[:space:]])retention\.ms=[0-9]+' | tr -d ' '
client kafka-verifiable-producer.sh --bootstrap-server kafka:9092 --topic old-clicks --max-messages 5 \
  --message-create-time 1768471200000 > /dev/null 2>&1   # 2026-01-15T10:00:00Z in milliseconds
for i in $(seq 1 60); do [ "$(client kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic old-clicks --time -2)" = "old-clicks:0:5" ] && break; sleep 1; done
echo "earliest offset: $(client kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic old-clicks --time -2 | cut -d: -f3)"
echo "latest offset:   $(client kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic old-clicks --time -1 | cut -d: -f3)"
client kafka-consumer-groups.sh --bootstrap-server kafka:9092 --group audit --topic old-clicks --reset-offsets --to-offset 2 --execute 2>&1 \
  | grep -o 'New offset (2) is lower than earliest offset.*Value will be set to 5\.'
```

```text output
retention.ms=604800000
earliest offset: 5
latest offset:   5
New offset (2) is lower than earliest offset for topic partition old-clicks-0. Value will be set to 5.
```

All five records are gone within seconds of being written: their timestamps were already more than `604800000` ms (7 days) in the past, and retention compares **record timestamps** with the clock, not the time the records arrived. The log now starts at offset 5. Asking a group to resume from offset 2 is impossible — the tool moves it to the earliest offset that still exists. A consumer that finds its committed offset deleted does the same according to `auto.offset.reset` — and with `latest` it would silently skip everything still in the log.

### 5. Compaction keeps the latest value per key

```bash run
client kafka-topics.sh --bootstrap-server kafka:9092 --create --topic prices --partitions 1 --replication-factor 1 \
  --config cleanup.policy=compact --config segment.ms=2000 --config min.cleanable.dirty.ratio=0.01 > /dev/null
produce() { client kafka-console-producer.sh --bootstrap-server kafka:9092 --topic prices --reader-property parse.key=true --reader-property key.separator=:; }
printf 'tea:10\ncoffee:20\ntea:12\nsamosa:15\ncoffee:22\ntea:14\n' | produce
sleep 3   # let the 2-second segment age, so the next record starts a new segment
printf 'chai:9\n' | produce
read_all() { client kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic prices --from-beginning --timeout-ms 3000 \
  --formatter-property print.key=true --formatter-property print.offset=true 2> /dev/null; }
for i in $(seq 1 60); do [ "$(read_all | wc -l)" -le 4 ] && break; sleep 1; done
read_all
```

```text output
Offset:3	samosa	15
Offset:4	coffee	22
Offset:5	tea	14
Offset:6	chai	9
```

Seven records went in; four remain — the latest price of each item. `tea:10`, `coffee:20` and `tea:12` (offsets 0–2) were removed because newer values for the same keys exist. The survivors kept their offsets, so the log now starts at 3. A topic like this can be read from the beginning to rebuild a complete price list. (A record with a key and an empty value — a *tombstone* — deletes the key itself after `delete.retention.ms`.)

### 6. Clean up

```bash run
docker rm -f devforge-kafka > /dev/null
docker network rm devforge-kafka-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Resetting offsets while consumers run.** Kafka refuses; stop them first, or the reset would be overwritten.
- **Replaying without making the consumer idempotent.** A replay processes events a second time — write results with upserts or keys, not blind inserts.
- **Assuming retention counts from arrival.** Back-filled or old-timestamped events can be deleted at once; use `message.timestamp.type=LogAppendTime` if needed.
- **`auto.offset.reset=latest` for important consumers.** A group whose offsets expired or were deleted silently skips what is still in the log.
- **Compacting a topic without keys.** Compaction works per key; records without a key cannot be compacted.

## Where this fits in a real system

**Airflow** back-fills and Kafka replays solve the same problem for batch and stream: rerun a fixed past window after a fix. Compacted topics feed caches such as **Redis** and the change-data-capture pipelines that copy **PostgreSQL** tables into Kafka (the outbox lesson later in this track). Lag and log-start offsets are standard **Prometheus** metrics for spotting consumers that are about to fall off the end of retention.
