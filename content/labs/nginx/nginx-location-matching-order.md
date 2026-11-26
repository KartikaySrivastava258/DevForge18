---
id: nginx-location-matching-order
title: Route requests with location matching
track: nginx
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [nginx-serving-static-files, nginx-location-matching]
objectives:
  - Predict which location block answers a request, then check it against the steps Nginx takes.
  - Explain why the order of prefix locations in the file never matters, while the order of regular expressions does.
  - Use ^~ and exact matches to route paths that a regular expression would otherwise catch.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each request and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: nginx-location-matcher
  challenges: [docs-static, health-exact]
resources:
  - title: ngx_http_core_module — location
    url: https://nginx.org/en/docs/http/ngx_http_core_module.html#location
    publisher: Nginx
    type: documentation
    level: intermediate
    official: true
    why: The matching order, and the meaning of =, ^~, ~ and ~*.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model. Its matching order follows the Nginx documentation for the location directive (exact match, longest prefix, ^~, then regular expressions in file order), and its answers for the lesson's configuration are tested against those real Nginx 1.24 gave in the lesson. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the location matcher like a scientist: **predict** which location answers each path, **send** the request, and **compare** with the steps Nginx takes. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of Nginx's matching order, not a running server; the lesson *Location matching rules in depth* shows the same decisions made by real Nginx.

## Steps

### 1. Docs are static, the API is not

Choose the scenario **API docs as static files**. Read the server block: the app handles `/`, the API handles `/api/`, and a regular expression sends `.html` pages to the app. Before you send anything, write down where each of these paths should go and where you think it will go now:

- `/api/docs/index.html` and `/api/docs/logo.png` (should be static)
- `/api/v1/users` and `/api/v1/report.json` (should reach the API)
- `/` (should reach the app)

Type each path into **Request path** and press **Send request**. Read the steps under the answer: which prefix was remembered, and did a regular expression win?

Now change the server block with **Add a location**, **Remove** and the **↑** (move up) buttons. Before each request, ask: once the longest prefix is found, which rule is checked next, and what can stop that check? If Nginx refuses a location as a duplicate, read why. Does moving a prefix location up the file change any answer?

To explore further, the scenario **The lesson's seven locations** holds the configuration from the lesson. Try moving its regular expressions and send the same paths again.

### 2. An exact health check

Choose **A health check**. A load balancer will ask for `/health` every few seconds.

- Which location answers `/health` now? And `/healthz`?
- Which modifier matches one URI exactly and ends the search at once?

Add a location and send `/health`, `/healthz` and `/api/v1/users` again. Did only `/health` change?

## Simulation

```simulation nginx-location-matcher
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state. Your verified challenges stay recorded.

## What you practised

Nginx picks exactly one location for each request, in a fixed order: an exact match, then the longest prefix, then regular expressions in file order unless the prefix has `^~`. Reading those steps turns "why did this request go there?" from guesswork into a rule you can check.
