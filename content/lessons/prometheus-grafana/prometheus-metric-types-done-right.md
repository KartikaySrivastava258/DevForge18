---
id: prometheus-metric-types-done-right
title: Counters, gauges and histograms done right
track: prometheus-grafana
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [prometheus-scraping-and-promql]
learning_objectives:
  - Choose the right metric type — counter, gauge or histogram — for a measurement, and expose it in Prometheus' text format.
  - Name metrics by the conventions (base units, _total for counters) and lint them with promtool check metrics.
  - Read a histogram's cumulative buckets, and compute a quantile and an average from them.
  - Explain why rate() copes with counter resets, and why quantiles from summaries cannot be aggregated.
resources:
  - title: Metric types
    url: https://prometheus.io/docs/concepts/metric_types/
    publisher: Prometheus
    type: documentation
    level: beginner
    official: true
    why: A counter only increases or resets to zero on restart; a gauge goes up and down; a classic histogram exposes cumulative _bucket counters plus _sum and _count.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Metric and label naming
    url: https://prometheus.io/docs/practices/naming/
    publisher: Prometheus
    type: documentation
    level: beginner
    official: true
    why: One unit per metric, base units such as seconds, unit suffixes, and _total for accumulating counts.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Histograms and summaries
    url: https://prometheus.io/docs/practices/histograms/
    publisher: Prometheus
    type: documentation
    level: intermediate
    official: true
    why: Summary quantiles are computed in the program and cannot be aggregated; histograms can, with histogram_quantile.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: which-type
    prompt: Which type fits "number of jobs waiting in the queue right now"?
    options:
      - { id: a, text: "A counter" }
      - { id: b, text: "A gauge — the value goes up and down; a counter may only increase (or reset on restart)" }
      - { id: c, text: "A histogram" }
    answer: b
    explanation: Counters are for things that accumulate (requests served, errors); gauges for current levels (queue length, memory in use, requests in flight).
  - id: rate-counter
    prompt: A counter was 500, the service restarted, and now it reads 20. What does rate() over that window do?
    options:
      - { id: a, text: "Reports a huge negative rate" }
      - { id: b, text: "Treats the drop as a reset: counts the increase up to the restart, then from zero — the rate stays correct" }
      - { id: c, text: "Fails with an error" }
    answer: b
    explanation: That is why counters must only go up — a decrease means "restarted". The lab shows resets() counting exactly one.
  - id: aggregate
    prompt: Ten replicas each expose a 95th-percentile latency (summary). Can you average them for the service's 95th percentile?
    options:
      - { id: a, text: "Yes, average them" }
      - { id: b, text: "No — percentiles do not average; expose histograms instead, sum the buckets across replicas, then compute the quantile with histogram_quantile" }
      - { id: c, text: "Yes, take the maximum" }
    answer: b
    explanation: The Prometheus documentation says summary quantiles cannot be aggregated; bucket counts can.
verification:
  method: executed
  details: Every command is run by the test suite with Prometheus and promtool 3.16.0 and Node.js, after the earlier Prometheus lessons, and its output is compared with this lesson. Request durations are fixed by the lab, so bucket counts and quantiles are exact; timestamps vary and are shown as …. Checked against the Prometheus documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Pick the metric type by how the value behaves — a **counter** for things that only accumulate, a **gauge** for a level that goes up and down, a **histogram** for a distribution such as latency — and name it so anyone can read its unit and meaning.

## Explain it like I'm twelve

A school counts visitors at the gate on a clicker that only goes up (**counter**); the number of people in the hall right now goes up and down (**gauge**); and for how long people queued, it keeps a tally sheet — under 1 minute, under 2 minutes, under 5 minutes… (**histogram**). From the tally sheet you can later answer "how long did most people wait?", for any group of gates added together.

Where the analogy breaks: if the clicker is replaced (a restart), Prometheus notices that it went back to zero and carries on counting correctly.

## What problem it solves

The wrong type quietly breaks dashboards: a "total" that can go down makes `rate()` report nonsense; latency averages hide the slow requests users complain about; percentiles computed in each instance cannot be combined for a whole service. Clear names and types make metrics correct by construction — and readable by people who did not write them.

## How it works

![](media:prometheus-grafana/metric-types.svg)

