# College notifications — from Pub/Sub to a stream

When results, timetable changes or fee reminders are published, students get an email and a push notification.
Today `publish_notification` uses Redis Pub/Sub, and two workers — email and push — are subscribed. Every time a
worker restarts (a deployment, a crash, a slow email provider), notifications published in the meantime are
simply lost; last month a timetable change never reached anyone. Move the service to a **Redis stream with
consumer groups**, so nothing published is lost and nothing is sent twice.

## The file

`notify.sh` is **your work**. Keep the four function names and their arguments; you may add helpers.

## What the service must do

1. **`setup_groups`** creates two consumer groups, `email` and `push`, on the stream `notifications`, creating
   the stream if needed. Running it again must succeed and change nothing.
2. **`publish_notification <user> <text>`** appends an entry with the fields `user` and `text` and prints the
   entry's ID. It keeps the stream from growing without limit: about `STREAM_MAXLEN` entries (default 10000).
3. **`consume <group> <consumer> <handler>`** takes up to `BATCH` (default 10) notifications that nobody in the
   group has received yet, and calls `<handler> <id> <user> <text>` for each. When the handler returns 0, the
   entry is acknowledged. When it fails, the entry stays pending for that consumer. With nothing new, `consume`
   returns 0 straight away.
   - Each group gets **every** notification (email and push both send it).
   - Consumers in the **same** group share them: no notification is handled twice in one group.
4. **`recover <group> <consumer> <min idle ms> <handler>`** takes over the group's entries that have been pending
   for at least `<min idle ms>` — whichever consumer they were delivered to — and handles them like `consume`.
5. **Dead letters.** An entry whose handler has failed on `DEAD_AFTER` deliveries (default 3) is copied to the
   stream `notifications:dead` with the fields `original_id`, `group`, `user` and `text`, and acknowledged, so it
   stops being retried.

Texts are single lines. Each call may run in a new process, so everything the service remembers must be in Redis.
