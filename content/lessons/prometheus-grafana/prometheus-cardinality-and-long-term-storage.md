---
id: prometheus-cardinality-and-long-term-storage
title: Cardinality and long-term storage
track: prometheus-grafana
order: 8
level: advanced
estimated_minutes: 45
prerequisites: [prometheus-scraping-and-promql]
learning_objectives:
  - Explain cardinality — every distinct label set is a separate time series — and spot the labels that explode it.
  - Measure series per metric with Prometheus' TSDB status API and its scrape metrics.
  - Drop an expensive metric at scrape time with metric_relabel_configs, and fix the cause in the instrumentation.
  - Keep data for longer than a local Prometheus should by sending it with remote_write to a long-term store, and set retention.
resources:
  - title: Instrumentation — do not overuse labels
    url: https://prometheus.io/docs/practices/instrumentation/
    publisher: Prometheus
    type: documentation
    level: intermediate
    official: true
    why: Each label set is another time series with RAM, CPU, disk and network costs; keep metric cardinality low and most metrics label-free.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Configuration — relabel_config and metric_relabel_configs
    url: https://prometheus.io/docs/prometheus/latest/configuration/configuration/
    publisher: Prometheus
    type: reference
    level: advanced
    official: true
    why: Relabelling actions (drop, keep, labeldrop …), metric relabelling after the scrape, remote_write and retention settings.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Storage (local storage and remote integrations)
    url: https://prometheus.io/docs/prometheus/latest/storage/
    publisher: Prometheus
    type: documentation
    level: advanced
    official: true
    why: Local storage is not clustered or replicated and has a retention period; remote write sends samples to long-term storage systems.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: TSDB status API
    url: https://prometheus.io/docs/prometheus/latest/querying/api/
    publisher: Prometheus
    type: reference
    level: advanced
    official: true
    why: /api/v1/status/tsdb reports head statistics and the metrics with the most series.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: cardinality
    prompt: A developer adds a user_id label to a request counter on a site with 200,000 users. What happens?
    options:
      - { id: a, text: "Nothing, labels are free" }
      - { id: b, text: "Up to 200,000 series for that one metric (times every other label's values) — memory, disk and query time grow with it, and Prometheus may run out of memory" }
      - { id: c, text: "Prometheus rejects the label" }
    answer: b
    explanation: The lab shows 500 users becoming 500 series. Per-user data belongs in logs, traces or a database, not in metric labels.
  - id: relabel
    prompt: Why is dropping a metric with metric_relabel_configs only a stopgap?
    options:
      - { id: a, text: "It does not work" }
      - { id: b, text: "The application still computes and sends the data every scrape; fix the instrumentation (aggregate, or remove the label) so the cost disappears at the source" }
      - { id: c, text: "Relabelling slows Prometheus down permanently" }
    answer: b
    explanation: It protects Prometheus immediately, which is valuable in an incident; the lasting fix is in the code.
  - id: long-term
    prompt: Why send data to a long-term store instead of raising one Prometheus server's retention to two years?
    options:
      - { id: a, text: "Prometheus cannot store data longer than 15 days" }
      - { id: b, text: "Local storage is a single node — not replicated or clustered; long-term stores (Thanos, Mimir, VictoriaMetrics, managed services) add durability, a global view across Prometheus servers, and cheaper storage" }
      - { id: c, text: "Remote write is faster" }
    answer: b
    explanation: Keep local retention short for fast queries and recovery; remote_write a copy to the long-term system.
verification:
  method: executed
  details: Every command is run by the test suite with Prometheus 3.16.0 (two instances, one receiving remote writes) and a small Node.js exporter, after the earlier Prometheus lessons, and its output is compared with this lesson. Checked against the Prometheus documentation on 2026-11-26. Thanos, Mimir and VictoriaMetrics are named as examples, not run.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Every distinct combination of label values is a separate time series, so one careless label (a user ID, a request ID) can multiply a metric into hundreds of thousands of series — find them, cut them at the source, and send the data you do keep to a **long-term store** rather than growing one Prometheus forever.

