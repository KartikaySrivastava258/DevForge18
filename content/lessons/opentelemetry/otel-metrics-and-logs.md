---
id: otel-metrics-and-logs
title: Metrics and logs with OpenTelemetry
track: opentelemetry
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [otel-collector-and-jaeger]
learning_objectives:
  - Record metrics with the OpenTelemetry API (a counter with attributes and a histogram) and export them through the Collector.
  - Explain why histogram bucket boundaries must match the unit, and set them with an advisory parameter.
  - Send log records through the same pipeline, and show that records emitted during a span carry its trace and span IDs.
  - Configure one Collector with separate pipelines for traces, metrics and logs.
resources:
  - title: Metrics (OpenTelemetry concepts)
    url: https://opentelemetry.io/docs/concepts/signals/metrics/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Instrument kinds — counter (only goes up), gauge, histogram (client-side aggregation for value statistics).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Metrics SDK specification — explicit bucket histogram aggregation
    url: https://opentelemetry.io/docs/specs/otel/metrics/sdk/
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: The default boundaries [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000], and the ExplicitBucketBoundaries advisory parameter.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Logs (OpenTelemetry concepts)
    url: https://opentelemetry.io/docs/concepts/signals/logs/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Applications should use their usual logging library with an OpenTelemetry appender (bridge); the Logs Bridge API is for those appenders, not for application code.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: buckets
    prompt: A histogram records request durations in seconds with the SDK's default boundaries (0, 5, 10, 25 … 10000). What goes wrong?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "The defaults suit milliseconds: every request under 5 s lands in one bucket, so percentiles cannot be told apart — set boundaries that fit the unit and the latencies you care about" }
      - { id: c, text: "The histogram refuses seconds" }
    answer: b
    explanation: The lab shows 0.08 s, 0.12 s and 0.31 s all counted in the (0, 5] bucket until boundaries in seconds are advised.
  - id: attributes
    prompt: The orders counter has the attribute payment.method. What does the Collector receive?
    options:
      - { id: a, text: "One total" }
      - { id: b, text: "One data point per attribute value (upi: 2, card: 1) — attributes are dimensions, like Prometheus labels, so keep their values bounded" }
      - { id: c, text: "One data point per order" }
    answer: b
    explanation: The same cardinality rule as in the Prometheus track applies to OpenTelemetry attributes.
  - id: correlation
    prompt: Why do the log records in the lab carry trace IDs without any code to add them?
    options:
      - { id: a, text: "The Collector adds them" }
      - { id: b, text: "They were emitted inside an active span, and the SDK attaches the current trace and span IDs to every log record — so a log line leads straight to its trace" }
      - { id: c, text: "Logs always have trace IDs" }
    answer: b
    explanation: Outside a span the IDs would be empty. Logging-library appenders get the same behaviour.
verification:
  method: executed
  details: Every command is run by the test suite with the OpenTelemetry JavaScript SDK (api 1.10.0, sdk-node 0.301.2, sdk-metrics and sdk-logs 3.1.1, OTLP exporters 0.301.2) and Collector 0.166.0, after the earlier OpenTelemetry lessons, and its output is compared with this lesson. Trace and span IDs are random, so the lab compares them instead of printing them. Checked against the OpenTelemetry documentation and specification on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

OpenTelemetry is not only traces: the same SDK records **metrics** (counters, histograms) and **logs**, sends all three through one Collector, and automatically stamps log records with the **trace ID** of the request that produced them.

## Explain it like I'm twelve

A school canteen keeps three records. A **tally** of meals served by payment type (metrics: counts and totals). A **diary** of notable events: "ran out of rice at 12:40" (logs). And for any one pupil's lunch, the **story** of each step — queue, serve, pay (a trace). If every diary entry notes which pupil's lunch it was about, you can jump from "ran out of rice" straight to that pupil's story.

That note is the **trace ID** on each log record.

Where the analogy breaks: the tally does not record individual pupils — metrics are aggregated, which is what keeps them cheap.

## What problem it solves

Teams often run three separate tools — a metrics library, a logging library and a tracing agent — that know nothing about each other. OpenTelemetry gives one API and one export path for all three, with shared resource attributes (service name, version) and automatic correlation, so an alert from a metric leads to the logs and traces that explain it.

