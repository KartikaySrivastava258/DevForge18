---
id: prometheus-scraping-and-promql
title: Running Prometheus — scraping and your first PromQL
track: prometheus-grafana
order: 2
level: beginner
estimated_minutes: 40
prerequisites: [prometheus-metrics-and-labels]
learning_objectives:
  - Configure Prometheus to scrape an application, check the configuration and start it.
  - Confirm a target is healthy with the up metric.
  - Write PromQL queries that select series, add them up by label, compute a rate and estimate a percentile.
resources:
  - title: Prometheus download page
    url: https://prometheus.io/download/
    publisher: Prometheus Authors
    type: reference
    level: beginner
    official: true
    why: Official binaries for Linux, macOS and Windows, with checksums.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Querying Prometheus (PromQL basics)
    url: https://prometheus.io/docs/prometheus/latest/querying/basics/
    publisher: Prometheus Authors
    type: reference
    level: beginner
    official: true
    why: Selectors, label matchers, range vectors and the shape of query results.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Query functions
    url: https://prometheus.io/docs/prometheus/latest/querying/functions/
    publisher: Prometheus Authors
    type: reference
    level: intermediate
    official: true
    why: rate(), histogram_quantile() and the rule to take a rate first, then aggregate.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Jobs and instances
    url: https://prometheus.io/docs/concepts/jobs_instances/
    publisher: Prometheus Authors
    type: documentation
    level: beginner
    official: true
    why: Where the job and instance labels come from, and what the up series means.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: up-zero
    prompt: up{job="devforge"} is 0. What does that tell you?
    options:
      - { id: a, text: "DevForge has handled zero requests" }
      - { id: b, text: "Prometheus's last attempt to scrape that target failed — it could not reach it or read its metrics" }
      - { id: c, text: "Prometheus has stopped running" }
    answer: b
    explanation: Prometheus records up for every target after every scrape attempt — 1 if the scrape worked, 0 if it failed. It is the first thing to check when a graph goes empty. If Prometheus itself had stopped, you could not query it at all.
  - id: rate-then-sum
    prompt: You want one number — DevForge's total requests per second across all routes and statuses. Which query gives it?
    options:
      - { id: a, text: "sum(devforge_http_requests_total)" }
      - { id: b, text: "sum(rate(devforge_http_requests_total[5m]))" }
      - { id: c, text: "rate(devforge_http_requests_total[5m])" }
    answer: b
    explanation: rate() turns each counter into requests per second, and sum() adds those rates into one number — rate first, then aggregate, as the Prometheus documentation advises. Option a is the running total of all requests ever, not a rate. Option c is a rate, but one per series (per route and status), not a single total.
  - id: empty-result
    prompt: A query returns nothing at all. Which is NOT a likely reason?
    options:
      - { id: a, text: "The metric name or a label value is misspelled" }
      - { id: b, text: "The application has not produced that series yet (for example, no 404 has happened)" }
      - { id: c, text: "The query has a syntax error" }
    answer: c
    explanation: A syntax error is reported as an error, not an empty result. An empty result means the query was valid but no series matched — usually a typo or a series that does not exist yet.
  - id: scrape-interval
    prompt: With scrape_interval set to 5s, you make a request and query immediately. The counter has not changed. Why?
    options:
      - { id: a, text: "Prometheus only learns about new values at the next scrape, up to 5 seconds later" }
      - { id: b, text: "Counters only update once a minute" }
      - { id: c, text: "The request was not counted" }
    answer: a
    explanation: Prometheus pulls. Between scrapes it has the old value; the application's own /metrics already shows the new one. That is why the lesson waits for a condition instead of assuming the data is there.
verification:
  method: executed
  details: Every command is run by the test suite with Prometheus 3.16.0 (checksum-verified official binary) scraping a real DevForge server, after the previous lesson; the output shown was recorded from that run. Values that change with timing are shown as …. Facts about rate(), up and the readiness endpoint were checked against the Prometheus documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Prometheus** visits each application on a schedule, reads its `/metrics` page, stores every number with the time it was read, and lets you ask questions about that history in a query language called **PromQL**.

## Explain it like I'm twelve

Imagine a weather station that writes down the temperature every five minutes. On its own, one reading is not very interesting. But with the whole notebook you can ask: what was the hottest hour today? How fast is it warming up? Prometheus is the notebook-keeper; PromQL is how you ask the notebook questions.

Where the analogy breaks: Prometheus does not wait to be told readings — it goes and fetches them itself (it *pulls*), and if it cannot reach an application, it writes that down too.

## What problem it solves

The `/metrics` page only shows numbers *right now*. To see whether errors are rising or requests are getting slower, you need those numbers over time, from every copy of every service, in one place — and a way to calculate with them. Prometheus collects and stores the history; PromQL turns raw counters into answers such as "requests per second" or "95th-percentile latency".

