---
id: opentelemetry-trace-waterfall-investigation
title: Find the slow span and shorten the critical path
track: opentelemetry
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [otel-traces-spans-and-context, otel-collector-and-jaeger]
objectives:
  - Read a trace waterfall and find the span that spends the most time on its own work.
  - Explain the critical path, and why speeding up a span off it does not make the request faster.
  - Compare sequential and parallel calls, and a cache hit with a miss, by their traces.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the waterfall" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: opentelemetry-trace-waterfall
  challenges: [find-the-slow-span, checkout-under-150ms]
resources:
  - title: OpenTelemetry documentation
    url: https://opentelemetry.io/docs/
    publisher: OpenTelemetry Authors
    type: documentation
    level: all
    official: true
    why: Concepts (signals, context propagation) and per-language guides.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with fixed durations chosen for teaching, not measurements. Its spans have parent IDs, start and end times — the same shape the OpenTelemetry lessons send to a Collector and Jaeger — and its trace and span IDs use the real format (32 and 16 hexadecimal characters). Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the trace-waterfall simulation like a scientist: **predict** where a request spends its time, **send** a request, and **compare** with the waterfall. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a traced system, not OpenTelemetry itself; the lessons *Traces, spans and context* and *The Collector pipeline and Jaeger* show real spans from instrumented services, and Jaeger drawing them as a waterfall.

## Steps

### 1. Find the slow span

Choose the scenario **Checkout is slow**. One request has been traced already, and something added 300 ms somewhere. Before you click anything, write down:

- A parent span's bar includes the time of all its children. So is the longest bar the culprit?
- What does **own** time mean for a span with children, and for a span with none?

Read each row: its total time, its **own** time and whether it is marked **critical path**. Select the span you think is doing the slow work, and read the event log.

- If you were wrong, which number misled you?
- Which service would you investigate first in a real system, and why?

### 2. Checkout under 150 ms

Choose **A slow database**. Each database query now takes 125 ms, and the API calls the database and the payment service one after the other. You may not change the database's latency.

- Press **Send a checkout request** and read the total. Where does the payment call start: before or after the database call ends?
- The database and payment calls do not depend on each other. What would the total be if they overlapped? Work it out from the span times before you try.
- What would happen to the database span if the cart were already in the cache?

Change one setting with **Cache** or **Database and payment calls**, predict the new total, and send a request. Compare it with the earlier totals shown above the waterfall. Then reset and try the other setting.

For a contrast, choose **A healthy checkout** and set the calls to run in parallel. Send a request and note which call is marked **critical path**. Then predict: if you add 50 ms to the database, does the total change, and by how much? Send another request and check.

## Simulation

```simulation opentelemetry-trace-waterfall
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

A long bar in a waterfall is not always the slow part: a parent's time includes its children, so you look for the span with the most time of its own. Only the spans on the critical path decide the total, which is why running independent calls in parallel, or skipping one with a cache hit, can shorten a request when tuning another span does not.
