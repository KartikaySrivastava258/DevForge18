---
id: n8n-validation-and-errors
title: Validating input and handling errors
track: n8n
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [n8n-webhooks-and-expressions]
learning_objectives:
  - Route invalid input to its own branch with an If node and answer it with a clear error.
  - Catch a failing node with its error output instead of letting the whole execution fail.
  - Explain retries and error workflows, and when to use each.
resources:
  - title: n8n — handle errors gracefully
    url: https://docs.n8n.io/build/flow-logic/handle-errors-gracefully/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Error workflows with the Error Trigger, and handling errors inside a workflow.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n — work with nodes (node settings)
    url: https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Retry On Fail and On Error (Continue using error output).
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: validate-where
    prompt: Where should a webhook workflow check its input?
    options:
      - { id: a, text: "Right after the trigger, before anything acts on the data" }
      - { id: b, text: "At the end, before responding" }
      - { id: c, text: "Nowhere — callers are trusted" }
    answer: a
    explanation: Check first, then act. A bad request should be answered with a clear 400 before it reaches your database or other APIs.
  - id: error-output
    prompt: The seat service is down. With the HTTP Request node's On Error set to "Continue (using error output)", what happens?
    options:
      - { id: a, text: "The execution fails and the caller gets no useful answer" }
      - { id: b, text: "The error goes out of the node's error output, and that branch can answer the caller (here with 502) or alert someone" }
      - { id: c, text: "n8n retries forever" }
    answer: b
    explanation: You see it in the lesson. The error becomes data on a separate branch you design, instead of a failed execution.
  - id: retry-vs-error-workflow
    prompt: Which is the right tool for a brief network blip when calling an API?
    options:
      - { id: a, text: "Retry On Fail on that node" }
      - { id: b, text: "An error workflow" }
      - { id: c, text: "Deleting the node" }
    answer: a
    explanation: Retries handle temporary failures in place. An error workflow (starting with an Error Trigger) runs when an execution fails anyway — to alert someone, not to fix the blip.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with n8nio/n8n:2.49.6 (pinned by digest), after the previous lessons; the output shown was recorded from that run. The seat service is a three-line Node.js server started inside the container. Facts about node error settings and error workflows were checked against the n8n documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A robust workflow **validates** its input and sends bad requests down their own branch with a clear error, gives flaky steps **retries**, catches a failing node through its **error output**, and keeps an **error workflow** for anything that still fails.

## Explain it like I'm twelve

At a school sports-day sign-up desk, the helper first checks the form: name filled in? A real event? If not, the form goes back with a note saying what is wrong. If it is fine, the helper phones the coach to check there is space. If the coach does not answer, the helper does not just give up silently — they tell you "try again later".

Checking the form is **validation**, the note is the **error branch**, "try again later" comes from the **error output**, and telling the head teacher when everything goes wrong is the **error workflow**.

Where the analogy breaks: n8n can also simply call the coach again a few times by itself — retries.

## What problem it solves

Automations run unattended. Without validation, one bad request writes garbage into your systems; without error handling, one unreachable API fails the whole execution and the caller gets nothing useful. Designing the unhappy paths makes failures visible, explained and safe.

## How it works

![](media:n8n/error-branches.svg)

- An **If** node checks conditions and has two outputs: true and false. Here the false branch answers `400` with what was wrong.
- A node's **On Error** setting, **Continue (using error output)**, gives it a second output for errors, so a failure becomes an item you can route — here to a `502` answer.
- **Retry On Fail** reruns a failing node a set number of times, for temporary problems.
- An **error workflow**, chosen in a workflow's settings and starting with an **Error Trigger** node, runs when an execution fails — typically to alert someone.

## Try it yourself

> **Local lab** — continue with the `devforge-n8n` container, from inside `n8n-lab`, with `N8N`, `n8ncli` and `importwf` defined (lesson 1). Every command is run automatically in DevForge's tests.

### 1. A validated sign-up that checks for free seats

