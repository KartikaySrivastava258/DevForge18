---
id: kafka-order-pipeline
track: kafka
title: Order event pipeline
level: beginner
estimated_hours: 5
prerequisites: [kafka-topics-and-partitions, kafka-consumer-groups-and-offsets, kafka-producers-acks-and-retries]
related_tracks: []
user_stories:
  - As a billing developer, I want every order event in Kafka so that my service never misses a payment.
  - As a delivery developer, I want an order's events to arrive in the order they happened so that I never see "shipped" before "paid".
  - As an operator, I want a consumer that restarts where it stopped so that a restart neither skips nor repeats events.
acceptance_criteria:
  - producer.py publishes every event from orders.jsonl to the topic orders and prints "sent <n>"; all events are in the topic.
  - Every event is the JSON object from orders.jsonl, with its order_id as the message key.
  - The events of one order are in one partition, stored in the order they happened.
  - consumer.py (group order-status) prints every order's latest status.
  - A second run of consumer.py prints {} — committed offsets mean nothing is processed twice — and the group has no lag.
rubric:
  - { criterion: "Producer", excellent: "Keys chosen for ordering, delivery confirmed (flush and delivery callback), acks=all with idempotence, and the program exits non-zero if anything was not delivered.", good: "All events delivered with keys.", needs_work: "Fire-and-forget: produce() without waiting for delivery." }
  - { criterion: "Consumer", excellent: "Commits only after processing, starts from the earliest offset as a new group, stops cleanly, and the README explains what happens if it crashes between processing and committing.", good: "Correct statuses and no reprocessing.", needs_work: "Auto-commit before processing, or a group that starts from the end and misses history." }
  - { criterion: "Understanding", excellent: "Explains in the README why ordering holds only within a partition and what would happen with a different key (for example the customer).", good: "Explains why the key is the order id.", needs_work: "No explanation." }
hints:
  - Run the starter producer and count the messages in the topic (kafka-get-offsets.sh or a console consumer). Where did they go? produce() puts a message in a buffer; flush() waits for the broker to acknowledge it.
  - Kafka keeps order within a partition. Messages with the same key go to the same partition, so the order id is a natural key here.
  - A consumer group with no committed offset starts according to auto.offset.reset; the default is latest, which skips everything already in the topic.
  - With enable.auto.commit off, call consumer.commit(message=…) after you have processed a message.
stretch_goals:
  - Run two copies of consumer.py at once in the same group and see the partitions shared between them (see "Scaling consumers and rebalancing").
  - Make the consumer write statuses to a file and survive a crash between processing and committing without double counting.
  - Add a schema for the event (see "Schemas and evolution").
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college canteen's ordering app records every change to an order — placed, paid, shipped or cancelled — as an
event. The billing and delivery teams want these events in Kafka so each service can read them at its own pace.
The first version of the pipeline "works on my machine", but in reality it loses events, lets them arrive out of
order, and its consumer reads almost nothing.

Fix the producer and the consumer. The fixes are small; understanding why each is needed is the point: when a
message really counts as sent, what decides its partition, and what a consumer group's committed offset means.

## Getting started

1. Copy the starter. Start a single-node Kafka as in "Events, topics and partitions" (or reuse your lab broker), create
   the topic with three partitions, and run the programs in a Python container with confluent-kafka 2.16.1:

   ```bash
   kafka-topics.sh --bootstrap-server kafka:9092 --create --topic orders --partitions 3 --replication-factor 1
   BOOTSTRAP=kafka:9092 python producer.py
   BOOTSTRAP=kafka:9092 python consumer.py
   ```

2. Count what is in the topic after the producer has run, and look at the keys and partitions with a console
   consumer (`--property print.key=true --property print.partition=true`).
3. Fix `producer.py`, then `consumer.py`, and run both twice.
4. Run the check, which starts its own broker on a private Docker network:

   ```bash
   bash check.sh path/to/your/project
   ```
