---
id: capstone-g
letter: G
title: No-code / low-code campus operations automation
summary: Self-hosted n8n workflows that run real campus chores — event registration, assignment reminders, support triage — with validation, deduplication, human approval for risky steps, an audit trail, tested APIs and traces.
level: intermediate
estimated_hours: 45
tracks: [postman, n8n, postgresql, redis, docker, opentelemetry]
architecture: media:capstones/capstone-g-architecture.svg
user_stories:
  - As an event coordinator, I want registrations validated and confirmed automatically so that I stop copying form responses into spreadsheets.
  - As a student, I want one reminder before an assignment is due, not five, so that reminders stay useful.
  - As a support lead, I want incoming tickets triaged and refunds approved by a person so that urgent issues are seen first and money never moves without a human decision.
  - As an auditor, I want every automated action recorded with who or what approved it so that I can answer "why did this happen?" later.
milestones:
  - id: foundations
    title: A self-hosted, reproducible automation stack
    goal: Run n8n with PostgreSQL and Redis in Docker Compose, with credentials stored in n8n's credential store, an encryption key kept outside the workflows, and workflows exported to Git.
    deliverables:
      - compose.yaml with health checks and persistent volumes.
      - A Git repository of exported workflows with no secrets in them.
    acceptance:
      - The stack starts with one command and survives restarts with its workflows and credentials.
      - A scan of the repository finds no secret values.
    reuses:
      - { kind: lesson, id: n8n-self-hosting-securely }
      - { kind: project, id: docker-compose-fullstack }
  - id: registration
    title: Event registration with validation and deduplication
    goal: Accept registrations through a webhook, validate and normalise them, store them with a uniqueness rule, confirm by e-mail, and reject duplicates clearly.
    deliverables:
      - The registration workflow and its PostgreSQL table.
      - A Postman collection testing the webhook, including invalid and duplicate cases.
    acceptance:
      - Invalid input returns 400 and stores nothing; a duplicate returns 409.
      - A storage failure returns an error and sends no confirmation.
    reuses:
      - { kind: project, id: n8n-event-registration }
      - { kind: project, id: postman-college-api-tests }
      - { kind: lab, id: n8n-branching-and-error-handling }
  - id: reminders
    title: Scheduled reminders, exactly once
    goal: Send assignment reminders on a schedule, once per student and assignment, with Redis idempotency keys and rate limits for the mail API, and an alert for addresses that fail.
    deliverables:
      - The reminder workflow with an idempotency check and a reminder log.
    acceptance:
      - Running the schedule twice sends no second reminder.
      - A failing address is reported without stopping the others.
    reuses:
      - { kind: project, id: n8n-assignment-reminders }
      - { kind: project, id: redis-rate-limiter }
  - id: triage
    title: Triage with a person in the loop
    goal: Classify support tickets (with a model or rules behind a validated interface), route them by category, and require a human approval before any refund — recording every decision.
    deliverables:
      - The triage workflow with an approval step and an audit table.
    acceptance:
      - Unknown or injected classifications go to the triage desk, never straight to an action.
      - A refund happens only after an approval by someone other than the requester, and the decision is recorded.
    reuses:
      - { kind: project, id: n8n-ticket-triage }
      - { kind: lab, id: n8n-human-approval }
      - { kind: lesson, id: n8n-ai-agents-and-risks }
  - id: operability
    title: Tested, traced and handed over
    goal: Test every external API the workflows depend on with Postman collections in CI, trace workflow executions with OpenTelemetry, and write a handover guide for the office that will own the automations.
    deliverables:
      - Collections and a CI job, traces of a full execution, a handover guide.
    acceptance:
      - Changing an API's response shape makes the collection fail before the workflow breaks in production.
      - One trace shows each step of a registration and how long it took.
    reuses:
      - { kind: project, id: postman-regression-suite }
      - { kind: project, id: otel-tracing-microservices }
rubric:
  - { criterion: "Reliability", excellent: "Validation, idempotency, retries and error workflows in every automation, proven by tests of the failure cases.", good: "The main failure cases are handled.", needs_work: "Automations that act twice or fail silently." }
  - { criterion: "Safety and governance", excellent: "Approvals for risky actions, separation of requester and approver, an audit trail and no secrets in exported workflows.", good: "Approvals and an audit log exist.", needs_work: "Money or data changes without a person deciding." }
  - { criterion: "Testing", excellent: "Postman collections for every dependency and webhook run in CI and catch contract changes.", good: "The main webhooks are tested.", needs_work: "Manual clicking only." }
  - { criterion: "Handover", excellent: "A non-developer can operate, pause and recover the automations from the guide; ownership and on-call are agreed.", good: "A clear README.", needs_work: "Only the builders understand it." }
stretch_goals:
  - Add a weekly digest workflow that reports how many actions each automation took and how many needed a person.
  - Move one workflow to code (a small service) and compare maintainability honestly.
  - Add an escalation when a refund waits for approval for more than a day.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college's offices run on forms, spreadsheets and copied e-mails: event registrations, assignment reminders,
support tickets. Automate three of these chores with a self-hosted n8n — and do it the way a careful engineer would:
validate before acting, never act twice, ask a person before anything risky, keep an audit trail, keep secrets out
of the workflows, and test the APIs the workflows depend on.

Low-code is not low-care. The workflows are code you draw instead of type; they need the same reviews, tests and
version control.

## Architecture

n8n orchestrates; PostgreSQL holds records and the audit trail with constraints that prevent duplicates; Redis holds
idempotency keys and rate limits for external APIs; credentials live in n8n's encrypted store, not in exported
workflows. Every workflow follows the same shape: validate, deduplicate, act, record — with an error path.

Record your main decisions — what stays in n8n and what does not, the approval rules, data retention — as
architecture decision records.

## Getting started

1. Bring up the stack with Docker Compose and export an empty workflow to Git; check that no secret is in the file.
2. Build the registration workflow first, with its Postman collection, before the other two.
3. Agree the approval rules for refunds with your "support lead" (a teammate) before building triage.
4. Present a registration, a duplicate, a refund approval and the audit trail that records them.
