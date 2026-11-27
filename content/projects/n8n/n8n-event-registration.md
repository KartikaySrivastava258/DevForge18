---
id: n8n-event-registration
track: n8n
title: Student event registration automation
level: beginner
estimated_hours: 5
prerequisites: [n8n-workflows-nodes-and-items, n8n-webhooks-and-expressions, n8n-validation-and-errors]
related_tracks: [postman, postgresql]
user_stories:
  - As a student, I want an immediate confirmation e-mail when I register for an event so that I know my registration arrived.
  - As a student-council organiser, I want each student registered at most once per event so that the head count and the certificates are right.
  - As a student-council organiser, I want incomplete or mistyped registrations rejected with a reason so that the student can fix them at once instead of me chasing them later.
acceptance_criteria:
  - The workflow imports and publishes, and its webhook listens at POST /webhook/event-registration.
  - A valid registration gets 201 and is saved once with trimmed fields, the e-mail and event in lower case and the roll number in capitals.
  - One confirmation e-mail goes to the student's normalised address and mentions their name and the event.
  - A registration without a name or roll number, with an invalid e-mail address or with an event that is not open gets 400 with a reason, and no service is called.
  - Registering the same e-mail for the same event again — in any capitalisation, with spaces — gets 409, with nothing saved or sent twice; the same student can register for another event.
  - When the registration service fails, the student gets 503 with a message and no confirmation e-mail is sent.
rubric:
  - { criterion: "Validation", excellent: "All input is normalised in one place before it is checked or used, every rule gives the student a specific reason, and invalid data never reaches another system.", good: "Invalid registrations are rejected with 400.", needs_work: "Bad data is saved, or every error gives the same vague message." }
  - { criterion: "Deduplication", excellent: "The lookup uses the normalised e-mail and event, the README explains the remaining race (two identical requests at the same moment) and how a unique constraint in the store would close it.", good: "Repeat registrations get 409.", needs_work: "Duplicates are saved, or detection depends on how the student typed their address." }
  - { criterion: "Error handling", excellent: "Each external call has an error output with a deliberate answer; a failed e-mail after a successful save is reported honestly rather than as a failure or a full success.", good: "A failing service gives a clear 5xx instead of a crashed execution.", needs_work: "A failing service leaves the student waiting or with \"Error in workflow\"." }
  - { criterion: "Readability", excellent: "Nodes are named for what they do, expressions are short, and someone new can follow the flow on the canvas without opening every node.", good: "The workflow is understandable with some effort.", needs_work: "Default node names (HTTP Request1, If2) and logic hidden in long expressions." }
hints:
  - Put all clean-up and checks in one Code node that returns the normalised fields and a list of errors; an If node on the number of errors then decides the branch.
  - 'The registrations service answers {"count": n, …}. An If node on count > 0 is all the duplicate check needs.'
  - 'Give the HTTP Request node an error output (onError: continueErrorOutput in the file), as in "Validating input and handling errors", and connect it to a Respond to Webhook node with code 503.'
  - After the lookup the item is the service's reply, not the form. Refer back to the cleaned data with $('Validate and normalise').item.json — whatever you named that node.
stretch_goals:
  - Close the seats of an event when it is full, with a waiting list.
  - Report a failed confirmation e-mail honestly (the registration is saved; the e-mail is retried by a second, scheduled workflow).
  - Protect the webhook with Header Auth so that only the college's form can call it.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Northfield College's student council (a fictional council) runs a hackathon, a robotics workshop and a career fair
each term. Registrations arrive from a web form and are copied into a spreadsheet by hand: names have stray
spaces, the same student appears three times with three spellings of their e-mail address, nobody gets a
confirmation, and when the spreadsheet is locked, registrations are simply lost.

You will build the n8n workflow behind the form. It validates and normalises each registration, rejects bad ones
with a reason, refuses duplicates, saves the rest in the council's registration store, sends a confirmation
e-mail, and gives a clear answer when the store is down. The store and the mail service are small stand-ins that
run inside the n8n container (`stubs/registration-services.js`), so you can see exactly what your workflow sent.

The check imports your exported workflow into a throwaway n8n, sends registrations — valid, invalid, repeated and
while the store is failing — and compares the HTTP answers and what the services received with the contract in
the starter's README.

## Getting started

1. Start n8n as in "Workflows, nodes and items" and run the stand-in services inside its container (see the
   starter's README). Import `registration.json` in the editor.
2. Build the workflow step by step: validation and the 400 answer first, then the duplicate lookup, the save, the
   e-mail and the error branch. Publish it and try each case with `curl`.
3. Export the workflow into `registration.json` and run the check (it needs Docker and removes its container):

   ```bash
   bash check.sh path/to/your/project
   ```
