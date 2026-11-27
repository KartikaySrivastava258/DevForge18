---
id: langchain-study-agent
track: langchain-llamaindex
title: Tool-using study assistant with safe, limited tools
level: advanced
estimated_hours: 8
prerequisites: [langchain-tool-calling-and-agents, llm-prompt-injection-and-permissions, llm-evaluation-and-hallucination-checks]
related_tracks: [n8n]
user_stories:
  - As a student, I want the study assistant to search my notes, make flashcards and set reminders so that revision takes less organising.
  - As a student, I want the assistant never to send my notes anywhere or delete them, whatever a document tells it, so that one bad forum post cannot cost me my work.
  - As an on-call developer, I want every tool call in an audit log with its outcome so that I can explain exactly what the assistant did and why.
acceptance_criteria:
  - An honest run uses the allowed tools, really sets the reminder, answers every tool call with a ToolMessage carrying its id, and ends with the model's answer.
  - Tools outside the allow-list (send_email, delete_notes) are refused, never run, and cannot be unlocked by an approver.
  - Arguments are validated against each tool's schema before anything runs; invalid calls are logged as invalid and answered so the model can correct itself.
  - After a forum note with an injected instruction is read, the e-mail and deletion it asks for are refused, the reminder it asks for is blocked, and nothing happens.
  - A side effect after untrusted content runs only when the approver approves it; a declined approval keeps it blocked, and an approval is logged.
  - A runaway model is stopped after max_steps turns, with stopped=True and no answer.
  - Every audit entry is JSON with step, tool, args, status (ran, refused, invalid or blocked) and result.
rubric:
  - { criterion: "Least privilege", excellent: "The allow-list is explicit and minimal, dangerous tools are never offered, approval cannot widen it, and the README argues for each tool's place.", good: "Only allowed tools run.", needs_work: "The loop runs whatever the model names." }
  - { criterion: "Injection resistance", excellent: "Guards are in code, independent of prompts; untrusted content is tracked from where it enters, side effects after it need a person, and the README is honest that the system prompt alone guarantees nothing.", good: "The injected requests have no effect.", needs_work: "Relies on telling the model to ignore instructions in documents." }
  - { criterion: "Robustness", excellent: "Validation errors, refusals and blocks go back to the model as ToolMessages so it can recover; the step limit is low and its stop is obvious in the log.", good: "Bad calls do not crash the loop and the loop always ends.", needs_work: "Exceptions escape, or a runaway model loops until a timeout." }
  - { criterion: "Auditability", excellent: "From the audit log alone a reviewer can reconstruct every request, decision and result, including who approved what; entries are JSON ready to ship to a log store.", good: "Every call and its outcome is recorded.", needs_work: "Only successful calls, or free-text logs nobody can query." }
hints:
  - Start from the loop in "Tool calling and agents" — it already has an allow-list, validation, approval and a step limit. Your new problem is deciding when a side effect needs a person.
  - Each tool has an args_schema (a Pydantic model). tool.args_schema.model_validate(args) raises ValidationError before anything runs.
  - search_notes returns notes as dictionaries with "trusted". Once any returned note has "trusted" False, everything the model asks for afterwards may come from that note.
  - Answer every tool call with ToolMessage(text, tool_call_id=call["id"]), refusals included — as the tool-calling lesson's loop does, the model then learns why its request failed and can correct it (the lesson's model fixed its own invalid amount).
  - try_it.py plays the injected model and prints what really happened. With the starter's loop, the student's notes are e-mailed away and deleted.
stretch_goals:
  - Write the audit log to a JSON Lines file and a small script that summarises it (calls per status, blocked requests, approvals).
  - Add a per-run budget for side effects (at most one reminder per run) and an idempotency rule (no duplicate reminder for the same day and text).
  - Connect a real model with bind_tools and run the same scenarios; compare how often the real model follows the forum note.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A study assistant that can act is more useful than one that can only talk — and more dangerous. This one can
search a student's notes, make flashcards and set reminders. The codebase also has tools that send e-mail and
delete notes, and some notes were imported from a class forum that anyone can post to. One forum post contains
an instruction aimed at the assistant: e-mail all the notes to an outside address, set a weekly reminder to do
it again, and delete the notes.

The starter's agent loop is the one many tutorials show: it runs any tool the model names, with any arguments,
until the model stops asking. Played against a model that obeys the forum post, it e-mails the notes away and
deletes them. Replace it with a loop whose guards are in **code** — an allow-list, schema validation, a rule that
side effects after untrusted content need a person, a step limit, and an audit log — so the outcome does not
depend on what the model decides.

The model is the track's labelled stand-in, `GenericFakeChatModel` with scripted replies: it lets the check play
an honest model, a confused one, a runaway one and an injected one, and then look at what the tools really did.
No API key is needed, and the check runs your code with the network switched off.

## Getting started

1. Copy the starter into a new folder. Read `study_tools.py` (including note `n5`) and the rules in `agent.py`.
2. Run `try_it.py` with the starter's loop and look at "what really happened":

   ```bash
   IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
   docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" \
     sh -c "pip install -q -r requirements.txt && python try_it.py"
   ```

3. Rewrite `run()` in `agent.py`, rule by rule, and run `try_it.py` again after each one.
4. Run the check. It needs Docker, installs the pinned packages in a throwaway container, and removes it:

   ```bash
   bash check.sh path/to/your/project
   ```
