---
id: n8n-assignment-reminders
track: n8n
title: Assignment reminder workflow
level: intermediate
estimated_hours: 7
prerequisites: [n8n-webhooks-and-expressions, n8n-validation-and-errors, n8n-calling-apis-and-mapping]
related_tracks: [airflow]
user_stories:
  - As a student, I want one reminder before an assignment is due, if I have not submitted it yet, so that I do not miss a deadline I forgot.
  - As a teacher, I want students who already submitted, and assignments that are overdue or far away, left out so that reminders stay credible and nobody ignores them.
  - As a course coordinator, I want to be alerted when a reminder could not be delivered so that I can contact that student another way.
acceptance_criteria:
  - The workflow imports and publishes, and its webhook listens at POST /webhook/assignment-reminders.
  - A Schedule Trigger runs the same reminder logic every day at 08:00 in the workflow time zone Asia/Kolkata.
  - Run for 1 December 2026, 08:00 (+05:30), exactly the four due reminders are sent — due after now and at most 48 hours later, not submitted — and each e-mail names its assignment.
  - A failing e-mail address does not stop the others; the reply says sent 4 and failed 1, and one alert names the failed address.
  - Running again for the same time sends no reminder twice, and the next morning only the newly due reminder is sent.
  - A "now" that is not an ISO 8601 date and time gets 400 with a reason, and nothing is sent.
rubric:
  - { criterion: "Time logic", excellent: "Times are parsed with their offsets, the window's boundaries are deliberate and tested (exactly 48 hours, one minute more, already overdue), and \"now\" can be pinned for tests and backfills.", good: "The right reminders are sent for the documented cases.", needs_work: "Dates compared as strings, the server's time zone assumed, or no way to test without waiting for 08:00." }
  - { criterion: "Idempotency", excellent: "A durable reminder log is read before and written after sending, failed sends are retried next run rather than logged, and the README explains what happens if the workflow stops between the e-mail and the log entry.", good: "Re-running does not resend.", needs_work: "Every run e-mails everyone again." }
  - { criterion: "Partial failure", excellent: "One bad address affects only its own reminder; the coordinator gets one alert with every failure; the run's reply counts sent, failed and skipped.", good: "Failures are reported.", needs_work: "One failed e-mail stops the run, or failures disappear silently." }
  - { criterion: "Workflow design", excellent: "One code path serves both the schedule and the webhook, logic is in small named nodes, and the schedule path never reaches a Respond to Webhook node.", good: "Both triggers work.", needs_work: "Two copies of the logic that will drift apart." }
hints:
  - Start both triggers into one Code node that decides "now" — the webhook's body.now if given, otherwise DateTime.now() in Asia/Kolkata — and use only that value afterwards.
  - 'Luxon''s DateTime.fromISO(text, { setZone: true }) keeps each date''s offset; compare DateTime objects, never strings. The window is due > now and due <= now.plus({ hours: 48 }).'
  - 'Let the mail node continue on error with its regular output (onError: continueRegularOutput in the file) — failed items then carry an error field — and count successes and failures in a Code node that runs once for all items.'
  - In a run started by the schedule, a Respond to Webhook node stops the run (we saw this with n8n 2.49.6). Remember in your first Code node whether the item came from the webhook (it has headers), and check that before replying.
stretch_goals:
  - Send a second, sterner reminder 6 hours before the deadline — still at most one of each kind.
  - Let each course choose its own window (24 or 48 hours) from the assignment data.
  - Compare this workflow with an Airflow DAG doing the same job (see the Airflow track) — which is easier to test, to monitor and to change?
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Teachers at Northfield College (a fictional college) post assignments with deadlines in the college's assignment
service. Students forget them; teachers send reminders by hand, to everyone, at random times — including to
students who submitted days ago. You will build the n8n workflow that sends one reminder, every morning at 08:00,
to each student who has not submitted an assignment due within the next 48 hours.

Scheduled workflows are hard to test: you cannot wait for tomorrow morning, and "today" changes every day. So
the same logic is also reachable through a webhook that takes a pinned "now". That makes the time window, the
"never twice" rule and the failure handling testable — by you, and by the check, which runs the workflow for
1 and 2 December 2026 against stand-in services (`stubs/assignment-services.js`): assignments due exactly 48
hours later, 48 hours and one minute later, yesterday, and with a UTC timestamp, plus one address whose mailbox
always fails.

The daily schedule itself cannot be waited for in a check; it is read from the exported file (a Schedule Trigger
at 08:00, time zone Asia/Kolkata, connected to the reminder logic).

## Getting started

1. Start n8n as in "Workflows, nodes and items" and run the stand-in services inside its container (see the
   starter's README). Import `reminders.json`: it has both triggers and fetches the assignments, nothing more.
2. Build the logic one rule at a time, running it for a pinned "now" with `curl` after each change. Restart the
   stand-in to empty its reminder log.
3. Export the workflow into `reminders.json` and run the check (it needs Docker and removes its container):

   ```bash
   bash check.sh path/to/your/project
   ```
