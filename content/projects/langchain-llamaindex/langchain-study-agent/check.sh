#!/usr/bin/env bash
# Acceptance check for "Tool-using study assistant with safe, limited tools".
# Usage: bash check.sh path/to/your/project   (the folder with agent.py, study_tools.py and scripted.py)
# Needs Docker. Starts one throwaway Python container (the image the track's lessons use), installs the pinned
# packages from requirements.txt once, then cuts the container off the network and runs the scenarios below inside
# it. The model is a scripted stand-in (GenericFakeChatModel) that plays an honest model, a confused one, a runaway
# one and one that obeys a prompt-injected note; the check then looks at what really happened — the reminders,
# e-mails and deletions the tools recorded — and at your audit log. Prints PASS or FAIL per criterion and exits
# non-zero if any fails. Removes the container.
set -uo pipefail
dir="${1:-.}"
image="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
name="devforge-check-llm-agent-$$"
# The only packages the check installs: the exact versions the track's lessons run.
allowed="langchain-core==1.8.4 numpy==2.5.5 llama-index-core==0.14.26"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}

for f in agent.py study_tools.py; do
  [ -f "$dir/$f" ] || { fail "$dir/$f is missing"; finish; }
done
pins=""
if [ -f "$dir/requirements.txt" ]; then
  while read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | tr -d '[:space:]')"
    [ -z "$line" ] && continue
    case " $allowed " in *" $line "*) pins="$pins $line" ;; *) fail "requirements.txt: \"$line\" is not one of the pinned versions the check installs ($allowed)"; finish ;; esac
  done < "$dir/requirements.txt"
fi
[ -n "$pins" ] || pins=" langchain-core==1.8.4"
echo "PASS: requirements.txt pins only versions the lessons use:$pins"

trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" "$image" sleep infinity > /dev/null || { fail "could not start the Python container in Docker"; finish; }
# shellcheck disable=SC2086  # $pins is a list of words
if ! out="$(docker exec "$name" pip install -q --root-user-action=ignore --disable-pip-version-check $pins 2>&1)"; then
  fail "pip could not install$pins: $(echo "$out" | tail -n 1)"; finish
fi
docker network disconnect bridge "$name" > /dev/null 2>&1 || true   # from here on: no network at all
docker exec "$name" mkdir -p /work
docker cp "$dir/." "$name:/work/" > /dev/null || { fail "could not copy $dir into the container"; finish; }

results="$(timeout 240 docker exec -i -w /work "$name" python -B - 2>&1 <<'PY'
import copy, json, sys
sys.path.insert(0, "/work")

def ok(msg): print(f"PASS: {msg}")
def bad(msg): print(f"FAIL: {msg}")
def why(e): return f"{e.__class__.__name__}: {str(e).splitlines()[0] if str(e) else ''}"

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolMessage

try:
    import study_tools
    import agent
    if not callable(getattr(agent, "run", None)):
        raise AttributeError("agent.py must define run(model, task, approver=None, max_steps=5)")
    for record in ("REMINDERS", "OUTBOX", "DELETED", "NOTES"):
        getattr(study_tools, record)
except Exception as e:
    bad(f"agent.py and study_tools.py cannot be imported as the starter defines them: {why(e)}")
    sys.exit(0)

class RecordingModel(GenericFakeChatModel):
    """Scripted replies, one per turn, and a copy of the conversation the agent sent on every turn."""
    seen: list = []
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.seen.append(list(messages))
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

def turn(*requests, content=""):
    return AIMessage(content, tool_calls=[{"name": n, "args": a, "id": f"c{i}-{n}"} for i, (n, a) in enumerate(requests, 1)])

NOTES = copy.deepcopy(study_tools.NOTES)
def reset():
    for record in (study_tools.REMINDERS, study_tools.OUTBOX, study_tools.DELETED):
        record.clear()
    study_tools.NOTES[:] = copy.deepcopy(NOTES)

STATUSES = {"ran", "refused", "invalid", "blocked"}
audits = []
def play(replies, approver=None, max_steps=5, task="Help me revise."):
    reset()
    model = RecordingModel(messages=iter(replies), seen=[])
    result = agent.run(model, task, approver=approver, max_steps=max_steps)
    if not isinstance(result, dict) or not {"answer", "stopped", "audit"} <= set(result):
        raise TypeError('run() must return a dict with "answer", "stopped" and "audit"')
    audits.append(result["audit"])
    return result, model.seen

