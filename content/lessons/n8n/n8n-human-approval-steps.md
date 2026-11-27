---
id: n8n-human-approval-steps
title: Human approval steps — timeouts, four eyes and restarts
track: n8n
order: 5
level: intermediate
estimated_minutes: 45
prerequisites: [n8n-calling-apis-and-mapping]
starts_fresh: true
learning_objectives:
  - Pause a workflow for a decision with a Wait node resumed by webhook, and answer the requester at once with the resume URL.
  - Limit how long an approval may wait, and escalate instead of waiting forever.
  - Enforce a four-eyes rule — the requester cannot approve their own request — in the workflow, not in the approver's goodwill.
  - Show that a waiting execution survives an n8n restart, because its state is stored in the database.
resources:
  - title: Wait node (n8n documentation)
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: Resume on webhook call or form submission; Limit Wait Time resumes automatically after an interval; while waiting, the execution data is offloaded to the database and reloaded when the condition is met.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: timeout
    prompt: An approver is on holiday. What should happen to an approval request after two days?
    options:
      - { id: a, text: "Keep waiting; someone will notice" }
      - { id: b, text: "Limit the wait and handle the timeout explicitly — escalate to someone else or decline with a reason — so nothing waits forever unseen" }
      - { id: c, text: "Approve it automatically" }
    answer: b
    explanation: The lab's 3-second limit stands in for days; the timeout is a branch you design, not an accident.
  - id: four-eyes
    prompt: Why check in the workflow that the approver is not the requester?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "Because the approval URL can be forwarded or used by anyone who has it; the rule must be enforced where the decision is processed" }
      - { id: c, text: "n8n requires it" }
    answer: b
    explanation: The lab refuses a self-approval even though the URL and signature are valid.
  - id: restart
    prompt: n8n restarts while ten approvals are waiting. What happens?
    options:
      - { id: a, text: "They are lost" }
      - { id: b, text: "They keep waiting: waiting executions are stored in n8n's database and resume when their URL is called after the restart — as long as the database itself is kept" }
      - { id: c, text: "They are all approved" }
    answer: b
    explanation: That is also why the database (not the container) must be backed up and kept on a volume.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official n8nio/n8n:2.49.6 image (pinned by digest), starting from nothing, and its output is compared with this lesson. The "ledger" that records outcomes is a small Node.js stand-in inside the n8n container. Approvals are sent with curl to stand in for an approver clicking a link. Checked against the n8n documentation and the Wait node definition in n8n 2.49.6 on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

An approval step pauses a workflow until a person decides — and a production-ready one also decides **what happens when nobody answers**, enforces **who may approve**, and keeps waiting **across restarts**.

## Explain it like I'm twelve

A trip form needs a parent's signature. The school doesn't wait forever: if the form isn't back by Friday, it goes to the head teacher. A pupil can't sign their own form, even if they have the pen. And if the school office closes for the weekend, the pile of forms waiting for signatures is still there on Monday.

## What problem it solves

Approvals guard money, access and irreversible actions. The happy path — "ask, wait, act" — is easy (the *Require human approval* lab builds it). The failures are subtle: requests that wait forever because an approver is away, people approving their own requests with a forwarded link, and approvals lost when the automation server restarts. Each needs an explicit design decision.

## How it works

![](media:n8n/approval-steps.svg)

- **Wait node, resume "On Webhook Call"**: the execution pauses; `$execution.resumeUrl` is a signed URL that wakes *this* execution. A **Respond to Webhook** node before it answers the requester immediately (`202`).
- **Limit Wait Time**: with an interval set, the execution resumes on its own when it runs out, passing on the item it was given — with no decision in it, which is how the next step knows it timed out.
- **Rules after the wait**: a Code node (or IF nodes) checks the decision — including that the approver is not the requester — and produces one outcome.
- **Persistence**: while waiting, the execution is stored in n8n's database; a restarted n8n resumes it when its URL is called or its time runs out.

## Try it yourself

> **Local lab** — needs Docker. n8n runs as in the earlier lessons, with a small stand-in "ledger" API inside the container that records each outcome. You play the requester and the approvers with `curl`. Every command is run automatically in DevForge's tests.

