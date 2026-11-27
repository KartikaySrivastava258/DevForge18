---
id: redis-notification-stream
track: redis
title: Real-time notification stream
level: advanced
estimated_hours: 8
prerequisites: [redis-data-structures, redis-pubsub-and-streams, redis-persistence-and-replication]
related_tracks: [kafka]
user_stories:
  - As a student, I want every timetable change to reach me even when a notification worker was restarting so that I do not miss a moved exam.
  - As a student, I want each notification once per channel so that I do not get the same email three times.
  - As an operator of the service, I want notifications that keep failing set aside with their details so that one broken message does not block or loop for ever and can be inspected later.
  - As an operator of the service, I want the stream to stay a bounded size so that Redis memory does not grow without limit.
acceptance_criteria:
  - setup_groups creates the consumer groups email and push on the stream notifications and succeeds when run again.
  - publish_notification stores the fields user and text and prints the new entry's ID; with STREAM_MAXLEN=50, publishing 300 entries trims the stream to about 50.
  - Both groups receive every notification in order, and successfully handled entries are acknowledged.
  - Two consumers in one group share the entries, so no entry is handled twice within a group.
  - An entry whose handler fails stays pending; recover leaves it alone while it is younger than the minimum idle time, then hands it to another consumer and acknowledges it once its handler succeeds.
  - After DEAD_AFTER failed deliveries an entry is copied to notifications:dead with original_id, group, user and text, and acknowledged.
  - consume with nothing new returns 0 without calling the handler.
rubric:
  - { criterion: "Delivery guarantees", excellent: "Acknowledges only after the handler succeeded, explains at-least-once delivery and why handlers should be idempotent (a crash between send and XACK resends), and never uses NOACK.", good: "No entry is lost when a handler fails or a worker stops.", needs_work: "Entries are acknowledged on delivery, so a failed send is lost — no better than Pub/Sub." }
  - { criterion: "Recovery and dead letters", excellent: "XAUTOCLAIM with a sensible idle time in production (and a comment on choosing it), delivery counts from XPENDING, and a dead-letter entry that keeps everything needed to replay it.", good: "Stuck entries are recovered and poison entries are parked after a few attempts.", needs_work: "Pending entries are never recovered, or a failing entry is retried for ever." }
  - { criterion: "Parsing and robustness", excellent: "Parses redis-cli output by its shape (not by line position alone), handles an empty read, and documents its limits (single-line texts).", good: "Works for the documented inputs.", needs_work: "Breaks on texts with spaces or when there is nothing to read." }
  - { criterion: "Operations", excellent: "Approximate trimming with MAXLEN ~, a note on how long entries must be kept and how persistence settings affect what survives a Redis restart.", good: "The stream is trimmed.", needs_work: "The stream grows without limit." }
hints:
  - Follow the lesson "Pub/Sub and streams" step by step in redis-cli first — XGROUP CREATE, XREADGROUP with >, XACK, XPENDING, XAUTOCLAIM — and look at each answer before writing shell code.
  - XGROUP CREATE … MKSTREAM fails with BUSYGROUP when the group exists. For setup_groups that is success, not an error.
  - "redis-cli --raw prints nested replies as plain lines: for XREADGROUP the stream name, then for each entry its ID and the field names and values. XAUTOCLAIM starts with a cursor that also looks like an ID (0-0), so recognise an entry by its shape: an ID followed by user, value, text, value."
  - XPENDING notifications email <id> <id> 1 returns the entry's ID, consumer, idle time and number of deliveries. XAUTOCLAIM counts as a delivery.
  - Acknowledge an entry only after its handler returned 0. Ask yourself what happens if the worker is killed between the two.
stretch_goals:
  - Add a replay_dead <group> command that publishes dead-lettered notifications again after the provider is fixed, without losing their original IDs.
  - Run a consumer as a long-lived loop with XREADGROUP … BLOCK 5000, and call recover from it every minute with a 60-second idle time.
  - Compare this design with Kafka (see the Kafka track) — consumer groups, offsets, retention — and write down when you would switch.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

When results, timetable changes or fee reminders are published, students get an email and a push notification.
The current service uses Redis **Pub/Sub**: two workers are subscribed, and whatever is published while a worker
restarts is lost — last month a timetable change reached nobody. *Pub/Sub and streams* explains why: Pub/Sub
delivers at most once and stores nothing.

You will move the service to a **stream with consumer groups**. Each delivery channel is a group, so each gets
every notification; workers in a group share the load; an entry is acknowledged only after it was really sent;
entries a crashed worker left behind are **recovered** by another; and an entry that keeps failing is moved to a
**dead-letter** stream instead of looping for ever. The stream is trimmed so that memory stays bounded.

The starter's `notify.sh` publishes with Pub/Sub and has stubs for the rest. The README in the starter is the
specification. Remember, from *Persistence and replication*, that a stream is only as durable as the Redis
server's persistence settings — the check does not test that, but your README should say what you would choose.

## Getting started

1. Start a throwaway Redis as in *Keys, values and data structures*:

   ```bash
   docker run --name devforge-redis -p 127.0.0.1:6379:6379 -d redis:7
   ```

   You also need `redis-cli` on your computer, or work inside the container (`docker cp` the folder in, then
   `docker exec -it devforge-redis bash`).
2. Copy the starter into a folder. Try the commands from the lesson in `redis-cli` on a stream of your own.
3. Implement the functions one at a time and drive them by hand with two small handlers:

   ```bash
   source notify.sh
   sent() { echo "sent $1 to $2: $3"; }
   broken() { echo "provider down for $1"; return 1; }
   setup_groups
   publish_notification S1024 "Your DB201 result is out"
   consume email mailer-1 sent
   redis-cli XPENDING notifications email
   ```

4. Run the check. It needs Docker and starts its own Redis container:

   ```bash
   bash check.sh path/to/your/project
   ```

5. When you are done: `docker rm -f -v devforge-redis`.
