# Tool-using study assistant with safe, limited tools

A study assistant can search a student's notes, make flashcards and set reminders. The codebase also has tools
that send e-mail and delete notes — written for other features — and some of the student's notes were imported
from a class forum that anyone can post to. One forum note contains an instruction aimed at the assistant.

`agent.py` contains the loop as many tutorials write it: it runs any tool the model names, with any arguments,
for as long as the model keeps asking, and records nothing. Replace it with a loop that stays safe **whatever the
model asks for** — because a model that reads that forum note may ask for anything.

## The rules (details in `agent.py`)

1. **Allow-list**: only `search_notes`, `make_flashcards` and `schedule_reminder` may run. Anything else is
   refused — and no approval can change that.
2. **Validation**: arguments are checked against the tool's schema before it runs.
3. **Untrusted content**: once a note with `"trusted": false` has been shown to the model, a tool that changes
   something (`schedule_reminder`) is blocked unless a person approves it (`approver(call)` returns `True`).
4. **Step limit**: at most `max_steps` model turns.
5. **Audit log**: one entry per tool call — step, tool, arguments, status (`ran`, `refused`, `invalid`, `blocked`)
   and the result sent back to the model — and every tool call is answered with a `ToolMessage`.

## Files

- `study_tools.py` — the tools and the notes (do not change). `REMINDERS`, `OUTBOX` and `DELETED` record what the
  tools really did.
- `scripted.py` — the labelled stand-in model from "Tool calling and agents" (`GenericFakeChatModel` with scripted
  replies), so you can play an honest, a confused, a runaway or an injected model.
- `try_it.py` — plays the injected model against your agent and prints the audit log.

No API key and no paid service: the check runs your code with the network switched off.

## Try it

```bash
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" sh -c "pip install -q -r requirements.txt && python try_it.py"
bash check.sh .
```
