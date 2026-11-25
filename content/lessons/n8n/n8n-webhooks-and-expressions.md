---
id: n8n-webhooks-and-expressions
title: Webhooks and expressions
track: n8n
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [n8n-workflows-nodes-and-items]
learning_objectives:
  - Start a workflow from an HTTP request with the Webhook node, and answer it with Respond to Webhook.
  - Map incoming data to new fields with expressions.
  - Publish a workflow so its production webhook URL is live.
resources:
  - title: n8n — Webhook node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Test and production webhook URLs, response modes and options.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n — Respond to Webhook node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Choosing the response body and code from inside the workflow.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n — save and publish workflows
    url: https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: What publishing does in n8n 2 (it replaced the active/inactive toggle).
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: publish
    prompt: You imported a webhook workflow and called /webhook/signup, but got 404. What is missing?
    options:
      - { id: a, text: "The workflow is not published, so its production webhook is not registered" }
      - { id: b, text: "n8n needs a restart after every change" }
      - { id: c, text: "Webhooks only accept GET" }
    answer: a
    explanation: n8n registers a production webhook when you publish the workflow. In n8n 2, publishing replaced the old active/inactive toggle.
  - id: expression
    prompt: What does the expression {{ $json.body.track.toLowerCase() }} produce for a request with {"track":"Docker"}?
    options:
      - { id: a, text: "\"Docker\"" }
      - { id: b, text: "\"docker\" — $json is the current item, body is the request body, and toLowerCase() runs on the string" }
      - { id: c, text: "An error" }
    answer: b
    explanation: You see this exact result in the lesson's response.
  - id: trust
    prompt: Anyone who knows your production webhook URL can call it. What should you do?
    options:
      - { id: a, text: "Nothing — the URL is secret enough" }
      - { id: b, text: "Use the Webhook node's authentication options or a signature check, validate the input, and serve it over HTTPS" }
      - { id: c, text: "Change the URL every day" }
    answer: b
    explanation: A webhook is a public entry point. Authenticate callers, validate everything they send (next lesson), and use HTTPS.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with n8nio/n8n:2.49.6 (pinned by digest), after the previous lesson; the output shown was recorded from that run. Facts about webhooks, responses and publishing were checked against the n8n documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **Webhook** node gives a workflow its own URL: an HTTP request to it starts an execution with the request as the first item, **expressions** such as `{{ $json.body.name }}` pull values out of items, and a **Respond to Webhook** node sends the answer back to the caller.

## Explain it like I'm twelve

The workflow gets its own letterbox. When someone posts a letter (a request), the workflow wakes up, reads the letter, fills in a reply form by copying bits of the letter onto it, and posts the reply straight back.

The letterbox is the **webhook**, copying bits of the letter is what **expressions** do, and posting the reply is **Respond to Webhook**.

Where the analogy breaks: the letterbox only exists once the workflow is **published** — before that, letters bounce (404).

## What problem it solves

Most apps can call a URL when something happens: a form is submitted, a payment succeeds, a pull request is opened. A webhook lets n8n react to those events immediately — no polling — and answer the caller with a result, which turns a workflow into a small API.

## How it works

```diagram steps=n8n/webhook-run
```

- The Webhook node listens on a path, here `POST /webhook/signup`. n8n registers this production URL when the workflow is **published**.
- The request becomes the first item: its body under `body`, plus headers and query.
- An **Edit Fields (Set)** node builds new fields with expressions; inside `{{ }}`, `$json` is the current item's data.
- With the Webhook node's response mode set to use a Respond to Webhook node, that node decides the response body and status code.

## Try it yourself

> **Local lab** — continue with the `devforge-n8n` container from the previous lesson, from inside `n8n-lab`, with `N8N`, `n8ncli` and `importwf` defined (steps 1–2 of the previous lesson). Every command is run automatically in DevForge's tests.

### 1. A sign-up workflow with a webhook