- **Counter**: `shop_requests_total 7`. Use `rate()` or `increase()` on it; a drop means the process restarted (a reset), which those functions handle.
- **Gauge**: `shop_requests_in_flight 0`. Read it directly, or use `avg_over_time`, `max_over_time`.
- **Histogram**: one counter per bucket, `le` = "less than or equal", **cumulative** (each bucket includes the smaller ones), plus `_sum` and `_count`. `histogram_quantile(0.9, …)` estimates a quantile by interpolating inside the right bucket; `_sum / _count` is the average.
- **Names**: base units (`_seconds`, `_bytes`), `_total` on counters, `# HELP` text. `promtool check metrics` lints exactly these rules.

## Try it yourself

> **Local lab** — needs Node.js and Prometheus with promtool, as in the earlier lessons. The app listens on `127.0.0.1:9101`, this lesson's Prometheus on `127.0.0.1:9092`. Every command is run automatically in DevForge's tests.

### 1. An app with one metric of each type

```bash run
mkdir -p metric-types-lab && cd metric-types-lab
cat > app.mjs <<'EOF'
// A tiny service with three hand-written metrics, in Prometheus' text format.
import http from "node:http";
const buckets = [0.05, 0.1, 0.25, 0.5, 1];               // seconds; le="+Inf" is added below
let requests = 0;                                         // counter: only ever goes up
let inFlight = 0;                                         // gauge: goes up and down
const counts = new Array(buckets.length).fill(0);         // histogram buckets (cumulative when exposed)
let sum = 0, count = 0;
function observe(seconds) {
  buckets.forEach((le, i) => { if (seconds <= le) counts[i]++; });
  sum += seconds; count++;
}
http.createServer((req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("content-type", "text/plain; version=0.0.4");
    return res.end([
      "# HELP shop_requests_total Requests handled.",
      "# TYPE shop_requests_total counter",
      `shop_requests_total ${requests}`,
      "# HELP shop_requests_in_flight Requests being handled right now.",
      "# TYPE shop_requests_in_flight gauge",
      `shop_requests_in_flight ${inFlight}`,
      "# HELP shop_request_duration_seconds Time to handle a request.",
      "# TYPE shop_request_duration_seconds histogram",
      ...buckets.map((le, i) => `shop_request_duration_seconds_bucket{le="${le}"} ${counts[i]}`),
      `shop_request_duration_seconds_bucket{le="+Inf"} ${count}`,
      `shop_request_duration_seconds_sum ${sum.toFixed(3)}`,
      `shop_request_duration_seconds_count ${count}`,
      "",
    ].join("\n"));
  }
  // Each request takes the time given in ?ms=…, so the numbers in this lab are predictable.
  const ms = Number(new URL(req.url, "http://x").searchParams.get("ms") ?? 20);
  requests++; inFlight++;
  setTimeout(() => { inFlight--; observe(ms / 1000); res.end("ok\n"); }, ms);
}).listen(9101, "127.0.0.1");
EOF
node app.mjs > app.log 2>&1 &
echo $! > app.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9101/metrics && break; sleep 0.2; done
for ms in 20 20 80 80 80 300 900; do curl -s -o /dev/null "http://127.0.0.1:9101/?ms=$ms"; done
curl -s http://127.0.0.1:9101/metrics
```

```text output
# HELP shop_requests_total Requests handled.
# TYPE shop_requests_total counter
shop_requests_total 7
# HELP shop_requests_in_flight Requests being handled right now.
# TYPE shop_requests_in_flight gauge
shop_requests_in_flight 0
# HELP shop_request_duration_seconds Time to handle a request.
# TYPE shop_request_duration_seconds histogram
shop_request_duration_seconds_bucket{le="0.05"} 2
shop_request_duration_seconds_bucket{le="0.1"} 5
shop_request_duration_seconds_bucket{le="0.25"} 5
shop_request_duration_seconds_bucket{le="0.5"} 6
shop_request_duration_seconds_bucket{le="1"} 7
shop_request_duration_seconds_bucket{le="+Inf"} 7
shop_request_duration_seconds_sum 1.480
shop_request_duration_seconds_count 7
```

Seven requests: two took 20 ms, three 80 ms, one 300 ms and one 900 ms. The buckets are **cumulative**: `le="0.1"` counts the five requests of 100 ms or less, including the two that are also in `le="0.05"`.

### 2. Lint the names

```bash run
curl -s http://127.0.0.1:9101/metrics | promtool check metrics && echo "shop metrics: no problems"
printf '# TYPE shop_request_time_milliseconds counter\nshop_request_time_milliseconds 5\n' | promtool check metrics || echo "exit code: $?"
```

