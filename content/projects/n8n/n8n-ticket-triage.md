---
id: n8n-ticket-triage
track: n8n
title: Support ticket triage automation
level: advanced
estimated_hours: 9
prerequisites: [n8n-human-approval-steps, n8n-self-hosting-securely, n8n-ai-agents-and-risks]
related_tracks: [langchain-llamaindex]
user_stories:
  - As a support lead, I want every ticket sorted into the right queue within seconds so that billing, technical and account problems reach the people who can solve them.
  - As an accounts manager, I want no refund paid unless a person other than the requester approved it so that a convincing ticket or a confused model cannot move money.
  - As a maintainer of the automation, I want no API key in the workflow file so that exporting it, sharing it or committing it to Git leaks nothing.
acceptance_criteria:
  - triage.json contains no secrets — every helpdesk call uses a Header Auth credential and the model node an OpenAI credential, referenced by id and name.
  - The workflow imports and publishes with the check's own credentials, and its webhook listens at POST /webhook/support-ticket.
  - A billing ticket gets 202 with its category and is assigned to the billing queue, authenticated by the stored credential; technical tickets go to it-support and account tickets to accounts.
  - Tickets without a valid sender, ticket id or subject get 400 and reach neither the model nor the helpdesk.
  - An injected category, a category outside the list and a failing model all send the ticket to the triage-desk queue, never towards a refund.
  - A refund ticket posts an approval request with the execution's resume URL and pays nothing until another person approves; then the refund records who approved it.
  - A declined refund, or one "approved" by the requester, is not paid and the outcome is noted on the ticket.
rubric:
  - { criterion: "Treating model output as untrusted", excellent: "Only an exact match from an allow-list is used; everything else, including errors and timeouts, goes to a person; the README shows an injected ticket and what happened to it.", good: "Unknown categories go to a person.", needs_work: "The model's text is used as a queue name or a decision." }
  - { criterion: "Human approval", excellent: "Refunds pause in a Wait node with a time limit and an escalation, the approver's identity is checked against the requester, and every outcome is recorded on the ticket.", good: "Refunds wait for an approval.", needs_work: "Refunds are paid automatically, or anyone holding the link can approve their own." }
  - { criterion: "Secrets and credentials", excellent: "Credentials are referenced, not embedded; the README says where the real key lives, who can read it, and how to rotate it; the exported file was checked before committing.", good: "No key in the file.", needs_work: "A key typed into a header or a Code node." }
  - { criterion: "Robustness", excellent: "Validation runs before any paid model call, every external call has a deliberate failure path, and the requester always gets an answer.", good: "Bad input is rejected and failures do not crash the run.", needs_work: "A failing model or helpdesk leaves tickets unassigned and nobody knows." }
hints:
  - Build the Agent exactly as in "AI agents and their risks" — Agent node version 2.2 with an OpenAI Chat Model whose credential has a custom base URL — but with no tools; this agent only classifies.
  - Put the allow-list in a Code node after the Agent. Compare the trimmed, lower-cased output with the four categories; anything else becomes needs-human.
  - 'Give the Agent node an error output (onError: continueErrorOutput, as for the HTTP Request node in "Validating input and handling errors") so a model failure still ends in a queue.'
  - Answer the webhook (202) before the Wait node, as in "Human approval steps" — a request cannot stay open for a day — and send $execution.resumeUrl in the approval request.
  - Export the workflow and search the file for your key before running the check. The check creates credentials with the ids your file names and a key only it knows, so a hard-coded key gets 401.
stretch_goals:
  - Escalate a refund that nobody decided within 24 hours to the support lead, and test it with a short limit.
  - Add a second opinion for refunds above a threshold (two different approvers).
  - Run "n8n audit" on your instance and act on what it reports, as in "Self-hosting n8n securely".
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Northfield College's IT and accounts office (fictional) receives every support ticket — fee problems, portal
errors, forgotten passwords, refund requests — in one inbox. You will automate the first step: classify each
ticket with a language model, assign it to the right queue in the helpdesk, and handle refunds through a human
approval step, because refunds move money.

Three things make this an advanced project. The model's answer is **untrusted**: tickets are written by anyone,
and one can contain an instruction aimed at the model — the stand-in model in this project obeys such lines, as
the one in "AI agents and their risks" did. Refunds need a **person**, and not the person who asked. And the
starter has the helpdesk API key typed into a node, so the workflow file itself is a leak; the finished file
must reference **credentials** instead.

The helpdesk API and the OpenAI-compatible model are stand-ins that run inside the n8n container
(`stubs/helpdesk-and-model.js`). The check reads your exported file for secrets, creates the credentials it
refers to with a key only the check knows, then sends tickets — ordinary, invalid, injected, and refunds it
approves, declines and "approves" as the requester — and inspects what reached the helpdesk.

## Getting started

1. Start n8n as in "Workflows, nodes and items", run the stand-ins inside its container, and create the two
   credentials (see the starter's README). Import `triage.json`.
2. Replace the hard-coded header with the Header Auth credential first, then add validation, the classifier and
   the allow-list, the routing, and finally the approval branch. Try every kind of ticket with `curl`.
3. Export the workflow into `triage.json`, check it for secrets, and run the check (it needs Docker and removes
   its container):

   ```bash
   bash check.sh path/to/your/project
   ```