## How it works

![](media:opentelemetry/three-signals.svg)

- **Metrics**: a `Meter` creates instruments — `createCounter` (only up), `createHistogram` (a distribution), gauges and their asynchronous versions. Attributes on a measurement become dimensions. A metric reader exports aggregated values periodically (and on shutdown).
- **Histogram buckets**: the SDK's default boundaries are `0, 5, 10, 25 … 10000` — sensible for milliseconds. For seconds, pass `advice: { explicitBucketBoundaries: [...] }` when creating the histogram (or configure a view).
- **Logs**: log records go through a `LoggerProvider` and exporter. A record emitted while a span is active carries that span's trace ID and span ID. Applications normally log with their usual library and an OpenTelemetry appender; this lab calls the logs API directly to show the mechanics.
- **The Collector** runs one pipeline per signal: `traces`, `metrics`, `logs`.

## Try it yourself

> **Local lab** — continues in `otel-node-lab` from *Instrumenting a Node.js service* and *The Collector pipeline and Jaeger*. It installs the metrics and logs SDK packages at the versions sdk-node 0.301.2 already uses. Every command is run automatically in DevForge's tests.

### 1. A Collector with three pipelines, and the SDK set up for all three signals

```bash run
npm install --silent --no-audit --no-fund --save-exact \
  @opentelemetry/sdk-metrics@3.1.1 @opentelemetry/sdk-logs@3.1.1 \
  @opentelemetry/exporter-metrics-otlp-proto@0.301.2 @opentelemetry/exporter-logs-otlp-proto@0.301.2
cat > collector-all.yaml <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:  { receivers: [otlp], exporters: [debug] }
    metrics: { receivers: [otlp], exporters: [debug] }
    logs:    { receivers: [otlp], exporters: [debug] }
EOF
cat > telemetry.mjs <<'EOF'
// One SDK, three signals, all sent to the Collector over OTLP/HTTP.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
export const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: "http://127.0.0.1:4318/v1/metrics" }),
    exportIntervalMillis: 60000,   // metrics are exported every minute — and once more at shutdown
  }),
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: "http://127.0.0.1:4318/v1/logs" }) })],
});
sdk.start();
EOF
otelcol validate --config=collector-all.yaml && echo "Collector configuration is valid"
```

```text output
Collector configuration is valid
```

### 2. Three orders: a counter, a histogram and a log line each

```bash run
cat > checkout.mjs <<'EOF'
import { logs, metrics, trace, SeverityNumber } from "@opentelemetry/api";
import { sdk } from "./telemetry.mjs";
const meter = metrics.getMeter("checkout");
const orders = meter.createCounter("checkout.orders", { description: "Orders placed", unit: "{order}" });
const duration = meter.createHistogram("checkout.duration", { description: "Time to place an order", unit: "s",
  ...(process.env.BUCKETS === "seconds" ? { advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1] } } : {}) });
const logger = logs.getLogger("checkout");
const tracer = trace.getTracer("checkout");
for (const [items, seconds] of [[2, 0.12], [1, 0.08], [5, 0.31]]) {
  tracer.startActiveSpan("place order", (span) => {
    orders.add(1, { "payment.method": items > 2 ? "card" : "upi" });
    duration.record(seconds);
    logger.emit({ severityNumber: SeverityNumber.INFO, severityText: "INFO", body: `order placed with ${items} items`, attributes: { "order.items": items } });
    console.log(`span ${span.spanContext().traceId}`);
    span.end();
  });
}
await sdk.shutdown();   // flushes spans, metrics and logs
EOF
otelcol --config=collector-all.yaml > signals.log 2>&1 &
echo $! > signals.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' signals.log && break; sleep 1; done
grep -q 'Everything is ready' signals.log || { echo "the Collector did not start:"; tail -n 5 signals.log; exit 1; }
OTEL_SERVICE_NAME=checkout node checkout.mjs > spans.txt
for i in $(seq 1 30); do grep -q '^HistogramDataPoints' signals.log && [ "$(grep -c '^LogRecord #' signals.log)" -ge 3 ] && break; sleep 1; done
grep -E '^     -> Name: checkout|^     -> payment.method|^Value: |^Count: |^Sum: ' signals.log
```