### 1. n8n, a ledger, and the approval workflow

```bash run
mkdir -p n8n-approvals && cd n8n-approvals
IMAGE=n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-n8n -p 127.0.0.1:5678:5678 -e N8N_DIAGNOSTICS_ENABLED=false "$IMAGE" > /dev/null
N8N=http://127.0.0.1:5678
ready() { for i in $(seq 1 120); do curl -sf "$N8N/healthz/readiness" > /dev/null && return; sleep 1; done; }
ready
n8ncli() { docker exec -i -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n n8n "$@"; }
ledger_up() {
  docker exec -d devforge-n8n node -e '
    const http = require("node:http"), entries = [];
    http.createServer((req, res) => {
      let body = ""; req.on("data", (d) => (body += d)).on("end", () => {
        if (req.method === "POST") entries.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(entries));
      });
    }).listen(9000, "127.0.0.1");'
}
ledger() { docker exec devforge-n8n node -e "fetch('http://127.0.0.1:9000/').then((r) => r.json()).then((e) => e.forEach((x) => console.log(x.expense, '→', x.outcome)))"; }
ledger_up
docker exec -i devforge-n8n sh -c 'cat > /tmp/expense.json' <<'EOF'
{
  "id": "expense0000001",
  "name": "Expense approval",
  "nodes": [
    { "id": "e1", "name": "Request", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": "7a1d9c3e-1111-4d2b-8c51-3e6f2a0b9d01",
      "parameters": { "httpMethod": "POST", "path": "expense", "responseMode": "responseNode", "options": {} } },
    { "id": "e2", "name": "Answer requester", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [220, 0],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ status: 'waiting for approval', approve_url: $execution.resumeUrl }) }}", "options": { "responseCode": 202 } } },
    { "id": "e3", "name": "Wait for decision", "type": "n8n-nodes-base.wait", "typeVersion": 1.1, "position": [440, 0], "webhookId": "7a1d9c3e-2222-4d2b-8c51-3e6f2a0b9d02",
      "parameters": { "resume": "webhook", "httpMethod": "POST", "responseMode": "onReceived", "limitWaitTime": true,
                      "limitType": "afterTimeInterval", "resumeAmount": "={{ $('Request').item.json.body.wait_seconds }}", "resumeUnit": "seconds", "options": {} } },
    { "id": "e4", "name": "Decide", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0],
      "parameters": { "jsCode": "const request = $('Request').first().json.body;\nconst decision = $json.body?.decision ? $json.body : null;   // on a timeout the Wait node passes on the original request: no decision\nlet outcome;\nif (!decision) outcome = 'expired: escalated to the finance lead';\nelse if (decision.approver === request.requester) outcome = 'refused: requesters cannot approve their own expenses';\nelse outcome = `${decision.decision === 'approve' ? 'approved' : 'declined'} by ${decision.approver}`;\nreturn [{ json: { expense: `${request.requester}: ${request.amount}`, outcome } }];" } },
    { "id": "e5", "name": "Record in ledger", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [880, 0],
      "parameters": { "method": "POST", "url": "http://127.0.0.1:9000/", "sendBody": true, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}", "options": {} } }
  ],
  "connections": {
    "Request": { "main": [[{ "node": "Answer requester", "type": "main", "index": 0 }]] },
    "Answer requester": { "main": [[{ "node": "Wait for decision", "type": "main", "index": 0 }]] },
    "Wait for decision": { "main": [[{ "node": "Decide", "type": "main", "index": 0 }]] },
    "Decide": { "main": [[{ "node": "Record in ledger", "type": "main", "index": 0 }]] }
  },
  "settings": {}, "active": false
}
EOF
for i in $(seq 1 30); do n8ncli import:workflow --input=/tmp/expense.json > /dev/null 2>&1 && break; sleep 2; done
n8ncli publish:workflow --id=expense0000001 2>&1 | tail -n 1
# wait until the webhook is registered; a GET does not start an execution of this POST-only webhook
for i in $(seq 1 60); do curl -s "$N8N/webhook/expense" | grep 'POST' > /dev/null && break; sleep 1; done
curl -s "$N8N/webhook/expense"; echo
```