```bash run
importwf signup.json <<'EOF'
{
  "id": "signup0000001",
  "name": "Course sign-up",
  "nodes": [
    { "id": "w1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": "5f0c2a8e-1111-4c2b-9a51-2f6d1a0b7c01",
      "parameters": { "httpMethod": "POST", "path": "signup", "responseMode": "responseNode", "options": {} } },
    { "id": "w2", "name": "Shape", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [220, 0],
      "parameters": { "assignments": { "assignments": [
        { "id": "a1", "name": "student", "value": "={{ $json.body.name.trim() }}", "type": "string" },
        { "id": "a2", "name": "track", "value": "={{ $json.body.track.toLowerCase() }}", "type": "string" },
        { "id": "a3", "name": "message", "value": "=Welcome, {{ $json.body.name.trim() }}! You joined {{ $json.body.track }}.", "type": "string" }
      ] }, "options": {} } },
    { "id": "w3", "name": "Reply", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [440, 0],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}", "options": {} } }
  ],
  "connections": {
    "Webhook": { "main": [[ { "node": "Shape", "type": "main", "index": 0 } ]] },
    "Shape": { "main": [[ { "node": "Reply", "type": "main", "index": 0 } ]] }
  },
  "settings": {}
}
EOF
curl -s -o /dev/null -w "before publishing: %{http_code}\n" -X POST "$N8N/webhook/signup"
```

```text output
Successfully imported 1 workflow.
before publishing: 404
```

- **Webhook** listens for `POST` on the path `signup` and leaves the answer to a Respond to Webhook node (`responseMode: responseNode`).
- **Shape** is an Edit Fields node with three fields built by expressions — `trim()` removes spaces, `toLowerCase()` lowers the case, and plain text around `{{ }}` builds a message.
- **Reply** answers with the current item as JSON.
- Imported workflows are not published, so the URL does not exist yet: 404.

### 2. Publish it, and call it

```bash run
n8ncli publish:workflow --id=signup0000001 2>&1 | tail -n 1
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$N8N/webhook/signup" -H 'Content-Type: application/json' -d '{"name":"x","track":"y"}')" = 200 ] && break; sleep 1; done
curl -s -X POST "$N8N/webhook/signup" -H 'Content-Type: application/json' -d '{"name": "  Asha ", "track": "Docker"}'; echo
```

```text output
A running n8n applies this change shortly. If n8n is stopped, it applies the change when it starts.
{"student":"Asha","track":"docker","message":"Welcome, Asha! You joined Docker."}
```

- Publishing makes the workflow live; the running n8n picks the change up within seconds, so the loop waits until the webhook answers.
- The response was built by the expressions: `"  Asha "` became `"Asha"`, `"Docker"` became `"docker"` in `track` but stayed as sent in the message.

### 3. Every request is an execution

```bash run
for name in Ravi Meera; do
  curl -s -X POST "$N8N/webhook/signup" -H 'Content-Type: application/json' -d "{\"name\": \"$name\", \"track\": \"Kafka\"}"; echo
done
```

```text output
{"student":"Ravi","track":"kafka","message":"Welcome, Ravi! You joined Kafka."}
{"student":"Meera","track":"kafka","message":"Welcome, Meera! You joined Kafka."}
```

Each request started its own execution and got its own answer. In the n8n editor (<http://localhost:5678>), the workflow's **Executions** tab lists every one with the data each node saw — the first place to look when something goes wrong. This step's browser part is not in the automatic tests.

**Keep the container running** for the next lesson.

## Common mistakes

- **Testing with the production URL before publishing** (or the test URL after). The editor's test URL only listens while you are testing; the production URL only exists for a published workflow.
- **Trusting the request body.** Anyone who can reach the URL can send anything; validate it (next lesson).
- **Expressions that assume a field exists.** `$json.body.name.trim()` fails when `name` is missing; check first or use a default.
- **Responding before the work is done** when the caller needs the result — or holding the caller for slow work when it does not. Choose the response mode on purpose.

## Where this fits in a real system

Forms, payment providers and **GitHub** call n8n webhooks; n8n calls other APIs and stores results in **PostgreSQL**. In production it sits behind **Nginx** for HTTPS, and callers should authenticate — the same rules as any API you test in **Postman**.