```text output
shop metrics: no problems
shop_request_time_milliseconds counter metrics should have "_total" suffix
shop_request_time_milliseconds no help text
shop_request_time_milliseconds use base unit "seconds" instead of "milliseconds"
exit code: 3
```

The second metric breaks three conventions at once. Fix names before dashboards depend on them — renaming later breaks every query.

### 3. Scrape it, and query each type

```bash run
cat > prometheus.yml <<'EOF'
global:
  scrape_interval: 1s
scrape_configs:
  - job_name: shop
    static_configs:
      - targets: ["127.0.0.1:9101"]
EOF
prometheus --config.file=prometheus.yml --storage.tsdb.path=data --web.listen-address=127.0.0.1:9092 > prometheus.log 2>&1 &
echo $! > prometheus.pid
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9092 'shop_requests_total == 7' 2> /dev/null)" ] && break; sleep 1; done
q() { promtool query instant http://127.0.0.1:9092 "$1" | sed -E 's/@\[[0-9.]+\]/@[…]/'; }
q 'shop_requests_total'
q 'shop_requests_in_flight'
q 'histogram_quantile(0.5, shop_request_duration_seconds_bucket)'
q 'histogram_quantile(0.9, shop_request_duration_seconds_bucket)'
q 'shop_request_duration_seconds_sum / shop_request_duration_seconds_count'
```

```text output
shop_requests_total{instance="127.0.0.1:9101", job="shop"} => 7 @[…]
shop_requests_in_flight{instance="127.0.0.1:9101", job="shop"} => 0 @[…]
{instance="127.0.0.1:9101", job="shop"} => 0.07500000000000001 @[…]
{instance="127.0.0.1:9101", job="shop"} => 0.6499999999999999 @[…]
{instance="127.0.0.1:9101", job="shop"} => 0.21142857142857144 @[…]
```

(The long decimals are floating-point arithmetic: 0.07500000000000001 is 0.075.)

- **Median 0.075 s**: the 3.5th of 7 requests falls in the `0.05–0.1` bucket (requests 3 to 5), so Prometheus interpolates halfway into it: 0.05 + 0.05 × (3.5 − 2) ÷ 3.
- **90th percentile 0.65 s**: the 6.3rd request falls in the `0.5–1` bucket, 30% of the way in. The real value was 0.9 s — histogram quantiles are only as precise as your buckets, so put bucket boundaries near the thresholds you care about.
- **Average 0.21 s**: `_sum / _count`. It hides the 0.9-second request completely — which is why latency is judged by quantiles, not averages.

In production you would apply these to `rate(…[5m])` of the buckets, so the answer describes recent requests rather than everything since the process started.

### 4. A restart resets the counter

```bash run
kill "$(cat app.pid)"; sleep 0.5
node app.mjs > app.log 2>&1 &
echo $! > app.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9101/metrics && break; sleep 0.2; done
curl -s -o /dev/null "http://127.0.0.1:9101/?ms=20"; curl -s -o /dev/null "http://127.0.0.1:9101/?ms=20"
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9092 'shop_requests_total == 2' 2> /dev/null)" ] && break; sleep 1; done
q 'shop_requests_total'
q 'resets(shop_requests_total[5m])'
```

```text output
shop_requests_total{instance="127.0.0.1:9101", job="shop"} => 2 @[…]
{instance="127.0.0.1:9101", job="shop"} => 1 @[…]
```

The counter dropped from 7 to 2. Because a counter may only go up, Prometheus reads the drop as exactly one reset, and `rate()` and `increase()` add the counts before and after it instead of reporting a negative rate. A gauge used as a counter would lose this.

### 5. Stop everything

```bash run
kill "$(cat prometheus.pid)" "$(cat app.pid)"
```

## Common mistakes

- **A counter that can decrease** (for example "active users" as a counter). Use a gauge.
- **`rate()` on a gauge, or plotting a raw counter.** Rates belong to counters; raw counters only show "total since restart".
- **Averages for latency.** Use quantiles from histograms; averages hide the slow tail.
- **Summaries across replicas.** Their quantiles cannot be combined; histograms can.
- **Milliseconds here, seconds there.** One base unit per metric, in the name.

## Where this fits in a real system

Client libraries (Go, Java, Python, Node.js) generate this text format for you; **OpenTelemetry** SDKs can export the same counters, gauges and histograms; DevForge's own server exposes `devforge_http_requests_total` and a duration histogram, as earlier lessons showed. **Grafana** dashboards (next lesson) and SLO alerts (lesson 7) are only as good as these choices.
