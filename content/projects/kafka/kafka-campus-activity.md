---
id: kafka-campus-activity
track: kafka
title: Live campus activity stream
level: intermediate
estimated_hours: 6
prerequisites: [kafka-consumer-groups-and-offsets, kafka-scaling-consumers, kafka-offsets-retention-and-replay]
related_tracks: []
user_stories:
  - As a security officer, I want each building's live occupancy so that I know where people are during an evacuation drill.
  - As an operator, I want to run more copies of the counting program when the stream gets busy so that the counts keep up without changing the code.
  - As a dashboard developer, I want a topic that always holds every building's latest number so that a dashboard started at any time shows the current state at once.
acceptance_criteria:
  - topics.sh creates campus-activity with 6 partitions and building-occupancy with cleanup.policy=compact.
  - Two copies of occupancy.py running at the same time share the partitions and together process every swipe exactly once.
  - building-occupancy, keyed by building, ends with every building's correct occupancy.
  - A copy started later processes only the new swipes and continues from the stored occupancy, so the numbers stay correct after a restart.
rubric:
  - { criterion: "Partitioning and keys", excellent: "Explains why the building is the key for both topics (ordering per building; compaction per building), and what changes if a building gets too busy for one partition.", good: "Correct keys and partition count.", needs_work: "No keys, so ordering and compaction both break." }
  - { criterion: "Consumer group behaviour", excellent: "Commits after the occupancy value is stored, handles a rebalance without losing or double-counting, and the README shows the group's assignment while two copies run.", good: "Work is shared and nothing is processed twice.", needs_work: "Copies in different groups (everyone reads everything) or auto-commit before processing." }
  - { criterion: "State from a compacted topic", excellent: "Restores state by reading the compacted topic to its end before consuming, explains what compaction does and does not guarantee (old values may still be there for a while).", good: "Restores the latest values on start.", needs_work: "Starts from zero after every restart." }
hints:
  - Partitions are the unit of parallelism in a consumer group — with one partition, the second copy has nothing to do.
  - Give both topics the building as the key. On campus-activity it keeps one building's swipes in order in one partition; on building-occupancy it is what compaction keeps the latest value of.
  - cleanup.policy=compact is a topic configuration; set it when creating the topic (--config cleanup.policy=compact).
  - To restore, read building-occupancy from the beginning with assign() (not subscribe) until you reach the end offsets you got from get_watermark_offsets(), keeping the last value per key.
  - Store the new occupancy value, then commit the swipe's offset — in that order, so a crash can repeat work but never lose it.
stretch_goals:
  - Run three copies and stop one in the middle; watch the rebalance in kafka-consumer-groups.sh --describe.
  - Add a maximum capacity per building and publish an alert event when it is exceeded.
  - Make the counts exactly-once with transactions (see "Delivery guarantees and idempotent producers").
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Every badge swipe at a building door on campus is an event on the topic `campus-activity`. The security office
wants each building's live occupancy — and because the stream is busy at the start of every lecture, the counting
program must be able to run as several copies that share the work.

The starter creates both topics with a single partition and no compaction, counts every swipe as a person
entering, and publishes the counts without keys. Rebuild it so that copies share the stream through a consumer
group, the counts are right, the latest occupancy of every building is kept in a compacted topic, and a restarted
copy carries on where the group stopped.

## Getting started

1. Copy the starter. Start a broker as in the lessons and run `topics.sh` inside its container (where
   `kafka-topics.sh` is on the PATH):

   ```bash
   docker cp topics.sh kafka:/tmp/ && docker exec -e BOOTSTRAP=localhost:9092 -e PATH="/opt/kafka/bin:$PATH" kafka bash /tmp/topics.sh
   ```

2. Produce some swipes keyed by building (a short Python loop with confluent-kafka 2.16.1), then run two copies
   of `occupancy.py` at the same time and compare what each processed.
3. Look at the group while both run: `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group occupancy`.
4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```

   It runs your `topics.sh`, produces 300 swipes, runs two copies side by side, checks the occupancy topic, then
   produces 60 more swipes and runs one copy again.
