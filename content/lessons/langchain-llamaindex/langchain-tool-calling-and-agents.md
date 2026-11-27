---
id: langchain-tool-calling-and-agents
title: Tool calling and agents, safely
track: langchain-llamaindex
order: 5
level: intermediate
estimated_minutes: 45
prerequisites: [langchain-rag-with-citations]
starts_fresh: true
learning_objectives:
  - Define tools with LangChain's @tool decorator, and explain how a model asks for a tool call and receives the result.
  - Write the agent loop yourself — model, tool calls, tool results, repeat — so every safety check is visible.
  - Guard tools with an allowlist, argument validation, human approval for risky actions, and a step limit.
  - Keep an audit log of what an agent tried, what ran and what was refused.
resources:
  - title: Tools (LangChain documentation)
    url: https://docs.langchain.com/oss/python/langchain/tools
    publisher: LangChain
    type: documentation
    level: intermediate
    official: true
    why: Defining tools with @tool, their names, descriptions and argument schemas, which the model sees.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Agents (LangChain documentation)
    url: https://docs.langchain.com/oss/python/langchain/agents
    publisher: LangChain
    type: documentation
    level: intermediate
    official: true
    why: An agent runs a model in a loop, calling tools until it can answer; without another limit, create_agent stops only at its recursion limit of 9,999 steps, so production agents should set a lower recursion_limit or cap model calls.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: OWASP Top 10 for Large Language Model Applications — Excessive Agency
    url: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
    publisher: OWASP Foundation
    type: article
    level: advanced
    official: true
    why: Limit the functions, permissions and autonomy given to LLM agents, and require human approval for high-impact actions.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: who-runs
    prompt: When a model "calls a tool", who actually runs it?
    options:
      - { id: a, text: "The model provider" }
      - { id: b, text: "Your code — the model only returns the tool's name and arguments, and your loop decides whether and how to run it" }
      - { id: c, text: "The tool runs itself" }
    answer: b
    explanation: That decision point is where allowlists, validation and approvals belong.
  - id: approval
    prompt: Which actions should need a human's approval?
    options:
      - { id: a, text: "None — that defeats the point of an agent" }
      - { id: b, text: "Actions that are costly or hard to undo (refunds above a limit, deletions, sending messages to customers); read-only lookups can run freely" }
      - { id: c, text: "All of them" }
    answer: b
    explanation: Match the control to the impact, as the lab does with a refund limit.
  - id: limit
    prompt: Why does the loop stop after a fixed number of steps?
    options:
      - { id: a, text: "To save memory" }
      - { id: b, text: "A model can keep calling tools without finishing; a step limit bounds cost and side effects and turns a runaway into a visible failure" }
      - { id: c, text: "Tools can only be called four times" }
    answer: b
    explanation: The runaway scenario in the lab stops after four steps with a clear message.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with python:3.12-slim (pinned by digest) and langchain-core 1.8.4, starting from nothing, and its output is compared with this lesson. The model is GenericFakeChatModel replaying scripted replies — a labelled stand-in so each scenario is repeatable; no real model is called. Checked against the LangChain and OWASP documentation and the langchain-core 1.8.4 source on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

With **tool calling**, a model replies with "call `refund` with these arguments" instead of text; an **agent** is a loop that runs the requested tools and feeds the results back — and because *your* code runs every tool, your code must decide what is **allowed**, **valid**, **approved** and **enough**.

## Explain it like I'm twelve

A new helper in the school office can ask to use the stapler, the phone or the till. They don't touch anything themselves: they ask the office manager. The manager lets them use the stapler freely, checks the phone number before a call, says "not without the head teacher" for taking money out of the till, refuses outright if they ask for the master keys — and after the tenth "can I use the stapler again?" says "that's enough for today".

## What problem it solves

Models that can only talk cannot look up an order or issue a refund; tools let them act. But a model can choose the wrong tool, pass nonsense arguments, be talked into something by text it reads (next lessons), or loop forever. Every one of those failures turns into a real action if tools run unchecked. The checks belong in the loop between model and tools.

## How it works

![](media:langchain-llamaindex/agent-loop.svg)