```text output
A running n8n applies this change shortly. If n8n is stopped, it applies the change when it starts.
…
```

- **Request** receives the expense; **Answer requester** replies at once with `202` and the execution's own resume URL.
- **Wait for decision** pauses until that URL is called — or until `wait_seconds` (taken from the request, so the lab can use short and long limits) have passed. On a timeout it passes on the item it received — the original request — so **Decide** recognises a timeout by the missing `decision`.
- **Decide** turns whatever arrived into one outcome: no decision means the limit ran out; an approver equal to the requester is refused; otherwise approved or declined, by whom. **Record in ledger** stores it.
- `publish:workflow` activates the workflow, and a running n8n picks the change up shortly. The `GET` probe shows when the webhook exists without starting an execution, because the webhook only accepts `POST`.

### 2. Three requests, three endings

```bash run
submit() { curl -s -X POST "$N8N/webhook/expense" -H 'Content-Type: application/json' -d "$1" | grep -o 'http[^"]*'; }
# the URL works once the execution has been saved as waiting; until then n8n answers 409 Conflict, so try again
decide() { for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$1" -H 'Content-Type: application/json' -d "$2")" = 200 ] && return; sleep 1; done; echo "decision not accepted: $1"; }
URL=$(submit '{"requester": "asha", "amount": 900, "wait_seconds": 600}')
decide "$URL" '{"decision": "approve", "approver": "priya"}'
URL=$(submit '{"requester": "ravi", "amount": 450, "wait_seconds": 600}')
decide "$URL" '{"decision": "approve", "approver": "ravi"}'
submit '{"requester": "meera", "amount": 120, "wait_seconds": 3}' > /dev/null    # nobody answers
for i in $(seq 1 60); do [ "$(ledger | wc -l)" -ge 3 ] && break; sleep 1; done
ledger | sort
```

```text output
asha: 900 → approved by priya
meera: 120 → expired: escalated to the finance lead
ravi: 450 → refused: requesters cannot approve their own expenses
```

- Asha's expense went to a different person, who approved it.
- Ravi tried to approve his own expense. The URL and its signature were valid — anyone holding the link can call it — so the **rule in the workflow** is what stopped him.
- Nobody answered Meera's request; after 3 seconds the Wait node resumed on its own, with no decision, and **Decide** escalated it. In production the limit would be hours or days, and escalation would notify a person.

### 3. A waiting approval survives a restart

```bash run
URL=$(submit '{"requester": "kiran", "amount": 300, "wait_seconds": 600}')
docker restart devforge-n8n > /dev/null; ready; ledger_up      # e.g. an upgrade while approvals are pending
decide "$URL" '{"decision": "decline", "approver": "priya"}'
for i in $(seq 1 60); do ledger | grep kiran > /dev/null && break; sleep 1; done
ledger
```

```text output
kiran: 300 → declined by priya
```

The execution was waiting when n8n restarted; it lived in n8n's database, not in memory, so the same URL still woke it afterwards. (The stand-in ledger lives in memory, so it starts empty again after the restart — a reminder that whatever *your* steps write to must be durable too.) This only holds while n8n's database is kept: in this lab it sits inside the container, which `docker restart` keeps; in production it belongs on a volume or in PostgreSQL (next lesson).

### 4. Clean up

```bash run
docker rm -f devforge-n8n > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **No time limit.** Requests wait forever, invisibly; set a limit and design the timeout branch.
- **Trusting the approver's identity from the request body.** Here the approver's name is simply sent along; a real system takes it from an authenticated login (an n8n form behind authentication, or a chat or email integration that knows the user).
- **Letting the requester receive the approval link.** Send it to approvers only; the four-eyes rule is the backstop, not the plan.
- **Doing the action before the decision.** Pause first, act after approval — never "refund now, ask later".
- **Waiting executions on a throw-away database.** A container replaced without its volume loses every pending approval.

## Where this fits in a real system

Approval steps gate refunds and payouts recorded in **PostgreSQL**, access requests that a **Terraform** or **Kubernetes** change will apply, and the high-impact tool calls of the AI agents in the next lessons. Escalations can open a ticket in **Jira**; approval and timeout events go to logs and metrics watched in **Grafana**.
