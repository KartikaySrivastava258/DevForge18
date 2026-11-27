# Assignment notifications

When a teacher publishes an assignment, the LMS writes an event to the topic `assignment-events`:

```json
{"event_id": "evt-0001", "student_email": "asha@college.example", "title": "Lab 3: joins", "due": "2026-02-10"}
```

`notifier.py` sends each student an email through the notification gateway: `POST $NOTIFY_URL/send` with
`{"event_id": …, "to": …, "subject": "New assignment: <title>"}`. The first version crashes on the first bad
event, gives up on the first gateway error, and emails students twice when the LMS sends an event twice.

Requirements (the broker address comes from `BOOTSTRAP`, the gateway from `NOTIFY_URL`):

1. **At most one email per event_id.** The LMS sometimes publishes the same event twice; send it once.
2. **Retries.** The gateway sometimes answers 5xx. Retry up to 3 attempts in total, waiting a little longer
   each time (for example 0.2 s, then 0.4 s).
3. **Dead-letter topic.** An event that cannot be processed — not valid JSON, a required field missing
   (`event_id`, `student_email`, `title`), or still failing after 3 attempts — goes to the topic
   `assignment-events.dlq` with its original value and a header `error` that says why. Then carry on.
4. **No losses on restart.** Commit an event's offset only after it was sent, deduplicated or dead-lettered.
   Started again, the notifier processes only new events.
5. When there are no new events for 5 seconds, stop and print
   `{"sent": <emails sent>, "dead_lettered": <events sent to the DLQ>, "duplicates": <events skipped as duplicates>}`.

The topics `assignment-events`, `assignment-events.dlq` and `assignment-events.sent` (compacted) already exist.
Remember the event_ids already sent in `assignment-events.sent` (key = event_id), so that a
duplicate arriving after a restart is also recognised.