- `@tool` turns a typed, documented function into a tool: its **name**, **description** and **argument schema** are what the model sees.
- A model that supports tool calling returns an `AIMessage` whose `tool_calls` list names a tool and arguments. Your code runs it and returns a `ToolMessage` with the result.
- The **loop** repeats until the model answers in text — or a **step limit** stops it.
- **Guards** at the point of execution: an **allowlist** of tools for this agent; **validation** of arguments against the schema (errors go back to the model); **approval** for high-impact calls; an **audit log** of everything.

## Try it yourself

> **Local lab** — needs Docker. Python runs in a container with langchain-core 1.8.4. The model is `GenericFakeChatModel`, which replays scripted replies — a labelled stand-in, so each scenario is the same every time. (`bind_tools`, which tells a real model about your tools, is not implemented by the fake models; the loop below does not need it.) Every command is run automatically in DevForge's tests.

### 1. Tools and the container

```bash run
mkdir -p agent-lab && cd agent-lab
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-llm -w /lab "$IMAGE" sleep infinity > /dev/null
docker exec devforge-llm pip install -q --root-user-action=ignore --disable-pip-version-check langchain-core==1.8.4
py() { docker exec -i devforge-llm python - "$@"; }
put() { docker exec -i devforge-llm sh -c "cat > /lab/$1"; }
put shop_tools.py <<'EOF'
from langchain_core.tools import tool

ORDERS = {"o1": 450, "o2": 1200}

@tool
def get_order(order_id: str) -> str:
    """Look up an order's total in rupees."""
    return f"order {order_id}: total {ORDERS[order_id]}" if order_id in ORDERS else f"no order {order_id}"

@tool
def refund(order_id: str, amount: int) -> str:
    """Refund part or all of an order, in whole rupees."""
    return f"refunded {amount} on {order_id}"

@tool
def delete_account(customer_id: str) -> str:
    """Delete a customer's account and all their data."""
    return f"deleted {customer_id}"
EOF
py <<'EOF'
from shop_tools import get_order, refund
for t in (get_order, refund):
    print(f"{t.name}: {t.description} args={ {k: v['type'] for k, v in t.args.items()} }")
EOF
```

```text output
get_order: Look up an order's total in rupees. args={'order_id': 'string'}
refund: Refund part or all of an order, in whole rupees. args={'order_id': 'string', 'amount': 'integer'}
```

The name, the docstring and the typed arguments are exactly what a model is shown — so write them for the model as carefully as for a colleague. `delete_account` exists in the codebase, but it will not be offered to this agent.

### 2. The loop, with its guards

```bash run
put agent.py <<'EOF'
from langchain_core.messages import HumanMessage, ToolMessage
from pydantic import ValidationError
from shop_tools import get_order, refund

ALLOWED = {t.name: t for t in (get_order, refund)}     # this agent's tools: no delete_account
APPROVAL_ABOVE = 500                                     # refunds above this need a person

def run(model, task, approver=None, max_steps=4):
    messages, audit = [HumanMessage(task)], []
    for step in range(1, max_steps + 1):
        reply = model.invoke(messages)
        messages.append(reply)
        if not reply.tool_calls:
            audit.append(f"answer: {reply.content}")
            return audit
        for call in reply.tool_calls:
            name, args = call["name"], call["args"]
            if name not in ALLOWED:
                result, status = f"tool {name} is not available to this agent", "refused"
            elif name == "refund" and isinstance(args.get("amount"), int) and args["amount"] > APPROVAL_ABOVE \
                    and not (approver and approver(call)):
                result, status = f"refund of {args['amount']} needs approval; nothing was refunded", "held"
            else:
                try:
                    result, status = ALLOWED[name].invoke(args), "ran"
                except ValidationError as e:
                    result, status = f"invalid arguments: {e.errors()[0]['loc'][0]} {e.errors()[0]['msg']}", "invalid"
            audit.append(f"step {step}: {name}({args}) → {status}: {result}")
            messages.append(ToolMessage(result, tool_call_id=call["id"]))
    audit.append(f"stopped: no answer after {max_steps} steps")
    return audit
EOF
put scripted.py <<'EOF'
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

def call(name, n=1, **args):
    return AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"call-{n}"}])

def model(*replies):
    """A stand-in model that replays the given replies, one per turn."""
    return GenericFakeChatModel(messages=iter(replies))
EOF
py <<'EOF'
from langchain_core.messages import AIMessage
from agent import run
from scripted import call, model
stand_in = model(call("get_order", order_id="o1"),
                 call("refund", 2, order_id="o1", amount=40),
                 AIMessage("Refunded 40 rupees on order o1."))
print("\n".join(run(stand_in, "Refund 40 rupees on order o1")))
EOF
```

