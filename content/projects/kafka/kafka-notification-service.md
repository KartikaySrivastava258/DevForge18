---
id: kafka-notification-service
track: kafka
title: Event-driven notification service
level: advanced
estimated_hours: 8
prerequisites: [kafka-delivery-guarantees-and-idempotence, kafka-offsets-retention-and-replay, kafka-outbox-pattern]
related_tracks: [n8n]
user_stories:
  - As a student, I want exactly one email per new assignment so that notifications stay useful instead of becoming spam.
  - As an operator, I want one bad event to be set aside with a reason instead of stopping the whole service so that everyone else still gets their emails.
  - As a developer, I want temporary gateway errors retried with a growing wait so that a short outage does not lose notifications or flood the gateway.
acceptance_criteria:
  - Every valid event is emailed exactly once; a duplicate event_id is skipped, also when it arrives after a restart.
  - A gateway error (5xx) is retried up to 3 attempts in total with a growing wait.
  - Invalid JSON, a missing required field, or a send still failing after 3 attempts goes to assignment-events.dlq with the original value and an error header, and processing continues.
  - Offsets are committed only after an event was sent, skipped or dead-lettered; a second run processes only new events.
  - notifier.py prints its counts of sent, dead-lettered and duplicate events.
rubric:
  - { criterion: "Delivery semantics", excellent: "Explains precisely where duplicates can still occur (a crash after the email but before recording it) and why at-least-once plus deduplication is the practical choice; records the send before committing.", good: "No duplicates or losses in the tested scenarios.", needs_work: "Auto-commit, or deduplication only in memory." }
  - { criterion: "Failure handling", excellent: "Distinguishes retryable (5xx, network) from permanent errors (4xx, bad data), caps attempts, backs off, and the DLQ message carries enough context to replay it.", good: "Retries and DLQ as specified.", needs_work: "Crashes on the first bad event, or retries forever." }
  - { criterion: "Operability", excellent: "Counts and logs make the service observable; the README explains how to inspect and replay the DLQ, and what an alert on DLQ growth would look like.", good: "Summary counts are correct.", needs_work: "Silent failures." }
hints:
  - Handle the three kinds of trouble separately — bad data (dead-letter at once), temporary gateway errors (retry), duplicates (skip) — and test each with a small hand-made event.
  - Retrying a 5xx makes sense; retrying a 400 does not. Wait 0.2 s, then 0.4 s between attempts.
  - Kafka headers carry metadata next to the value; producer.produce(…, headers=[("error", b"…")]) keeps the original value untouched for a later replay.
  - Deduplication must survive restarts, so keep the sent event_ids in Kafka itself — the compacted topic assignment-events.sent — and read it to the end on start, as in "Offsets, retention and replay in depth".
  - Order matters for safety — send, record the event_id, flush, then commit the offset. Ask yourself what happens if the program dies between any two of those steps.
stretch_goals:
  - Add a replay tool that reads assignment-events.dlq and re-publishes chosen events after a fix.
  - Replace the emails with an outbox table written in the same database transaction as the assignment (see "The outbox pattern and event-driven design").
  - Expose the counts as Prometheus metrics and alert when the DLQ grows.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

When a teacher publishes an assignment, the college's learning platform writes an event to Kafka, and a small
service emails the student. The first version does exactly that — and nothing more. It crashes on the first event
it cannot parse, gives up on the first gateway error, and emails students twice whenever the platform publishes
the same event twice (which it does, after its own retries).

Make the notifier reliable: one email per event, retries with back-off for temporary gateway errors, a dead-letter
topic for anything that cannot be processed, and offsets committed only after the work is really done —
including deduplication that survives a restart.

The check runs your notifier against a stub gateway that fails on purpose for some recipients, feeds it valid,
duplicate, malformed and undeliverable events, restarts it, and inspects the gateway's log and the topics.

## Getting started

1. Copy the starter. Run a broker (as in the lessons), create the three topics, and run a small gateway that
   prints what it receives (the check's own stub is in `check.sh`).

   ```bash
   kafka-topics.sh --bootstrap-server kafka:9092 --create --topic assignment-events --partitions 3 --replication-factor 1
   kafka-topics.sh --bootstrap-server kafka:9092 --create --topic assignment-events.dlq --partitions 1 --replication-factor 1
   kafka-topics.sh --bootstrap-server kafka:9092 --create --topic assignment-events.sent --partitions 1 --replication-factor 1 --config cleanup.policy=compact
   ```

2. Publish a few events, including a duplicate and one that is not JSON, and run
   `BOOTSTRAP=kafka:9092 NOTIFY_URL=http://gateway:8099 python notifier.py`.
3. Fix one failure mode at a time, then run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
