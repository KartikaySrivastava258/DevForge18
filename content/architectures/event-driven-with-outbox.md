---
id: event-driven-with-outbox
title: Event-driven services with a transactional outbox
summary: A service writes its business change and an outbox row in one PostgreSQL transaction, a relay publishes the outbox to Kafka, and independent consumers each read the events in their own consumer group and handle redelivered events safely.
problem: A service must change its database and tell other services about it, but it cannot write to PostgreSQL and Kafka in one transaction — a crash between the two either loses the event or announces a change that never happened.
tracks: [postgresql, kafka, redis, docker]
diagram: media:architecture/event-driven-with-outbox.svg
components:
  - { name: Order service, role: "The only writer of orders. It inserts the order and an outbox row (event ID, order ID, payload) in one database transaction and never publishes to Kafka itself." }
  - { name: PostgreSQL, track: postgresql, role: "Holds the business tables and the outbox table; because both rows are written in one transaction, the order and its event exist together or not at all." }
  - { name: Outbox relay, role: "Reads unpublished outbox rows in order, publishes them keyed by order ID, and marks them published only after the publish is confirmed." }
  - { name: Kafka, track: kafka, role: "Stores the events in partitioned topics. Events with the same key go to the same partition and stay in order; events stay readable after they are consumed, until retention removes them." }
  - { name: Consumers, role: "Payment, shipping and e-mail each read the topic in their own consumer group, skip event IDs they have already handled, retry temporary failures and park permanent ones in a dead-letter topic." }
  - { name: Redis, track: redis, role: "An optional performance layer, such as a cache for read-heavy data. No event or guarantee depends on it: the system must stay correct, if slower, without it." }
  - { name: Containers, track: docker, role: "Every service, the broker and the database run as containers, started together with Docker Compose during development." }
flow:
  - A request to place an order reaches the order service, which inserts the order and its outbox row in one PostgreSQL transaction and answers the caller.
  - The relay reads unpublished outbox rows in order and publishes each one to a Kafka topic with the order ID as key, so one order's events share a partition.
  - Once the publish is confirmed, the relay marks the rows as published; if it crashes before that, the same rows are published again on its next run.
  - Each consumer group reads the topic independently, skips event IDs it has already handled, does its work and only then commits its offset.
  - A temporary failure goes to a retry topic with an attempt count and a limit; a permanent failure goes to a dead-letter topic with a reason, so the consumer keeps moving.
trade_offs:
  - { choice: "Outbox row in the same transaction as the business change", gain: "The event exists if and only if the change committed, without a distributed transaction across the database and the broker.", cost: "Events are published at least once and a little after the commit; published outbox rows must be deleted or archived on a schedule." }
  - { choice: "At-least-once delivery with idempotent consumers", gain: "A crash of the relay or of a consumer loses nothing; the work is simply repeated.", cost: "Every consumer must deduplicate by event ID or make its effect safe to repeat — including e-mails and HTTP calls, which Kafka transactions do not cover." }
  - { choice: "Partitioning by order ID", gain: "All events of one order are read in the order they were written.", cost: "There is no order across different orders; the partition count caps how many consumers in a group can share the work, and adding partitions later moves keys." }
failure_modes:
  - { failure: "The relay crashes after publishing but before marking the rows", effect: "Consumers receive the same events a second time.", mitigation: "Create the event ID together with the outbox row, never at publish time, so consumers can recognise the repeat and skip it." }
  - { failure: "A consumer crashes after doing the work but before committing its offset", effect: "The next member of the group reads that event again and may repeat the effect.", mitigation: "Record handled event IDs (for example under a unique constraint) or make the effect idempotent; commit only after processing, not on an auto-commit timer." }
  - { failure: "A poison event fails on every attempt", effect: "Retrying it forever blocks the partition and consumer lag keeps growing.", mitigation: "Send permanent failures straight to a dead-letter topic with a reason, cap retries for temporary ones, and monitor lag." }
  - { failure: "A producer changes the event's shape incompatibly", effect: "Consumers that were deployed earlier can no longer read new events.", mitigation: "Keep schemas in a registry with a deliberate compatibility mode (BACKWARD or a transitive mode) and register them through CI, so the build fails before deployment." }
alternatives:
  - { instead_of: "A polling relay", consider: "Change data capture with Debezium", when: "You want no extra query load on the database and commit order preserved, and can run Kafka Connect." }
  - { instead_of: "Kafka", consider: "Redis Streams", when: "One Redis already runs and events do not need to be kept for days, replayed by many teams or partitioned across machines." }
  - { instead_of: "Kafka", consider: "RabbitMQ", when: "You need task queues with flexible routing, per-message acknowledgements and work distribution rather than a long-retained, replayable event log." }
decision_prompts:
  - Which events do consumers need, and what must each payload contain so that no consumer has to call the order service back?
  - Which key do you partition by, and which events must stay in order relative to each other?
  - How does each consumer recognise an event it has already handled, and where is that record kept?
  - Which failures are temporary and which are permanent, and who looks at the dead-letter topic and how often?
  - How long do you keep published outbox rows and Kafka events, and what does that allow you to replay?
learn_more:
  - { kind: lesson, id: kafka-outbox-pattern }
  - { kind: lesson, id: kafka-delivery-guarantees-and-idempotence }
  - { kind: lesson, id: kafka-consumer-groups-and-offsets }
  - { kind: lab, id: kafka-retry-and-dead-letter }
  - { kind: project, id: kafka-order-pipeline }
  - { kind: lesson, id: postgresql-transactions-and-acid }
capstones: [capstone-a]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when a change in one service must reliably start work in others that can happen after the caller has
its answer: an order that must be paid, shipped and confirmed by e-mail; a registration that must reach several
systems. The writing service stays fast and simple, and each consumer can fail, be redeployed or catch up on its own.

It is more than you need when one service owns all the work and the caller waits for the result anyway — then the
web application with a cache is enough. It is also not a way to get an answer from another service inside a request:
consumers run later, so anything the caller must see immediately has to be decided by the writing service itself.

## How it works

The outbox turns one impossible step — "commit to the database and publish to Kafka, atomically" — into two possible
ones. The service writes the order and the event into the same database in one transaction, so they cannot disagree.
A separate relay then copies outbox rows to Kafka and may repeat itself after a crash, but it can never publish an
event for an order that was rolled back, and it never forgets one that committed.

Repeats are therefore expected, and the second idea handles them: every event carries an ID created with the outbox
row, and every consumer remembers which IDs it has handled (or makes its effect safe to repeat). Kafka keeps events
in order per key and keeps them after they are read, so each consumer group moves at its own pace and can be rewound
to process events again.
