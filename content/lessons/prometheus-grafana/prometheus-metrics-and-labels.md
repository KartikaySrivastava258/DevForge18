---
id: prometheus-metrics-and-labels
title: Metrics, labels and the /metrics endpoint
track: prometheus-grafana
order: 1
level: beginner
estimated_minutes: 30
prerequisites: []
learning_objectives:
  - Read the Prometheus text format that an application exposes at /metrics.
  - Tell counters, gauges and histograms apart, and say what each is for.
  - Explain why every distinct set of labels is a separate time series, and why that limits what labels may hold.
resources:
  - title: Metric types
    url: https://prometheus.io/docs/concepts/metric_types/
    publisher: Prometheus Authors
    type: documentation
    level: beginner
    official: true
    why: Defines counters, gauges, histograms and summaries, including how histogram buckets are exposed.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Exposition formats
    url: https://prometheus.io/docs/instrumenting/exposition_formats/
    publisher: Prometheus Authors
    type: reference
    level: intermediate
    official: true
    why: The exact text format an application serves at /metrics, line by line.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Metric and label naming
    url: https://prometheus.io/docs/practices/naming/
    publisher: Prometheus Authors
    type: documentation
    level: beginner
    official: true
    why: Naming conventions (the _total suffix, base units) and the warning against high-cardinality labels.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: counter-drop
    prompt: A graph of devforge_http_requests_total suddenly drops from 5,000 to 12. What is the most likely explanation?
    options:
      - { id: a, text: "Traffic fell by 99% in one second" }
      - { id: b, text: "The process restarted: a counter only goes up, except that it resets to zero when the process restarts" }
      - { id: c, text: "Prometheus deleted old requests to save space" }
    answer: b
    explanation: A counter can only increase or reset to zero on restart. That is why you rarely graph a raw counter; PromQL's rate() looks at how fast it rises and treats a drop as a reset.
  - id: gauge-or-counter
    prompt: You want to expose how many learners are signed in right now. Which metric type fits?
    options:
      - { id: a, text: "A counter, because it counts learners" }
      - { id: b, text: "A gauge, because the number goes up and down" }
      - { id: c, text: "A histogram, because it is about users" }
    answer: b
    explanation: A gauge is a value that can go up and down, such as memory in use or active sessions. A counter must never decrease, so it cannot represent people signing out.
  - id: cardinality
    prompt: A teammate suggests adding a user_email label to devforge_http_requests_total so you can see requests per user. What is the problem?
    options:
      - { id: a, text: "Label values cannot contain the @ character" }
      - { id: b, text: "Every distinct label combination is a new time series, so thousands of users means thousands of series to store and query — an unbounded set that Prometheus warns against" }
      - { id: c, text: "Prometheus only allows three labels per metric" }
    answer: b
    explanation: Labels multiply time series. The naming guide warns against unbounded label values such as user IDs or email addresses. Per-user detail belongs in logs or traces, not in metric labels.
  - id: count-vs-bucket
    prompt: The /metrics output shows a histogram with _count 40 and the bucket le="0.1" at 38. What does that tell you?
    options:
      - { id: a, text: "38 of the 40 requests took 0.1 seconds or less" }
      - { id: b, text: "38 requests took exactly 0.1 seconds" }
      - { id: c, text: "The average request took 0.1 seconds" }
    answer: a
    explanation: Buckets are cumulative — each counts every observation less than or equal to its le bound — so 2 of the 40 requests took longer than 0.1 seconds. The average needs _sum divided by _count.
verification:
  method: executed
  details: Every command is run by the test suite against a real DevForge server started for the lesson, and the output shown was recorded from that run. Facts about metric types and naming were checked against the Prometheus documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **metric** is a number that an application keeps up to date — how many requests it has handled, how long they took, how much memory it uses — and publishes as plain text at `/metrics`, so that a monitoring system can read it again and again.

## Explain it like I'm twelve

Think of the meters in a house: the electricity meter counts up all year, and the thermometer goes up and down with the weather. Nobody watches them all day. Instead, someone writes down every meter reading at regular intervals, and from that notebook you can draw a graph of how much electricity was used each day.

Your application keeps the meters; **Prometheus** is the person with the notebook, visiting every few seconds.

Where the analogy breaks: a real meter reader would notice if the meter were replaced. Prometheus only sees numbers, so when an application restarts and its counters start again from zero, PromQL has to treat the drop as a reset.

## What problem it solves

Logs tell you what happened to one request; they are slow and expensive to add up across millions of requests. Metrics are already added up inside the application: one number per kind of event. They are cheap to collect every few seconds, so you can see at a glance whether a service is getting slower, failing more often or running out of memory — and alert on it before users complain.

## How it works

An application exposes its metrics over HTTP in a simple text format. Each line is one **sample**: a metric name, optional **labels** in braces, and a value.

![](media:prometheus-grafana/metric-line.svg)

The labels matter: Prometheus stores each unique combination of name and labels as its own **time series**. `status="200"` and `status="404"` are two series of the same metric.

There are three metric types you will meet everywhere:

- **Counter** — only goes up (or resets to zero when the process restarts). Requests handled, errors, bytes sent. By convention its name ends in `_total`.
- **Gauge** — goes up and down. Memory in use, queue length, temperature.
- **Histogram** — counts observations into **buckets** (how many requests took at most 5 ms, at most 10 ms, …), plus their sum and count, so you can work out percentiles later.

Values use **base units**: seconds, not milliseconds; bytes, not megabytes.

## Try it yourself

