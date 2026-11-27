# Assignment reminders

Teachers at Northfield College (fictional) want every student who has not yet submitted an assignment to get one
reminder shortly before it is due — not ten, not none, and never about something already handed in. Build the
workflow that does it every morning.

## The rules (the check relies on them)

- **When**: a Schedule Trigger runs the workflow every day at 08:00 college time. Set the workflow's time zone
  (Workflow settings) to `Asia/Kolkata`.
- **Who**: for every assignment due **after now and at most 48 hours from now** (exactly 48 hours counts), every
  student with `"submitted": false`. Due dates carry their own offset (`+05:30` or `Z`): respect it.
- **Once**: before sending, read the reminder log; after sending, add what you sent. A reminder that is in the log
  is never sent again.
- **Failures**: an e-mail that fails must not stop the others. Send one alert listing the failed reminders; do not
  log them as sent (they are tried again next run).
- **Testing and backfills**: a webhook, `POST /webhook/assignment-reminders` with `{"now": "2026-12-01T08:00:00+05:30"}`,
  runs the same logic for that moment. It answers `200` with `{"sent": n, "failed": n, "skipped": n}`, or `400`
  with a reason when `now` is not an ISO 8601 date and time. (Without `now`, use the current time.)
- In a run started by the schedule, a Respond to Webhook node stops the run (seen with n8n 2.49.6) — only reach it when the webhook
  started the run.

## The services (stand-ins, on 127.0.0.1:9000 inside the n8n container)

`stubs/assignment-services.js`:

- `GET /assignments` → `{"assignments": [{"id", "course", "title", "due", "students": [{"name", "email", "submitted"}]}]}`
- `GET /reminders-sent` → `{"sent": [{"assignment_id", "email"}]}`; `POST /reminders-sent` with `{"entries": [...]}`
- `POST /mail` with `{"to", "subject", "text"}` → `202` (always `500` for `bounce@students.northfield.example`)
- `POST /alerts` with any JSON → `201`

Put the assignment's title in each e-mail's subject or text.

## Run it

Start n8n as in "Workflows, nodes and items" (`devforge-n8n`, port 5678), then the stand-in inside it:

```bash
docker cp stubs/assignment-services.js devforge-n8n:/tmp/
docker exec -d devforge-n8n node /tmp/assignment-services.js
```

Import `reminders.json`, build, publish, and run it for a pinned time with `curl -X POST
http://127.0.0.1:5678/webhook/assignment-reminders -H 'Content-Type: application/json' -d '{"now": "2026-12-01T08:00:00+05:30"}'`.
Restart the stand-in to empty its reminder log. Export back into `reminders.json` and run `bash check.sh .`.