```text output
     -> Name: checkout.orders
     -> payment.method: Str(upi)
Value: 2.000000
     -> payment.method: Str(card)
Value: 1.000000
     -> Name: checkout.duration
Count: 3
Sum: 0.510000
```

The counter arrived as one data point per `payment.method` value — two UPI orders and one card order. The histogram summarises all three durations: 3 observations adding up to 0.51 s.

### 3. Buckets that fit the unit

```bash run
grep -E '^ExplicitBounds #[0-2]:|^Buckets #[0-2],' signals.log
```

```text output
ExplicitBounds #0: 0.000000
ExplicitBounds #1: 5.000000
ExplicitBounds #2: 10.000000
Buckets #0, Count: 0
Buckets #1, Count: 3
Buckets #2, Count: 0
```

The default boundaries start `0, 5, 10 …`, so all three orders (0.08–0.31 s) fell into the `(0, 5]` bucket — you could not tell a fast order from a 4-second one. Run it again with boundaries in seconds:

```bash run
: > signals.log.2
kill "$(cat signals.pid)"; while kill -0 "$(cat signals.pid)" 2> /dev/null; do sleep 0.2; done
otelcol --config=collector-all.yaml > signals.log.2 2>&1 &
echo $! > signals.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' signals.log.2 && break; sleep 1; done
BUCKETS=seconds OTEL_SERVICE_NAME=checkout node checkout.mjs > /dev/null
for i in $(seq 1 30); do grep -q '^HistogramDataPoints' signals.log.2 && break; sleep 1; done
grep -E '^ExplicitBounds|^Buckets #[0-5],' signals.log.2
```

```text output
ExplicitBounds #0: 0.050000
ExplicitBounds #1: 0.100000
ExplicitBounds #2: 0.250000
ExplicitBounds #3: 0.500000
ExplicitBounds #4: 1.000000
Buckets #0, Count: 0
Buckets #1, Count: 1
Buckets #2, Count: 1
Buckets #3, Count: 1
Buckets #4, Count: 0
Buckets #5, Count: 0
```

Now each order lands in its own range — 0.08 s in `(0.05, 0.1]`, 0.12 s in `(0.1, 0.25]`, 0.31 s in `(0.25, 0.5]` — and percentiles become meaningful.

### 4. Logs that point to their traces

```bash run
grep -E '^Body: |^SeverityText: ' signals.log
log_traces=$(grep -E '^Trace ID: ' signals.log | sed 's/Trace ID: //' | sort)
span_traces=$(sed 's/span //' spans.txt | sort)
[ "$log_traces" = "$span_traces" ] && echo "each log record carries the trace ID of the span it was written in: yes ($(echo "$log_traces" | wc -l | tr -d ' ') of 3)"
kill "$(cat signals.pid)"
```

```text output
SeverityText: INFO
Body: Str(order placed with 2 items)
SeverityText: INFO
Body: Str(order placed with 1 items)
SeverityText: INFO
Body: Str(order placed with 5 items)
each log record carries the trace ID of the span it was written in: yes (3 of 3)
```

Nobody added trace IDs to the log calls: the SDK attached the active span's trace and span IDs to each record. In a log tool, "order placed with 5 items" now links to the trace of exactly that order.

## Common mistakes

- **Default histogram buckets for seconds.** Advise boundaries that match the unit and your SLO thresholds.
- **High-cardinality attributes on metrics** (user or order IDs). They belong on spans and logs, not on metrics.
- **Calling the logs API from application code everywhere.** Use your logging library with an OpenTelemetry appender; it adds trace context the same way.
- **Forgetting shutdown.** Short-lived processes must flush (`sdk.shutdown()`), or the last metrics and logs are lost.
- **One pipeline for everything.** Traces, metrics and logs need separate pipelines (and often different exporters and sampling).

## Where this fits in a real system

The Collector's metrics pipeline can export to **Prometheus** (remote write or a scrape endpoint) and **Grafana**, logs to a log store, and traces to **Jaeger**. Resource attributes such as `service.name` become the labels **Grafana** variables use, and the trace IDs in logs are what the next lessons follow from an alert to a slow request.