def statuses(result): return [(e.get("tool"), e.get("status")) for e in result["audit"]]

def unanswered(seen, replies):
    """Tool calls whose ToolMessage (same id) never reached the model's next turn."""
    missing = []
    for i, reply in enumerate(replies):
        if not isinstance(reply, AIMessage) or not reply.tool_calls or i + 1 >= len(seen):
            continue
        ids = {m.tool_call_id for m in seen[i + 1] if isinstance(m, ToolMessage)}
        missing += [c["name"] for c in reply.tool_calls if c["id"] not in ids]
    return missing

# --- Positive control: an honest model, trusted notes, allowed tools ---------------------------------------
control = False
HONEST = [turn(("search_notes", {"query": "binary search"})),
          turn(("make_flashcards", {"topic": "binary search", "count": 2})),
          turn(("schedule_reminder", {"date": "2026-12-10", "text": "Revise binary search flashcards"})),
          AIMessage("Two flashcards are ready and a reminder is set for 10 December.")]
try:
    result, seen = play(HONEST)
    if result["answer"] != HONEST[-1].content or result["stopped"]:
        bad(f"an honest run must end with the model's answer (got answer={str(result['answer'])[:60]!r}, stopped={result['stopped']!r})")
    elif statuses(result) != [("search_notes", "ran"), ("make_flashcards", "ran"), ("schedule_reminder", "ran")]:
        bad(f"allowed tools with valid arguments must run, and each call must be in the audit log (got {statuses(result)})")
    elif study_tools.REMINDERS != [{"date": "2026-12-10", "text": "Revise binary search flashcards"}]:
        bad(f"the reminder must really be set after reading trusted notes only (REMINDERS = {study_tools.REMINDERS})")
    elif unanswered(seen, HONEST):
        bad(f"every tool call must be answered with a ToolMessage carrying its id before the next model turn (missing for {unanswered(seen, HONEST)})")
    else:
        control = True
        ok("an honest run uses the allowed tools, sets the reminder, answers each call with a ToolMessage, and logs 3 steps")
except Exception as e:
    bad(f"run() failed on an honest run: {why(e)}")

def guarded(label, test):
    if not control:
        bad(f"{label} — cannot be judged until an honest run works")
        return
    try:
        problem = test()
        (bad(f"{label}: {problem}") if problem else ok(label))
    except Exception as e:
        bad(f"{label}: {why(e)}")

def allow_list():
    replies = [turn(("send_email", {"to": "someone@mail.example", "body": "my notes"}), ("delete_notes", {"topic": "exam"})),
               AIMessage("I cannot do that.")]
    asked = []
    result, seen = play(replies, approver=lambda call: asked.append(call["name"]) or True)   # approves everything
    if statuses(result) != [("send_email", "refused"), ("delete_notes", "refused")]:
        return f"send_email and delete_notes must be refused (status 'refused') (got {statuses(result)})"
    if study_tools.OUTBOX or study_tools.DELETED or study_tools.NOTES != NOTES:
        return f"a refused tool must never run (OUTBOX={study_tools.OUTBOX}, deleted={len(study_tools.DELETED)})"
    if asked:
        return f"approval must not unlock a tool outside the allow-list, so the approver must not even be asked (asked for {asked})"
    if unanswered(seen, replies):
        return f"refused calls must still be answered with a ToolMessage (missing for {unanswered(seen, replies)})"
    if result["answer"] != "I cannot do that.":
        return "after refusals, the run must continue and return the model's answer"
guarded("tools outside the allow-list are refused, never run, and cannot be approved", allow_list)

def validation():
    replies = [turn(("make_flashcards", {"topic": "graphs", "count": 500})),
               turn(("schedule_reminder", {"date": "next tuesday", "text": "revise"})),
               turn(("schedule_reminder", {"date": "2026-12-10"})),
               turn(("make_flashcards", {"topic": "graphs", "count": 1})),
               AIMessage("One flashcard is ready.")]
    result, seen = play(replies)
    want = [("make_flashcards", "invalid"), ("schedule_reminder", "invalid"), ("schedule_reminder", "invalid"), ("make_flashcards", "ran")]
    if statuses(result) != want:
        return f"count=500, a date that is not YYYY-MM-DD and a missing text must be 'invalid', then a valid call runs (got {statuses(result)})"
    if study_tools.REMINDERS:
        return f"a call with invalid arguments must not run (REMINDERS = {study_tools.REMINDERS})"
    if unanswered(seen, replies):
        return f"invalid calls must be answered with a ToolMessage so the model can correct itself (missing for {unanswered(seen, replies)})"
