---
id: kafka-scaling-consumers
title: Scaling consumers and rebalancing
track: kafka
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [kafka-consumer-groups-and-offsets]
learning_objectives:
  - Explain how a group shares a topic's partitions among its members.
  - Show why a group cannot use more consumers than the topic has partitions.
  - Watch the group rebalance when a member leaves.
resources:
  - title: Kafka design (4.4)
    url: https://kafka.apache.org/44/design/design/
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The rule that each partition is consumed by exactly one consumer within a group at a time.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: The consumer rebalance protocol (4.4)
    url: https://kafka.apache.org/44/operations/consumer-rebalance-protocol/
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: How the newer, incremental protocol assigns partitions and why rebalances are faster with it.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: fifth-consumer
    prompt: A topic has 4 partitions and its group has 4 consumers, all busy. You add a fifth. What happens?
    options:
      - { id: a, text: "The work is split five ways and each consumer does less" }
      - { id: b, text: "The fifth consumer gets no partition and stays idle, because each partition is read by only one member of a group" }
      - { id: c, text: "Kafka creates a fifth partition automatically" }
    answer: b
    explanation: The number of partitions is the limit on parallelism within one group. To use more consumers, the topic needs more partitions — and adding partitions changes which partition each key maps to.
  - id: member-leaves
    prompt: One of three consumers in a group crashes. What happens to its partitions?
    options:
      - { id: a, text: "They are not read until it comes back" }
      - { id: b, text: "The group rebalances: its partitions are assigned to the remaining members, which continue from the committed offsets" }
      - { id: c, text: "Their events are deleted" }
    answer: b
    explanation: The group coordinator notices the member is gone and moves its partitions to others. Because offsets are committed in Kafka, the new owner continues where the group left off — possibly re-reading events processed but not yet committed.
  - id: idle-useful
    prompt: Is an idle consumer (0 partitions) ever useful?
    options:
      - { id: a, text: "No, never" }
      - { id: b, text: "Yes, as a standby: if a busy member leaves, the idle one can take over its partitions at once" }
      - { id: c, text: "Yes, it reads all partitions as a backup copy" }
    answer: b
    explanation: An idle member does no work while everyone is healthy, but it is ready to take a partition during a rebalance — as you will see in this lesson.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with apache/kafka:4.4.0 (pinned by digest), after the previous lessons; the output shown was recorded from that run. Group membership changes over several seconds, so the lesson waits until the group has settled before looking. Facts were checked against the Kafka 4.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Kafka shares a topic between the members of a consumer group by giving **each partition to exactly one member**; when members join or leave, the group **rebalances** — partitions move — so a group can grow up to the number of partitions and survive the loss of a member.

## Explain it like I'm twelve

Three boards of notices, and a team of readers. Each board can have only one reader from the team at a time, so they do not read the same notice twice. With two readers, one reads two boards. With three, one board each. A fourth reader has no board and waits by the door — until someone goes home, and then takes over that person's board, starting from their bookmark.

Where the analogy breaks: the team does not have to talk it over; a coordinator in Kafka hands out the boards.

## What problem it solves

One consumer may be too slow for a busy topic, and a single consumer is a single point of failure. A group spreads the partitions over several consumers — usually several copies of the same service — and redistributes them automatically when a copy crashes or a new one starts, without the service needing to coordinate anything itself.

## How it works

![](media:kafka/group-assignment.svg)

- Every partition of a topic is assigned to **one member** of each group at a time.
- More members than partitions means some members get **no partitions**.
- When a member joins or leaves, partitions are reassigned: a **rebalance**. Kafka's newer protocol (KIP-848) does this incrementally, moving only the partitions that need to move.
- The new owner of a partition continues from the group's committed offset.

## Try it yourself

> **Local lab** — continue with the `devforge-kafka` container and the `kafka` function. Every command is run automatically in DevForge's tests. Consumer IDs are random, so the lesson summarises membership instead of printing them.

### 1. Start four consumers for three partitions

Each command ends with `&`, so it runs in the background. Three consumers wait up to three minutes for new events; the fourth gives up after 45 seconds without one — that is how one member will "leave" in step 3.

```bash run
for n in 1 2 3; do
  kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
    --group shipping --command-property group.protocol=consumer --timeout-ms 180000 > /dev/null 2>&1 &
done
kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders \
  --group shipping --command-property group.protocol=consumer --timeout-ms 45000 > /dev/null 2>&1 &
```

### 2. See how the partitions were shared

Joining takes a few seconds. This helper waits until the group has the given number of members and is not in the middle of a rebalance, then prints how many partitions each member has:

```bash run
members() {
  for i in $(seq 1 90); do
    out=$(kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group shipping --members 2>&1)
    if [ "$(echo "$out" | grep -c console-consumer)" -eq "$1" ] && ! echo "$out" | grep -q rebalancing; then
      echo "$out" | awk '/console-consumer/ {print "member with", $5, "partition(s)"}' | sort
      return 0
    fi
    sleep 1
  done
  echo "the group did not settle with $1 members"
  return 1
}
members 4
```

```text output
member with 0 partition(s)
member with 1 partition(s)
member with 1 partition(s)
member with 1 partition(s)
```

- `--describe --members` lists the group's members and how many partitions each has (column 5, which `awk` picks out).
- Three partitions, four members: three members get one partition each, and **one gets none**. Adding consumers beyond the number of partitions adds no throughput.

### 3. A member leaves

The fourth consumer gives up after 45 seconds without new events. Wait for the group to settle with three members:

```bash run
members 3
```

```text output
member with 1 partition(s)
member with 1 partition(s)
member with 1 partition(s)
```

Every partition still has an owner. If the member that left had a partition, the idle member took it over in the rebalance; if the idle member was the one that left, nothing needed to move. Either way, no partition is left unread.

### 4. Clean up

This removes the broker and every event in it (the container's storage goes with it):

```bash run
docker rm -f devforge-kafka
```

```text output
devforge-kafka
```

The background consumers stop when the container is gone.

## Try it in the simulation

Scale a group up and down, crash a member and watch the lag. It is a labelled teaching model of a consumer group, not a real Kafka cluster.

```simulation kafka-consumer-groups scenario=falling-behind
```

## Common mistakes

- **Scaling consumers past the partition count.** Extra members sit idle. Plan partitions for the parallelism you expect.
- **Long processing without returning to Kafka.** A member that stays silent too long is considered gone, and its partitions are moved — leading to repeated rebalances. Keep each batch of work short, or tune the client's timeouts.
- **Assuming a rebalance is instant.** Members join and leave over seconds; tests and scripts should wait for the group to settle, as here.
- **Relying on which member gets which partition.** Assignment can change at any rebalance; never store per-partition state only in memory.
- **Forgetting that a rebalance can repeat work.** Events processed but not yet committed by a member that leaves are read again by the new owner.

## Where this fits in a real system

In **Kubernetes**, a Deployment of several copies of a consumer service forms one group; scaling the Deployment changes the members, and Kafka rebalances. Group lag and member counts are watched in **Prometheus** and **Grafana**; a growing lag with idle members is the signal that the topic needs more partitions rather than more Pods.