## Explain it like I'm twelve

A school keeps one attendance chart per class — 30 charts. Someone suggests one chart per pupil per subject per day: suddenly there are millions of charts, the filing cabinet overflows, and finding anything takes forever. The fix is to keep per-class charts and write individual details in each pupil's record instead. Old charts go to the archive in the basement (long-term storage), not in the classroom.

Where the analogy breaks: Prometheus does not warn you before the cabinet overflows — it runs out of memory.

## What problem it solves

Cardinality explosions are the most common way to break Prometheus: memory use grows with active series, queries slow down, and the server can crash during the very incident you need it for. Separately, a single local Prometheus is not built to keep years of data safely. Understanding both keeps monitoring fast and trustworthy.

## How it works

![](media:prometheus-grafana/cardinality.svg)

- **Series = metric name + one set of label values.** `shop_cart_items{user_id="u1"}` … `{user_id="u500"}` are 500 series.
- `/api/v1/status/tsdb` lists the metrics with the most series; `scrape_samples_scraped` and `scrape_samples_post_metric_relabeling` show what each target sends and what is kept.
- `metric_relabel_configs` runs after each scrape: `action: drop` with a regex on `__name__` discards a metric before it is stored.
- `--storage.tsdb.retention.time` (or `.size`) limits local storage. `remote_write` streams samples to another system — here a second Prometheus started with `--web.enable-remote-write-receiver`; in production Thanos, Grafana Mimir, VictoriaMetrics or a managed service.

## Try it yourself

> **Local lab** — needs Prometheus and Node.js, as in the earlier lessons. The exporter listens on `127.0.0.1:9102`, this lesson's Prometheus on `127.0.0.1:9097` and the "long-term store" on `127.0.0.1:9098`. Every command is run automatically in DevForge's tests.

### 1. An exporter with a per-user label

```bash run
mkdir -p cardinality-lab && cd cardinality-lab
cat > app.mjs <<'EOF'
// One metric with a user_id label (500 users) and one aggregated metric.
import http from "node:http";
http.createServer((req, res) => {
  const lines = ["# HELP shop_cart_items Items in each user's cart.", "# TYPE shop_cart_items gauge"];
  for (let u = 1; u <= 500; u++) lines.push(`shop_cart_items{user_id="u${u}"} ${u % 7}`);
  lines.push("# HELP shop_carts_open Carts with at least one item.", "# TYPE shop_carts_open gauge", "shop_carts_open 429", "");
  res.setHeader("content-type", "text/plain; version=0.0.4");
  res.end(lines.join("\n"));
}).listen(9102, "127.0.0.1");
EOF
node app.mjs > app.log 2>&1 &
echo $! > app.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9102/ && break; sleep 0.2; done
echo "lines starting with shop_cart_items: $(curl -s http://127.0.0.1:9102/ | grep -c '^shop_cart_items{')"
```

```text output
lines starting with shop_cart_items: 500
```

### 2. Scrape it, and see what it costs

```bash run
cat > longterm.yml <<'EOF'
global: { scrape_interval: 15s }
EOF
prometheus --config.file=longterm.yml --storage.tsdb.path=longterm-data --web.listen-address=127.0.0.1:9098 \
  --web.enable-remote-write-receiver --storage.tsdb.retention.time=400d > longterm.log 2>&1 &
echo $! > longterm.pid
cat > prometheus.yml <<'EOF'
global: { scrape_interval: 1s }
scrape_configs:
  - job_name: shop
    static_configs: [{ targets: ["127.0.0.1:9102"] }]
remote_write:
  - url: http://127.0.0.1:9098/api/v1/write     # a copy of every sample goes to the long-term store
EOF
prometheus --config.file=prometheus.yml --storage.tsdb.path=data --web.listen-address=127.0.0.1:9097 \
  --storage.tsdb.retention.time=2d > prometheus.log 2>&1 &
echo $! > prometheus.pid
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9097 'scrape_samples_scraped{job="shop"} > 0' 2> /dev/null)" ] && break; sleep 1; done
q() { promtool query instant "http://127.0.0.1:$1" "$2" | sed -E 's/@\[[0-9.]+\]/@[…]/'; }
q 9097 'scrape_samples_scraped{job="shop"}'
curl -s http://127.0.0.1:9097/api/v1/status/tsdb | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const top = JSON.parse(s).data.seriesCountByMetricName[0];
    console.log(`metric with the most series: ${top.name} (${top.value})`);
  });'
```