```text output
step 1: get_order({'order_id': 'o1'}) → ran: order o1: total 450
step 2: refund({'order_id': 'o1', 'amount': 40}) → ran: refunded 40 on o1
answer: Refunded 40 rupees on order o1.
```

The model asked for a lookup, then a refund, then answered; each tool result went back as a `ToolMessage` before the next turn. Every request and outcome is in the audit log.

### 3. When the model goes wrong

```bash run
py <<'EOF'
from langchain_core.messages import AIMessage
from agent import run
from scripted import call, model

scenarios = {
    "a tool it was not given": (model(call("delete_account", customer_id="c7"), AIMessage("I could not do that.")), None),
    "nonsense arguments": (model(call("refund", order_id="o1", amount="lots"),
                                 call("refund", 2, order_id="o1", amount=40), AIMessage("Done.")), None),
    "a large refund, no approver": (model(call("refund", order_id="o2", amount=1200), AIMessage("Waiting for approval.")), None),
    "a large refund, approved": (model(call("refund", order_id="o2", amount=1200), AIMessage("Done.")),
                                 lambda c: c["args"]["order_id"] == "o2"),   # stands in for a manager clicking Approve
    "a runaway": (model(*[call("get_order", n, order_id="o1") for n in range(10)]), None),
}
for title, (m, approver) in scenarios.items():
    print(f"--- {title}")
    print("\n".join(run(m, "help the customer", approver=approver)))
EOF
```

```text output
--- a tool it was not given
step 1: delete_account({'customer_id': 'c7'}) → refused: tool delete_account is not available to this agent
answer: I could not do that.
--- nonsense arguments
step 1: refund({'order_id': 'o1', 'amount': 'lots'}) → invalid: invalid arguments: amount Input should be a valid integer, unable to parse string as an integer
step 2: refund({'order_id': 'o1', 'amount': 40}) → ran: refunded 40 on o1
answer: Done.
--- a large refund, no approver
step 1: refund({'order_id': 'o2', 'amount': 1200}) → held: refund of 1200 needs approval; nothing was refunded
answer: Waiting for approval.
--- a large refund, approved
step 1: refund({'order_id': 'o2', 'amount': 1200}) → ran: refunded 1200 on o2
answer: Done.
--- a runaway
step 1: get_order({'order_id': 'o1'}) → ran: order o1: total 450
step 2: get_order({'order_id': 'o1'}) → ran: order o1: total 450
step 3: get_order({'order_id': 'o1'}) → ran: order o1: total 450
step 4: get_order({'order_id': 'o1'}) → ran: order o1: total 450
stopped: no answer after 4 steps
```

- **Allowlist**: the model asked for `delete_account` — perhaps because a document told it to — and was refused, because this agent was never given that tool. Not offering a tool is the strongest guard.
- **Validation**: `amount="lots"` failed the tool's schema before anything ran; the error went back to the model, which corrected itself.
- **Approval**: a refund above 500 was held until a person approved it. In a real system the approval is a separate, authenticated step (a button, a ticket), not something the model can trigger.
- **Step limit**: the runaway was stopped after four steps, with a message that makes the failure obvious in the audit log. LangChain's own `create_agent` has a limit too, but its documentation notes it is 9,999 steps unless you set a lower `recursion_limit` — set one.

### 4. Clean up

```bash run
docker rm -f devforge-llm > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Giving an agent every tool "just in case".** Offer the fewest tools with the narrowest permissions for the task.
- **Trusting arguments because the model produced them.** Validate types and business rules (amount ≤ order total, the order belongs to this customer) in code.
- **Letting the model approve its own risky actions.** Approval must come from a person or a system the model cannot influence.
- **No step or cost limit.** A loop that never finishes costs money and may repeat side effects.
- **No audit log.** When something goes wrong you need to know what was asked, what ran and what was refused.

## Where this fits in a real system

Tools usually call internal APIs — the kind you tested in the **Postman** track — with the agent's own, limited credentials; approvals arrive through a workflow such as the **n8n** human-approval lab; audit logs go to the same pipeline as other logs, traced with **OpenTelemetry**; and refunds or other side effects should be idempotent, as in the **Kafka** delivery-guarantees lesson, in case a step is retried.