> **Local lab** — DevForge exposes its own metrics, so it is the application you will inspect. In one terminal, go to your DevForge folder and run `npm start`; leave it running. Use a second terminal for the commands below (on Windows, Git Bash). Every command is run automatically in DevForge's tests against a fresh DevForge server, so if you have already been browsing your own copy, your counters will be higher than the ones shown.

Store DevForge's address in a variable:

```bash
API=http://localhost:8080
```

`/metrics` is only answered for requests from your own computer or a private network, so that the outside world cannot read it.

### 1. Look at the raw metrics

```bash run
curl -s "$API/metrics"
```

```text output
# HELP devforge_http_requests_total HTTP requests handled, by route pattern and status.
# TYPE devforge_http_requests_total counter
# HELP devforge_http_request_duration_seconds HTTP request latency.
# TYPE devforge_http_request_duration_seconds histogram
# HELP devforge_process_resident_memory_bytes Resident set size of the server process.
# TYPE devforge_process_resident_memory_bytes gauge
devforge_process_resident_memory_bytes …
# HELP devforge_process_uptime_seconds Seconds since the server started.
# TYPE devforge_process_uptime_seconds gauge
devforge_process_uptime_seconds …
```

Lines starting with `# HELP` describe a metric in words; `# TYPE` says whether it is a counter, gauge or histogram. A fresh server has handled no requests yet, so the request metrics have no samples. The two gauges always have a value: memory in bytes and uptime in seconds (shown as `…` here because they differ on every run).

### 2. Make some requests and watch the counter

Ask for the Redis track three times and for a track that does not exist once. `-o /dev/null` throws the response body away; only the side effect matters here:

```bash run
for i in 1 2 3; do curl -s -o /dev/null "$API/api/tracks/redis"; done
curl -s -o /dev/null "$API/api/tracks/no-such-track"
curl -s "$API/metrics" | grep '^devforge_http_requests_total'
```

```text output
devforge_http_requests_total{method="GET",route="/metrics",status="200"} 1
devforge_http_requests_total{method="GET",route="/api/tracks/:slug",status="200"} 3
devforge_http_requests_total{method="GET",route="/api/tracks/:slug",status="404"} 1
```

`grep '^devforge_http_requests_total'` keeps only lines that start with that name. Three things to notice:

- One metric, **three series**: each distinct set of labels has its own line and its own value.
- Your earlier `curl … /metrics` is counted too. Every scrape is itself an HTTP request.
- The `route` label is `/api/tracks/:slug`, the **route pattern**, not the address you typed. That is deliberate.

### 3. Why the label holds a pattern, not a URL

Ask for a different track and look again:

```bash run
curl -s -o /dev/null "$API/api/tracks/docker"
curl -s "$API/metrics" | grep '^devforge_http_requests_total{method="GET",route="/api/tracks/:slug"'
```

```text output
devforge_http_requests_total{method="GET",route="/api/tracks/:slug",status="200"} 4
devforge_http_requests_total{method="GET",route="/api/tracks/:slug",status="404"} 1
```

The Docker request was added to the same series as the Redis requests. If the label held the real path, every track, lesson and mistyped URL would create a new time series — thousands of them. Prometheus's naming guide warns against exactly this: do not put unbounded values such as user IDs, email addresses or URLs into labels. Those details belong in logs and traces.

### 4. Read a histogram

DevForge also measures how long each request took. Look at the series for the track route:

```bash run
curl -s "$API/metrics" | grep 'duration_seconds.*route="/api/tracks/:slug"' | grep -E 'le="(0.005|1|\+Inf)"|_sum|_count'
```

```text output
devforge_http_request_duration_seconds_bucket{method="GET",route="/api/tracks/:slug",le="0.005"} …
devforge_http_request_duration_seconds_bucket{method="GET",route="/api/tracks/:slug",le="1"} 5
devforge_http_request_duration_seconds_bucket{method="GET",route="/api/tracks/:slug",le="+Inf"} 5
devforge_http_request_duration_seconds_sum{method="GET",route="/api/tracks/:slug"} …
devforge_http_request_duration_seconds_count{method="GET",route="/api/tracks/:slug"} 5
```

- Each `_bucket` line counts the requests that took **at most** `le` seconds ("less than or equal"). Buckets are cumulative: the `le="1"` bucket includes everything in `le="0.005"`.
- `le="+Inf"` counts every request, so it always equals `_count`.
- `_sum` is the total time of all requests; `_sum` divided by `_count` is the average.
- How many requests finished within 5 ms depends on your computer, so that value is shown as `…`. All five finished within a second.

Prometheus can turn these buckets into percentiles with `histogram_quantile()` — for example, "95% of requests finished within X seconds". You will query that in the next lesson.

## Common mistakes

- **Graphing a raw counter.** A line that only goes up says little. Graph how fast it rises: `rate(devforge_http_requests_total[5m])` (next lesson).
- **Using a counter for something that goes down**, such as active sessions. Use a gauge.
- **Putting IDs, emails or full URLs into labels.** Each new value is a new time series; the number of series can grow without limit.
- **Mixing units**, such as milliseconds in one metric and seconds in another. Use base units and put the unit in the name (`_seconds`, `_bytes`).
- **Exposing /metrics to the internet.** It can reveal routes and internal behaviour. DevForge answers it only to private addresses, and its Nginx configuration blocks it publicly.

## Where this fits in a real system

Every service in a system exposes `/metrics` like this: your own applications through a client library, and tools such as **Nginx**, **PostgreSQL**, **Redis** and **Kafka** through small helper programs called *exporters*. **Prometheus** scrapes them all; **Grafana** draws them on dashboards. Metrics tell you *that* something is wrong; logs and **OpenTelemetry** traces help you find *why*.