```bash run
importwf signup-v2.json <<'EOF'
{
  "id": "signup0000002",
  "name": "Course sign-up, validated",
  "nodes": [
    { "id": "v1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": "5f0c2a8e-2222-4c2b-9a51-2f6d1a0b7c02",
      "parameters": { "httpMethod": "POST", "path": "signup-v2", "responseMode": "responseNode", "options": {} } },
    { "id": "v2", "name": "Valid?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [220, 0],
      "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" }, "combinator": "and", "conditions": [
        { "id": "c1", "leftValue": "={{ $json.body.name }}", "rightValue": "", "operator": { "type": "string", "operation": "notEmpty", "singleValue": true } },
        { "id": "c2", "leftValue": "={{ ['docker', 'kafka', 'redis'].includes(($json.body.track || '').toLowerCase()) }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true", "singleValue": true } }
      ] }, "options": {} } },
    { "id": "v3", "name": "Check seats", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [440, -100], "onError": "continueErrorOutput",
      "parameters": { "url": "=http://127.0.0.1:8099/seats/{{ $json.body.track.toLowerCase() }}", "options": { "timeout": 2000 } } },
    { "id": "v4", "name": "Accepted", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [660, -160],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ status: 'accepted', seats_left: $json.free - 1 }) }}", "options": { "responseCode": 200 } } },
    { "id": "v5", "name": "Seat service down", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [660, -40],
      "parameters": { "respondWith": "json", "responseBody": "={\"error\": \"seat service unavailable, try again later\"}", "options": { "responseCode": 502 } } },
    { "id": "v6", "name": "Rejected", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [440, 120],
      "parameters": { "respondWith": "json", "responseBody": "={\"error\": \"name is required and track must be docker, kafka or redis\"}", "options": { "responseCode": 400 } } }
  ],
  "connections": {
    "Webhook": { "main": [[ { "node": "Valid?", "type": "main", "index": 0 } ]] },
    "Valid?": { "main": [[ { "node": "Check seats", "type": "main", "index": 0 } ], [ { "node": "Rejected", "type": "main", "index": 0 } ]] },
    "Check seats": { "main": [[ { "node": "Accepted", "type": "main", "index": 0 } ], [ { "node": "Seat service down", "type": "main", "index": 0 } ]] }
  },
  "settings": {}
}
EOF
n8ncli publish:workflow --id=signup0000002 2>&1 | tail -n 1
U="$N8N/webhook/signup-v2"
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U" -H 'Content-Type: application/json' -d '{}')" != 404 ] && break; sleep 1; done
```

```text output
Successfully imported 1 workflow.
A running n8n applies this change shortly. If n8n is stopped, it applies the change when it starts.
```

- **Valid?** is an If node: `name` must not be empty, and `track` must be one of three tracks. Its first output is "true", its second "false".
- **Check seats** asks a seat service over HTTP. Its `onError: continueErrorOutput` setting gives it a second, error output.
- Three **Respond to Webhook** nodes answer with `200`, `502` or `400`. The loop waits until the published webhook is registered.

### 2. Bad requests are rejected, with a reason

```bash run
for body in '{"name": "", "track": "Docker"}' '{"name": "Ravi", "track": "Cobol"}' '{"track": "Kafka"}'; do
  curl -s -w "  -> %{http_code}\n" -X POST "$U" -H 'Content-Type: application/json' -d "$body"
done
```

```text output
{"error":"name is required and track must be docker, kafka or redis"}  -> 400
{"error":"name is required and track must be docker, kafka or redis"}  -> 400
{"error":"name is required and track must be docker, kafka or redis"}  -> 400
```

All three took the If node's false branch and got `400` with an explanation — nothing else ran.

### 3. A valid request while the seat service is down

```bash run
curl -s -w "  -> %{http_code}\n" -X POST "$U" -H 'Content-Type: application/json' -d '{"name": "Asha", "track": "Docker"}'
```

```text output
{"error":"seat service unavailable, try again later"}  -> 502
```

Nothing listens on port 8099 yet, so **Check seats** failed. Because of its error output, the failure did not crash the execution: it went down the error branch, and the caller got a `502` with a useful message. Adding **Retry On Fail** to this node would make it try again a few times first.

### 4. Start the seat service, and try again

```bash run
docker exec -d devforge-n8n node -e "require('http').createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ free: 3 })); }).listen(8099, '127.0.0.1')"
for i in $(seq 1 30); do docker exec devforge-n8n wget -qO- http://127.0.0.1:8099/seats/docker > /dev/null 2>&1 && break; sleep 1; done
curl -s -w "  -> %{http_code}\n" -X POST "$U" -H 'Content-Type: application/json' -d '{"name": "Asha", "track": "Docker"}'
```

```text output
{"status":"accepted","seats_left":2}  -> 200
```

- `docker exec -d … node -e …` starts a tiny HTTP server inside the n8n container that always answers `{"free": 3}` — a stand-in for a real seat service.
- Now the happy path runs: valid input, the service answers, and the response uses its data (`seats_left`).

### 5. Clean up

This removes n8n, its database and every workflow in it:

```bash run
docker rm -f devforge-n8n
```

```text output
devforge-n8n
```

## Try it in the simulation

Run a batch of five form submissions through a similar workflow and see where every item ends up: saved, sent to the error workflow, or dropped without a trace. Then fix the workflow. It is a labelled teaching model, not a real n8n.

```simulation n8n-workflow-executor scenario=silent-drops
```

## Common mistakes

- **Validating after acting.** Check input right after the trigger, before writing anywhere.
- **Vague errors.** "Bad request" helps nobody; say which field is wrong and what is allowed.
- **Letting every failure fail the execution.** Decide per node: retry, route to an error branch, or stop.
- **Retrying everything.** Retries help with temporary failures; a validation error or a bug fails the same way every time.
- **No error workflow.** Without one, a failed execution in production may go unnoticed until someone complains.

## Where this fits in a real system

The same patterns appear everywhere in this course: validation before acting (like a **PostgreSQL** constraint), retries for temporary failures (**Airflow**), and a clear status code for every outcome (the APIs you test in **Postman**). Error workflows typically alert a chat channel, and **Prometheus** can watch n8n's own metrics in production.