## How it works

```diagram steps=prometheus-grafana/scrape-loop
```

Every scraped series gets two extra labels: `job` (the name in the configuration) and `instance` (the address that was scraped). Prometheus also records a series called `up` for every target: `1` if the last scrape worked, `0` if it failed.

## Try it yourself

> **Local lab** — keep DevForge running from the previous lesson (`npm start`), and keep `API` set. Every command is run automatically in DevForge's tests with Prometheus 3.16.0 scraping a fresh DevForge, after the previous lesson's commands. Counts assume you did the previous lesson and nothing else; if you have been browsing DevForge, yours will be higher. Values that change with timing, such as timestamps, are shown as `…`.

### 0. Install Prometheus

Download Prometheus 3.16.0 for your system from the [official download page](https://prometheus.io/download/) and unpack it. On Linux, for example:

```bash
curl -fsSLO https://github.com/prometheus/prometheus/releases/download/v3.16.0/prometheus-3.16.0.linux-amd64.tar.gz
tar -xzf prometheus-3.16.0.linux-amd64.tar.gz
export PATH="$PWD/prometheus-3.16.0.linux-amd64:$PATH"
```

The archive contains two programs: `prometheus`, the server, and `promtool`, a helper for checking configuration and running queries. (Prometheus is also published as a container image; running it on your own machine first keeps the networking simple.) Check the version:

```bash run
prometheus --version | head -n 1
```

```text output
prometheus, version 3.16.0 (branch: HEAD, revision: e2e28adeee2c5883d000fc82aca6008cfbf7e96d)
```

### 1. Tell Prometheus what to scrape

Prometheus needs the target's address without `http://`. `${API#http://}` is bash for "the value of API with `http://` removed from the front":

```bash run
mkdir -p prometheus-lab && cd prometheus-lab
target="${API#http://}"
cat > prometheus.yml <<EOF
global:
  scrape_interval: 5s
scrape_configs:
  - job_name: devforge
    static_configs:
      - targets: ["$target"]
EOF
promtool check config prometheus.yml
```

```text output
Checking prometheus.yml
 SUCCESS: prometheus.yml is valid prometheus config file syntax
```

- `scrape_interval: 5s` — read every target every five seconds. Prometheus's default is one minute; 5 seconds keeps this lab quick.
- `job_name` — a name for a group of targets; it becomes the `job` label.
- `targets` — the addresses to scrape (`/metrics` is the default path). For you this is `localhost:8080`.
- `promtool check config` catches mistakes before you start the server.

### 2. Start Prometheus and wait until it is ready

```bash run
prometheus --config.file=prometheus.yml --storage.tsdb.path=data \
  --web.listen-address=127.0.0.1:9090 > prometheus.log 2>&1 &
echo $! > prometheus.pid
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://127.0.0.1:9090/-/ready && break
  sleep 1
done
curl -s http://127.0.0.1:9090/-/ready
```

```text output
Prometheus Server is Ready.
```

- The `&` at the end runs Prometheus in the background, so you get your terminal back; its messages go to `prometheus.log`. `$!` is the process ID of that background program, saved so you can stop it later.
- `--storage.tsdb.path=data` keeps the stored time series in a `data` folder here.
- `/-/ready` answers `200` once Prometheus can respond to queries. `curl -f` treats any other status as a failure, so the loop keeps waiting — for at most 30 seconds.

Open <http://localhost:9090> in a browser: that is Prometheus's own web interface, where you can type the same queries. Below you use `promtool` so the results can be checked automatically.

### 3. Is the target up?

The first scrape happens within five seconds. Rather than guessing how long to wait, define a small helper that repeats a query until it returns something:

```bash run
wait_for() {
  for i in $(seq 1 30); do
    [ -n "$(promtool query instant http://127.0.0.1:9090 "$1")" ] && return 0
    sleep 1
  done
  echo "timed out waiting for: $1" && return 1
}
wait_for 'up == 1'
promtool query instant http://127.0.0.1:9090 'up'
```

```text output
up{instance="…", job="devforge"} => 1 @[…]
```

`up` is `1`: the scrape worked. Each line of output is one series, its value, and `@[…]`, the time it was evaluated (as seconds since 1970). `up == 1` is a *filter*: it keeps only series whose value is 1, so it returns nothing until the first scrape has succeeded.

### 4. Select series by label

Make some traffic — ten good requests and two for a track that does not exist — then wait until Prometheus has scraped the result:

```bash run
for i in $(seq 1 10); do curl -s -o /dev/null "$API/api/tracks/redis"; done
for i in 1 2; do curl -s -o /dev/null "$API/api/tracks/no-such-track"; done
wait_for 'devforge_http_requests_total{status="404"} >= 3'
promtool query instant http://127.0.0.1:9090 \
  'devforge_http_requests_total{route="/api/tracks/:slug"}' | sort
```

```text output
devforge_http_requests_total{instance="…", job="devforge", method="GET", route="/api/tracks/:slug", status="200"} => 14 @[…]
devforge_http_requests_total{instance="…", job="devforge", method="GET", route="/api/tracks/:slug", status="404"} => 3 @[…]
```

- `{route="/api/tracks/:slug"}` is a **label matcher**: keep only series whose route label has exactly this value. Without it you would also get the `/metrics` series, which grows with every scrape.
- The counts include the previous lesson's requests (4 good, 1 missing track).
- Prometheus does not promise any order for results, so `sort` makes them predictable.

### 5. Add series up by a label

```bash run
promtool query instant http://127.0.0.1:9090 \
  'sum by (status) (devforge_http_requests_total{route="/api/tracks/:slug"})' | sort
```

```text output
{status="200"} => 14 @[…]
{status="404"} => 3 @[…]
```

`sum by (status)` adds together all series that share a `status` value and drops the other labels. With many routes and many copies of DevForge, this is how you get one number per status code.

### 6. Turn a counter into a rate

A total that only grows is hard to read. `rate()` asks how fast it is growing, per second, over a time window:

```bash run
promtool query instant http://127.0.0.1:9090 \
  'rate(devforge_http_requests_total{route="/metrics"}[1m])'
```

```text output
{instance="…", job="devforge", method="GET", route="/metrics", status="200"} => … @[…]
```

- `[1m]` makes a **range vector**: for each series, every sample from the last minute. `rate()` turns that into the average per-second increase, and adjusts for counter resets when a process restarts.
- Prometheus requests `/metrics` every 5 seconds, so once a full minute of data exists this settles near **0.2** per second. Right after starting there are only a few samples in the window, so your number may be rougher.
- To add rates up, take the rate first and then sum: `sum(rate(devforge_http_requests_total[5m]))`. The other way round hides counter resets.

### 7. Estimate a percentile from a histogram

```bash run
promtool query instant http://127.0.0.1:9090 \
  'histogram_quantile(0.95, sum by (le) (rate(devforge_http_request_duration_seconds_bucket[1m])))'
```

```text output
{} => … @[…]
```

Read from the inside out: the rate of each latency bucket, summed per bucket bound `le`, then `histogram_quantile(0.95, …)` estimates the time within which 95% of requests finished, in seconds. It is an estimate: Prometheus only knows how many requests fell into each bucket, so it interpolates inside a bucket. Your value depends on your computer.

### 8. A query mistake

```bash run fails
promtool query instant http://127.0.0.1:9090 'sum by status (devforge_http_requests_total)'
```

```text output
query error: bad_data: invalid parameter "query": 1:8: parse error: unexpected identifier "status" in grouping opts, expected "("
```

The label list after `by` needs parentheses: `sum by (status) (…)`. `1:8` points at line 1, character 8. A query that is valid but matches nothing does not give an error; it returns nothing at all.

**Keep Prometheus running** for the next lesson. When you are finished, stop it with `kill "$(cat prometheus.pid)"` from the `prometheus-lab` folder.

## Try it in the simulation

See what changes when an instance restarts, when scrapes are far apart, or when a percentile is added up the wrong way. It is a labelled teaching model of Prometheus's queries, not a real Prometheus.

```simulation prometheus-scrape-and-rate scenario=two-instances
```

## Common mistakes

- **Forgetting that Prometheus pulls.** A new value appears only after the next scrape. Wait for a condition, as the lesson does, instead of querying straight away.
- **Wrong target address.** No `http://` in `targets`, and the port must be the one the application listens on. Check `up`, or the target status page in Prometheus's web interface, which shows the last scrape error for each target.
- **Aggregating before taking the rate.** Write `sum(rate(x[5m]))`: rate first, then sum. The documentation warns that otherwise `rate()` cannot detect counter resets when a target restarts.
- **A range too short for the scrape interval.** `rate()` needs at least two samples in its window. `rate(x[5s])` with a 5-second scrape interval usually finds only one and returns nothing; use a range several times longer than the interval.
- **Reading `histogram_quantile` as exact.** It interpolates within buckets; choose bucket bounds near the values you care about.

## Where this fits in a real system

In production, Prometheus scrapes every service and exporter, often found automatically through **Kubernetes** service discovery instead of a fixed `targets` list. The same PromQL drives **Grafana** dashboards (next lesson) and alerting rules that page someone when, for example, the 5xx rate rises. **OpenTelemetry** can produce metrics too, and Prometheus can store them.
