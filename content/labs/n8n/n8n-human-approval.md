---
id: n8n-human-approval
title: Require human approval before a consequential action
track: n8n
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [n8n-webhooks-and-expressions]
objectives:
  - Pause a workflow with a Wait node until a person approves or declines, using the execution's resume URL.
  - Answer the requester at once, while the execution keeps waiting.
  - Show that the resume URL is signed, single-use and tied to one execution.
checkpoints:
  - { id: paused, text: "A refund over 100 was answered with 202 and an approval URL, and nothing was refunded yet" }
  - { id: resumed, text: "Approving and declining each produced the right outcome, with the approver's name" }
  - { id: protected, text: "A tampered URL was refused with 401, and a reused one with 409" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: n8n — Wait node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: The resume modes, and how $execution.resumeUrl is generated for each execution.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: n8n — Respond to Webhook node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: Answering the webhook caller from a chosen point in the workflow.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with n8nio/n8n:2.49.6 (pinned by digest) in Docker, after the previous lessons, and their output is compared with this page; execution numbers and signatures change on every run and are shown as …. The Wait node's resume URL was checked against n8n's documentation on 2026-11-26. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Automation is good at small, frequent decisions — and dangerous for large, rare ones. You build a refund workflow that pays small refunds automatically, but **stops** before any refund over 100 until a person approves it. The requester gets an answer at once; the approver gets a link that works once, for that refund only.

## Before you start

Continue from *Webhooks and expressions*: n8n running in the container `devforge-n8n`, your terminal in `n8n-lab`, and `N8N`, `n8ncli` and `importwf` defined (define them again from the first lesson if you opened a new terminal). No money moves: "refunded" is just the workflow's answer.

## Steps

### 1. A refund workflow with an approval step

```bash run
importwf refund.json <<'EOF'
{
  "id": "refund000000001",
  "name": "Refund with approval",
  "nodes": [
    { "id": "r1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": "5f0c2a8e-3333-4c2b-9a51-2f6d1a0b7c03",
      "parameters": { "httpMethod": "POST", "path": "refund", "responseMode": "responseNode", "options": {} } },
    { "id": "r2", "name": "Over 100?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [220, 0],
      "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" }, "combinator": "and", "conditions": [
        { "id": "c1", "leftValue": "={{ $json.body.amount }}", "rightValue": 100, "operator": { "type": "number", "operation": "gt" } }
      ] }, "options": {} } },
    { "id": "r3", "name": "Ask for approval", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [440, -100],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ status: 'waiting for approval', approve_url: $execution.resumeUrl }) }}", "options": { "responseCode": 202 } } },
    { "id": "r4", "name": "Wait for decision", "type": "n8n-nodes-base.wait", "typeVersion": 1.1, "position": [660, -100], "webhookId": "5f0c2a8e-4444-4c2b-9a51-2f6d1a0b7c04",
      "parameters": { "resume": "webhook", "httpMethod": "POST", "responseMode": "lastNode", "options": {} } },
    { "id": "r5", "name": "Approved?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [880, -100],
      "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" }, "combinator": "and", "conditions": [
        { "id": "c2", "leftValue": "={{ $json.body.decision }}", "rightValue": "approve", "operator": { "type": "string", "operation": "equals" } }
      ] }, "options": {} } },
    { "id": "r6", "name": "Refund", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [1100, -160],
      "parameters": { "assignments": { "assignments": [
        { "id": "a1", "name": "status", "value": "refunded", "type": "string" },
        { "id": "a2", "name": "amount", "value": "={{ $('Webhook').item.json.body.amount }}", "type": "number" },
        { "id": "a3", "name": "approved_by", "value": "={{ $json.body.approver }}", "type": "string" }
      ] }, "options": {} } },
    { "id": "r7", "name": "Declined", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [1100, -40],
      "parameters": { "assignments": { "assignments": [
        { "id": "a4", "name": "status", "value": "declined", "type": "string" },
        { "id": "a5", "name": "declined_by", "value": "={{ $json.body.approver }}", "type": "string" }
      ] }, "options": {} } },
    { "id": "r8", "name": "Refund automatically", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [440, 100],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ status: 'refunded automatically', amount: $json.body.amount }) }}", "options": { "responseCode": 200 } } }
  ],
  "connections": {
    "Webhook": { "main": [[ { "node": "Over 100?", "type": "main", "index": 0 } ]] },
    "Over 100?": { "main": [[ { "node": "Ask for approval", "type": "main", "index": 0 } ], [ { "node": "Refund automatically", "type": "main", "index": 0 } ]] },
    "Ask for approval": { "main": [[ { "node": "Wait for decision", "type": "main", "index": 0 } ]] },
    "Wait for decision": { "main": [[ { "node": "Approved?", "type": "main", "index": 0 } ]] },
    "Approved?": { "main": [[ { "node": "Refund", "type": "main", "index": 0 } ], [ { "node": "Declined", "type": "main", "index": 0 } ]] }
  },
  "settings": {}
}
EOF
n8ncli publish:workflow --id=refund000000001 2>&1 | tail -n 1
U="$N8N/webhook/refund"
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U" -H 'Content-Type: application/json' -d '{"amount":1}')" != 404 ] && break; sleep 1; done
```

```text output
Successfully imported 1 workflow.
A running n8n applies this change shortly. If n8n is stopped, it applies the change when it starts.
```

Read the path a big refund takes:

- **Over 100?** sends amounts above 100 to the approval branch; everything else to **Refund automatically**.
- **Ask for approval** answers the caller *now*, with `202 Accepted` and `$execution.resumeUrl` — the URL that will wake this particular execution up. The workflow does not stop there: it carries on to the next node.
- **Wait for decision** pauses the execution until someone sends a `POST` to that URL. Its `responseMode: lastNode` answers the approver with the result of the last node that runs.
- **Approved?** reads the decision from the approver's request, and **Refund** or **Declined** records the outcome — including who decided.

In a real system, the approval URL would go to an approver by email or chat, not back to the requester. n8n also offers "send and wait" operations in some messaging nodes for exactly this.

### 2. A small refund goes straight through

```bash run
curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"order": "o1", "amount": 40}'; echo
```

```text output
{"status":"refunded automatically","amount":40}
```

### 3. A large refund waits for a person

```bash run
reply=$(curl -s -w ' %{http_code}' -X POST "$U" -H 'Content-Type: application/json' -d '{"order": "o2", "amount": 250}')
echo "$reply"
APPROVE=$(echo "$reply" | grep -o '"approve_url":"[^"]*"' | cut -d'"' -f4)
```

```text output
{"status":"waiting for approval","approve_url":"http://localhost:5678/webhook-waiting/…?signature=…"} 202
```

The execution is now **waiting**: nothing is refunded until the URL is called. The number in the path is the execution's ID, and `signature=…` is a token n8n checks on every call.

### 4. The approver decides

```bash run
sleep 1
curl -s -X POST "$APPROVE" -H 'Content-Type: application/json' -d '{"decision": "approve", "approver": "priya"}'; echo
```

```text output
{"status":"refunded","amount":250,"approved_by":"priya"}
```

The waiting execution resumed, took the approved branch and refunded the amount from the *original* request — `$('Webhook').item.json.body.amount` reaches back to the first node's data.

### 5. The URL cannot be forged or reused

```bash run
echo "same URL again: $(curl -s -o /dev/null -w '%{http_code}' -X POST "$APPROVE" -H 'Content-Type: application/json' -d '{"decision": "approve"}')"
reply=$(curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"order": "o3", "amount": 900}')
NEXT=$(echo "$reply" | grep -o '"approve_url":"[^"]*"' | cut -d'"' -f4)
sleep 1
echo "forged signature: $(curl -s -w ' %{http_code}' -X POST "${NEXT%%signature=*}signature=0000" -H 'Content-Type: application/json' -d '{"decision": "approve", "approver": "mallory"}')"
echo "real decision: $(curl -s -X POST "$NEXT" -H 'Content-Type: application/json' -d '{"decision": "decline", "approver": "priya"}')"
```

```text output
same URL again: 409
forged signature: {"error":"Invalid token"} 401
real decision: {"status":"declined","declined_by":"priya"}
```

- The first approval finished that execution, so its URL now answers `409 Conflict`: one decision per request.
- Changing the signature, or leaving it out, is refused with `401`. Only someone who was given the real URL can decide.
- The genuine decision on the second refund was **decline**, and the workflow said so.

## Check your work

Run this inside `n8n-lab` while n8n is running. It sends its own refund requests and checks every path.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
U=http://127.0.0.1:5678/webhook/refund
post() { curl -s -X POST "$1" -H 'Content-Type: application/json' -d "$2"; }
check "n8n is running" 'curl -sf http://127.0.0.1:5678/healthz'
check "a refund of 40 is made automatically" 'post "$U" "{\"amount\": 40}" | grep -q "\"status\":\"refunded automatically\""'
url=$(post "$U" '{"amount": 500}' | grep -o '"approve_url":"[^"]*"' | cut -d'"' -f4)
check "a refund of 500 waits for approval with a signed URL" 'echo "$url" | grep -q "signature="'
sleep 1
check "a forged signature is refused" '[ "$(curl -s -o /dev/null -w "%{http_code}" -X POST "${url%%signature=*}signature=0000" -H "Content-Type: application/json" -d "{}")" = 401 ]'
check "approving refunds it and records the approver" 'post "$url" "{\"decision\": \"approve\", \"approver\": \"check\"}" | grep -q "\"approved_by\":\"check\""'
check "the approval URL cannot be used twice" '[ "$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" -H "Content-Type: application/json" -d "{}")" = 409 ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: n8n is running
PASS: a refund of 40 is made automatically
PASS: a refund of 500 waits for approval with a signed URL
PASS: a forged signature is refused
PASS: approving refunds it and records the approver
PASS: the approval URL cannot be used twice
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-n8n
```

```text output
devforge-n8n
```

## Reset

Remove the container (as above), start n8n again with steps 1 and 2 of *Workflows, nodes and items*, and begin this lab at step 1.

## What you practised

A human-in-the-loop step is a pause with a key: the Wait node stops one execution, `$execution.resumeUrl` is the signed, single-use key to continue it, and the decision — with who made it — becomes part of the workflow's record. Put such steps in front of anything costly or irreversible.
