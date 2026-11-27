"""Study assistant agent: a tool-calling loop that stays safe whatever the model asks for.

Keep this interface — the check calls it with scripted stand-in models:

    run(model, task, approver=None, max_steps=5) -> {"answer": str | None, "stopped": bool, "audit": [entry, ...]}

    model     a LangChain chat model (in the check: GenericFakeChatModel with scripted replies, see scripted.py)
    approver  None, or a function approver(call) -> bool that stands in for a person clicking Approve; call is the
              model's tool call, {"name": ..., "args": {...}, "id": ...}
    audit     one entry per tool call the model asked for:
              {"step": <model turn, from 1>, "tool": name, "args": {...}, "status": "ran" | "refused" | "invalid" |
               "blocked", "result": "<text sent back to the model>"}, plus "untrusted": True on a call whose result
              contained untrusted notes, and "approved": True on a held call a person approved.

The rules (README.md explains why):
1. Only search_notes, make_flashcards and schedule_reminder may run. Anything else is "refused" — and a person's
   approval cannot change that.
2. Arguments are checked against the tool's schema before it runs; failures are "invalid".
3. Once a tool result with untrusted content (a note with "trusted": False) has been shown to the model, a tool
   that changes something (schedule_reminder) is "blocked" unless approver(call) returns True.
4. At most max_steps model turns; then stop with {"answer": None, "stopped": True, ...}.
5. Every tool call is answered with a ToolMessage carrying its id — refused, invalid and blocked ones too.
"""
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage  # noqa: F401
from pydantic import ValidationError  # noqa: F401

from study_tools import make_flashcards, schedule_reminder, search_notes  # noqa: F401


def run(model, task, approver=None, max_steps=5):
    # A naive loop, as many tutorials write it. It runs every tool the model names — including send_email and
    # delete_notes — with whatever arguments it gives, forever, and keeps no record. Replace it.
    from study_tools import ALL_TOOLS
    messages = [HumanMessage(task)]
    while True:
        reply = model.invoke(messages)
        messages.append(reply)
        if not reply.tool_calls:
            return {"answer": reply.content, "stopped": False, "audit": []}
        for call in reply.tool_calls:
            result = ALL_TOOLS[call["name"]].invoke(call["args"])
            messages.append(ToolMessage(str(result), tool_call_id=call["id"]))
