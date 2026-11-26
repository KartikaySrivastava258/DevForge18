---
id: kafka-partitions-and-consumer-groups
title: Observe partitions and consumer groups
track: kafka
level: intermediate
mode: simulation
estimated_minutes: 30
prerequisites: [kafka-topics-and-partitions, kafka-consumer-groups-and-offsets, kafka-scaling-consumers]
objectives:
  - Predict, then watch, how lag grows when a group is too small, and what it takes to drain it.
  - Explain why a member beyond the number of partitions stays idle, and why uneven keys can leave a member with nothing to read.
  - Crash a member, follow the rebalance, and bring the group back to zero lag.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: kafka-consumer-groups
  challenges: [lag-to-zero, idle-member, recover-from-crash]
resources:
  - title: Kafka design (4.4)
    url: https://kafka.apache.org/44/design/design/
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The rule that each partition is consumed by exactly one consumer within a group at a time.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model. Its rules follow the Kafka documentation — one key goes to one partition, each partition is read by exactly one member of a group at a time, and offsets are kept per group and partition — but it uses a simple key hash, round-robin assignment and instant rebalances. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the consumer-group simulation like a scientist: **predict** what the group will do, **run** the experiment, and **compare** with the partitions, the lag and the event log. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of a consumer group, not a Kafka cluster; the lessons *Consumer groups, offsets and lag* and *Scaling consumers and rebalancing* show the same behaviour on a real Kafka broker.

## Steps

### 1. Get the lag to zero

Choose the scenario **One consumer, falling behind**. Four events arrive every tick, and each member can process up to three per tick. Before you touch anything, write down:

- By how much should the total lag grow each tick?
- Which partition does each key land in? Look at the keys in each partition's cells. Is the load spread evenly?

Press **Step** a few times and check your first answer against **Total lag**. Now predict what happens with two members: which partitions will each one get, and can each keep up with its share? Press **Add a consumer**, read the rebalance in the event log, and step again.

A partition can only be read by one member of the group. So it is not the total capacity that matters, but whether each member can keep up with the partitions it owns. Keep going until the lag drains to 0.

### 2. A member with nothing to do

Choose **Four partitions, four members**. Each member reads one partition.

- What will a fifth member receive when the group rebalances?
- The topic starts empty. Press **Step** a few times and look at the partitions. Does every partition actually receive events? A member that owns an empty partition does no work either. How is that different from a member with no partition at all?

Add a member and read the **Group members** list. Why can a group never use more members than the topic has partitions?

### 3. Recover from a crash

Choose **A healthy group of three**. Each member owns one partition, and the lag is 0.

- If one member crashes, which member inherits its partition?
- Three members together could process nine events a tick, and two could process six. Four events arrive each tick. Is "six is more than four" enough to say the group will keep up? Check which partitions the surviving members own.

Use one of the **Crash** buttons, step a few ticks and watch the lag. Then bring the group back to zero lag. Adding a member is one way. If you want to explore, is it the only one? Read the event log's warning if you try something else.

## Simulation

```simulation kafka-consumer-groups
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state. Your verified challenges stay recorded.

## What you practised

A consumer group shares partitions, not events: each partition has exactly one reader in the group. How fast a group keeps up depends on how the keys spread over the partitions and how the partitions spread over the members. After a crash, the group rebalances, and it may need extra capacity to catch up.
