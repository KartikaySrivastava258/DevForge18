---
id: prometheus-rate-and-percentile-queries
title: Query request rates and latency percentiles
track: prometheus-grafana
level: intermediate
mode: simulation
estimated_minutes: 35
prerequisites: [prometheus-metrics-and-labels, prometheus-scraping-and-promql]
objectives:
  - Predict, then check, how a counter reset affects rate(sum(...)) and sum(rate(...)).
  - Explain how the scrape interval and the query range decide whether rate() has any data.
  - Build one 95th-percentile latency for a whole service from histogram buckets, keeping the le label.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the query result" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: prometheus-scrape-and-rate
  challenges: [total-survives-restart, rate-with-short-window, p95-for-the-service]
resources:
  - title: Query functions
    url: https://prometheus.io/docs/prometheus/latest/querying/functions/
    publisher: Prometheus Authors
    type: reference
    level: intermediate
    official: true
    why: rate(), histogram_quantile() and the rule to take a rate first, then aggregate.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Metric types
    url: https://prometheus.io/docs/concepts/metric_types/
    publisher: Prometheus Authors
    type: documentation
    level: beginner
    official: true
    why: Defines counters, gauges, histograms and summaries, including how histogram buckets are exposed.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model; unlike real rate(), it does not extrapolate to the edges of the range, so its answers are slightly lower than Prometheus's. Its counter-reset rule for rate() and the linear interpolation in histogram_quantile() follow the Prometheus documentation. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the scrape-and-rate simulation like a scientist: **predict** what a query will return, **run** time forward with **Step**, and **compare** with the result Prometheus would give. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of Prometheus, not a Prometheus server; the lessons *Metrics, labels and the /metrics endpoint* and *Running Prometheus — scraping and your first PromQL* show the same queries against a real Prometheus.

## Steps

### 1. A total that survives a restart

Choose the scenario **Two instances, one total**. The two instances receive 10 and 5 requests per second, so the true total is 15. The query uses `rate(sum(...))`. Before you touch anything, write down:

- Right now, with no restarts, does `rate(sum(...))` give the right total?
- If one instance restarts, its counter starts again from 0. What does the **summed** counter do at that moment, and how will `rate()` read that drop?

Restart one instance, press **Step** a few times, and read the result after each step. Then change the **Query** and compare.

- Which order handles each instance's restart on its own, and why?
- How long does the wrong answer last? (Think about the query's **Range**.)

The challenge checks the result while the restart is still inside the range, so do not wait too long before you compare.

### 2. A rate over 30 seconds

Choose **Scraping once a minute**. Prometheus scrapes every 60 s, and someone wants a rate over the last 30 seconds.

- How many samples does `rate()` need inside the range to give an answer?
- With one scrape a minute, how many samples can ever fall inside a 30-second range?

Set the **Range** to 30s and read the result. Then change the **Scrape interval**, predict how many steps you need before the result appears, and press **Step** until it does.

- Was the original 1m range enough with a 60 s interval? Look at the result before you change anything.

### 3. One 95th percentile for the whole service

Choose **Latency from histograms**. The query gives one 95th percentile per instance, and devforge-2 is slower.

- `histogram_quantile()` reads bucket bounds from the `le` label. What happens if an aggregation removes it?
- Which labels must the sum keep to give one percentile for both instances together?

Try each option in **Aggregation** and predict the result before you choose it. Compare the single service-wide value with the two per-instance values: should it lie between them?

## Simulation

```simulation prometheus-scrape-and-rate
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

Prometheus only knows the samples it scraped, so the scrape interval and the range decide whether `rate()` has anything to compare. Taking `rate()` first and summing afterwards keeps a restart from looking like a huge drop, and `histogram_quantile()` needs the `le` label kept in any aggregation.