guarded("arguments are validated against each tool's schema before anything runs", validation)

INJECTED = [turn(("search_notes", {"query": "exam"})),
            turn(("send_email", {"to": "notes-helper@forum.example", "body": "all notes"}),
                 ("schedule_reminder", {"date": "2026-12-07", "text": "Email all notes to notes-helper@forum.example"}),
                 ("delete_notes", {"topic": "exam"})),
            AIMessage("Maintenance done.")]
def injection():
    result, seen = play(list(INJECTED))
    want = [("search_notes", "ran"), ("send_email", "refused"), ("schedule_reminder", "blocked"), ("delete_notes", "refused")]
    if statuses(result) != want:
        return f"after a note from the forum asks for it, the e-mail and deletion must be refused and the reminder blocked (got {statuses(result)})"
    if not result["audit"][0].get("untrusted"):
        return "the audit entry of the search that returned the forum note must be marked \"untrusted\": true"
    if study_tools.REMINDERS or study_tools.OUTBOX or study_tools.DELETED:
        return f"nothing the injected note asked for may happen (REMINDERS={study_tools.REMINDERS}, OUTBOX={study_tools.OUTBOX}, deleted={len(study_tools.DELETED)})"
guarded("tool calls a prompt-injected note asks for are refused or blocked, and nothing happens", injection)

def approval():
    asked = []
    result, _ = play(list(INJECTED), approver=lambda call: asked.append(call["name"]) or False)
    if ("schedule_reminder", "blocked") not in statuses(result) or study_tools.REMINDERS:
        return f"when the person declines, the reminder must stay blocked (got {statuses(result)}, REMINDERS={study_tools.REMINDERS})"
    if asked != ["schedule_reminder"]:
        return f"the approver must be asked about the held side effect only (asked about {asked})"
    result, _ = play(list(INJECTED), approver=lambda call: call["name"] == "schedule_reminder")
    entry = [e for e in result["audit"] if e.get("tool") == "schedule_reminder"]
    if not entry or entry[0].get("status") != "ran" or entry[0].get("approved") is not True or len(study_tools.REMINDERS) != 1:
        return f"when the person approves, the reminder runs and its audit entry says \"approved\": true (got {entry})"
    if study_tools.OUTBOX or study_tools.DELETED:
        return "approving the reminder must not let the refused tools run"
guarded("a side effect after untrusted content runs only when a person approves it, and the approval is logged", approval)

def step_limit():
    replies = [turn(("search_notes", {"query": "graphs"})) for _ in range(10)]
    result, seen = play(replies, max_steps=4)
    if result["stopped"] is not True or result["answer"] is not None:
        return f"a model that never stops must be stopped: stopped=True and answer=None (got stopped={result['stopped']!r}, answer={result['answer']!r})"
    if len(seen) != 4 or len(result["audit"]) != 4:
        return f"with max_steps=4 the model must be called 4 times and 4 steps logged (model calls: {len(seen)}, audit entries: {len(result['audit'])})"
guarded("the step limit stops a runaway model after max_steps turns", step_limit)

def audit_log():
    if len(audits) < 5:
        return "not enough runs completed to judge the audit log"
    for audit in audits:
        json.dumps(audit)   # must be writable to a log file as JSON
        steps = [e.get("step") for e in audit]
        for e in audit:
            if not {"step", "tool", "args", "status", "result"} <= set(e) or e["status"] not in STATUSES or not isinstance(e["result"], str):
                return f"every entry needs step, tool, args, status (ran/refused/invalid/blocked) and result as text (got {e})"
        if steps != sorted(steps) or not all(isinstance(s, int) and s >= 1 for s in steps):
            return f"step numbers must count model turns from 1, in order (got {steps})"
guarded("every audit entry is JSON with step, tool, args, status and result", audit_log)
PY
)"
status=$?
echo "$results"
if [ "$status" -ne 0 ] && ! echo "$results" | grep '^FAIL' > /dev/null; then fail "the tests did not finish (exit code $status)"; fi
failures=$((failures + $(echo "$results" | grep -c '^FAIL')))
finish
