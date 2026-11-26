---
id: postman-status-codes-and-sessions
title: Read status codes and chain requests with a session
track: postman
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [postman-http-basics, postman-sessions-and-tests]
objectives:
  - Predict the status code of a request from its method, CSRF header, cookie and body, then check it.
  - Explain the difference between 400, 401, 403 and 404 from the answers you collect.
  - Chain requests — sign in, act, read back — by sending the session cookie.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each request and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: postman-request-builder
  challenges: [bookmark-saved, four-codes]
resources:
  - title: Get started in Postman
    url: https://learning.postman.com/docs/getting-started/overview/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Official starting point for sending requests and reading responses in Postman.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model of a small part of DevForge's own API, not live requests. Its status codes and error codes follow DevForge's real API and its tests. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the request builder like a scientist: **predict** the status code, **send** the request, and **compare** with the response and the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of DevForge's API, not live requests; the lessons *HTTP requests and responses* and *Sessions, chained requests and API tests* send the real requests with curl and Postman.

## Steps

### 1. Bookmark the Kafka track

Choose the scenario **Not signed in yet**. You have the test account but no session. Before every request, write down the status code you expect and why.

- Choose `GET /api/me/bookmarks` in **Request** and press **Send**. Is this data public or personal? What does the server need to know first?
- Signing in is a write. What must every write carry? Predict what happens without it, then check.
- After a successful sign-in, look at **Session cookie** at the top. What must you tick so that later requests prove who you are?

Now bookmark the Kafka track and read your bookmarks back. Which **Body** does each request need, if any? The explanation for a successful bookmark says something about sending it twice; why is that safe?

### 2. Collect four codes

Stay on **Not signed in yet** (press **Reset** for a fresh start). The goal is a 401, a 403 and a 404, and then a write that succeeds with 200 OK. Before each request, predict its code:

- Which request asks for something personal, so that it fails without a session? Is there a second way to get a 401?
- Which write fails because the **X-DevForge-CSRF header** is missing?
- Which URL names something that does not exist?

Read each explanation in the event log. Then make a write succeed. Note that signing out answers 204 No Content: that is a success too, but this challenge asks for a 200. What would make the server answer 400 instead?

## Simulation

```simulation postman-request-builder
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state. Your verified challenges stay recorded.

## What you practised

Every status code is a clue. 401 asks "who are you?", 403 says "not allowed like that", 404 says "nothing is here" and 400 says "I cannot read your request". A session cookie from signing in, sent with each personal request, lets a stateless API recognise you across a chain of requests.