```text output
scrape_samples_scraped{instance="127.0.0.1:9102", job="shop"} => 501 @[…]
metric with the most series: shop_cart_items (500)
```

One gauge became 500 series — one per user. With real traffic and a few more labels (route × status × user), this is how servers run out of memory. The aggregated `shop_carts_open` answers the business question with one series.

### 3. Stop the bleeding at scrape time

```bash run
cat > prometheus.yml <<'EOF'
global: { scrape_interval: 1s }
scrape_configs:
  - job_name: shop
    static_configs: [{ targets: ["127.0.0.1:9102"] }]
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: shop_cart_items          # discard the per-user metric before it is stored
        action: drop
remote_write:
  - url: http://127.0.0.1:9098/api/v1/write
EOF
kill -HUP "$(cat prometheus.pid)"   # reload the configuration without restarting
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9097 'scrape_samples_post_metric_relabeling{job="shop"} == 1' 2> /dev/null)" ] && break; sleep 1; done
q 9097 'scrape_samples_scraped{job="shop"}'
q 9097 'scrape_samples_post_metric_relabeling{job="shop"}'
```

```text output
scrape_samples_scraped{instance="127.0.0.1:9102", job="shop"} => 501 @[…]
scrape_samples_post_metric_relabeling{instance="127.0.0.1:9102", job="shop"} => 1 @[…]
```

The exporter still sends 501 samples every scrape — but only 1 is stored. That protects Prometheus during an incident; the lasting fix is to remove the label in the application, so the work is never done at all. (Series already in memory age out on their own; Prometheus does not delete them at once.)

### 4. A copy in the long-term store

```bash run
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9098 'shop_carts_open' 2> /dev/null)" ] && break; sleep 1; done
q 9098 'shop_carts_open'
```

```text output
shop_carts_open{instance="127.0.0.1:9102", job="shop"} => 429 @[…]
```

The second Prometheus never scraped anything — the data arrived through `remote_write`. The local server keeps 2 days (`--storage.tsdb.retention.time=2d`), fast and small; the long-term store keeps 400 days. In production the receiver is a clustered, replicated system that can also combine data from many Prometheus servers.

### 5. Stop everything

```bash run
kill "$(cat prometheus.pid)" "$(cat longterm.pid)" "$(cat app.pid)"
```

## Common mistakes

- **Unbounded label values**: user IDs, emails, request IDs, full URLs, error messages. Use bounded values (route patterns, status classes).
- **Labelling with timestamps or versions that change every deploy.** Each new value starts new series.
- **Relabelling as the final fix.** Fix the instrumentation; relabel to protect Prometheus meanwhile.
- **Years of retention on one Prometheus.** Keep local retention short; remote_write to a durable store.
- **No cardinality monitoring.** Watch `prometheus_tsdb_head_series` and alert before memory runs out.

## Where this fits in a real system

On **Kubernetes**, Pod and container labels multiply series quickly; relabelling in the scrape configuration (often via the Prometheus Operator) controls it. **OpenTelemetry** metrics follow the same rule — attributes are labels. **Grafana** queries the long-term store for history, and per-user detail belongs in traces and logs, not in metric labels.
