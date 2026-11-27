---
id: otel-correlating-signals
title: From alert to root cause — correlating metrics, logs and traces
track: opentelemetry
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [otel-metrics-and-logs]
learning_objectives:
  - Send traces to Jaeger, metrics to a Prometheus endpoint and logs to a log output from one Collector.
  - Follow an incident from a metric, to the error log record, to the exact trace and failing span.
  - Explain how service.name becomes the Prometheus job label, and what exemplars add.
  - Record errors on spans (status and exception events) so a trace shows where a request failed.
resources:
  - title: Logs data model — trace context fields
    url: https://opentelemetry.io/docs/concepts/signals/logs/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: The top-level fields of a log record include TraceId, SpanId and TraceFlags next to Timestamp, SeverityText, Body and Resource.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Metrics data model — exemplars
    url: https://opentelemetry.io/docs/specs/otel/metrics/data-model/
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: An exemplar is a recorded value that associates OpenTelemetry context with a metric event — one use is linking metrics to traces.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Prometheus and OpenMetrics compatibility
    url: https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: service.name and service.instance.id become the job and instance labels; other resource attributes go to target_info.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Prometheus exporter for the Collector (README, v0.166.0)
    url: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.166.0/exporter/prometheusexporter/README.md
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: Exemplars are exported only in the OpenMetrics format (enable_open_metrics), and only for histograms and monotonic sums.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: path
    prompt: An alert fires on the error rate of the checkout service. What is the fastest correct path to the cause?
    options:
      - { id: a, text: "Search every trace for the last hour" }
      - { id: b, text: "Narrow by the metric's labels and time, read the error log records from that service in that window, then open the trace their trace ID names — and look for the span with error status" }
      - { id: c, text: "Restart the service" }
    answer: b
    explanation: Metrics say *that* and *how much*, logs say *what*, traces say *where* — the shared service name, time and trace ID connect them.
  - id: job
    prompt: Where does the job="shop" label on the Prometheus metric come from?
    options:
      - { id: a, text: "From the scrape configuration" }
      - { id: b, text: "From the resource attribute service.name, set here with OTEL_SERVICE_NAME — the same name Jaeger shows and the logs carry" }
      - { id: c, text: "From the metric name" }
    answer: b
    explanation: One service name across all signals is what makes them joinable; set it explicitly for every service.
  - id: span-status
    prompt: The failing trace has two spans, both with error status, but only one has an exception event. Which span is the root cause?
    options:
      - { id: a, text: "The parent POST /checkout" }
      - { id: b, text: "charge card — it recorded the exception; the parent is marked as failed only because its child failed" }
      - { id: c, text: "Neither" }
    answer: b
    explanation: Record the exception where it happens, and mark callers as failed so the error shows up at every level.
verification:
  method: executed
  details: Every command is run by the test suite with the OpenTelemetry JavaScript SDK (api 1.10.0, sdk-node 0.301.2, sdk-metrics and sdk-logs 3.1.1, OTLP exporters 0.301.2), Collector 0.166.0 and Jaeger 2.23.0, after the earlier OpenTelemetry lessons, and its output is compared with this lesson. Trace IDs are random, so the lab compares them instead of printing them. The statement that this JavaScript SDK records no exemplars comes from inspecting @opentelemetry/sdk-metrics 3.1.1, which contains no exemplar code. Checked against the OpenTelemetry documentation and specification on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-27
content_version: 2
---

## The idea in one sentence

During an incident, **metrics** tell you *that* something is wrong and how much, **logs** tell you *what* happened, and **traces** tell you *where* — and OpenTelemetry joins them with the same **service name**, the same **time**, and the **trace ID** carried by every log record.

## Explain it like I'm twelve

The school's scoreboard shows "1 lunch went wrong today" (a metric). The canteen diary says "12:40 — card machine froze for pupil #13" (a log). Pupil #13's lunch story shows the queue was fine, serving was fine, and the card machine step failed (a trace). Each clue points to the next: scoreboard → diary page for that time → the story with that pupil's number.

## What problem it solves

Without correlation, an engineer sees an error spike on a dashboard, then searches logs by guessing a time range, then searches traces by guessing a request — three separate tools and a lot of copy-paste. With correlated signals the path is mechanical: metric labels narrow the service and time; error logs in that window name a trace ID; the trace shows the failing span and its exception. Tools such as Grafana build buttons on top of exactly these links.

## How it works

![](media:opentelemetry/correlation.svg)

- **Same service name everywhere.** `OTEL_SERVICE_NAME` sets the resource attribute `service.name`. Jaeger shows it as the service, log records carry it as a resource attribute, and the Prometheus exporter turns it into the `job` label (`service.instance.id` becomes `instance`).
- **Trace ID on log records.** A record emitted while a span is active carries its trace and span IDs (previous lesson).
- **Errors on spans.** `span.recordException(error)` adds an `exception` event with the message and stack trace; `span.setStatus({ code: ERROR })` marks the span as failed.
- **Exemplars** go one step further: a metric data point carries the trace ID of an example measurement, so a dashboard can jump from a spike straight to a trace. The data model defines them, and the Collector's Prometheus exporter passes them on only in OpenMetrics format — but the JavaScript SDK used here (sdk-metrics 3.1.1) does not record any, so this lab goes through the logs instead.

## Try it yourself

> **Local lab** — continues in `otel-node-lab` with the packages from *Metrics and logs with OpenTelemetry*, and Jaeger from *The Collector pipeline and Jaeger*. Every command is run automatically in DevForge's tests. A shop handles 20 checkouts; one of them fails.

### 1. One Collector, three destinations

```bash run
jaeger \
  --set=receivers.otlp.protocols.grpc.endpoint=127.0.0.1:14317 \
  --set=receivers.otlp.protocols.http.endpoint=127.0.0.1:14318 \
  --set=extensions.jaeger_query.http.endpoint=127.0.0.1:16686 \
  --set=extensions.jaeger_query.grpc.endpoint=127.0.0.1:16685 \
  --set=service.telemetry.metrics.level=none \
  > incident-jaeger.log 2>&1 &
echo $! > incident-jaeger.pid
cat > collector-incident.yaml <<'YAML'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  otlp/jaeger:                   # traces → Jaeger over OTLP/gRPC
    endpoint: 127.0.0.1:14317
    tls:
      insecure: true
  prometheus:                    # metrics → a /metrics endpoint Prometheus can scrape
    endpoint: 127.0.0.1:8889
  debug:                         # logs → printed here; in production, a log store
    verbosity: detailed
service:
  telemetry:
    metrics:
      level: none                # keep the Collector's own metrics port free for Jaeger
  pipelines:
    traces:  { receivers: [otlp], exporters: [otlp/jaeger] }
    metrics: { receivers: [otlp], exporters: [prometheus] }
    logs:    { receivers: [otlp], exporters: [debug] }
YAML
otelcol validate --config=collector-incident.yaml && echo "configuration is valid"
otelcol --config=collector-incident.yaml > incident-otelcol.log 2>&1 &
echo $! > incident-otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' incident-otelcol.log && curl -sf -o /dev/null http://127.0.0.1:16686/ && break; sleep 1; done
grep -q 'Everything is ready' incident-otelcol.log && echo "Collector is ready"
curl -sf -o /dev/null http://127.0.0.1:16686/ && echo "Jaeger is ready"
```

```text output
configuration is valid
Collector is ready
Jaeger is ready
```

### 2. Twenty checkouts, one failure

```bash run
cat > shop.mjs <<'JS'
import { logs, metrics, trace, SeverityNumber, SpanStatusCode } from "@opentelemetry/api";
import { sdk } from "./telemetry.mjs";   // the three-signal setup from the previous lesson
const tracer = trace.getTracer("shop");
const requests = metrics.getMeter("shop").createCounter("checkout.requests", { description: "Checkout requests by outcome" });
const log = logs.getLogger("shop");
for (let order = 1001; order <= 1020; order++) {
  tracer.startActiveSpan("POST /checkout", (span) => {
    const charge = tracer.startSpan("charge card");
    if (order === 1013) {
      const error = new Error("payment provider timed out after 3 s");
      charge.recordException(error);                                   // an "exception" event with message and stack
      charge.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.setStatus({ code: SpanStatusCode.ERROR });                  // the request failed too
      log.emit({ severityNumber: SeverityNumber.ERROR, severityText: "ERROR",
                 body: `checkout failed for order ${order}: ${error.message}`, attributes: { "order.id": order } });
      requests.add(1, { outcome: "error" });
    } else {
      log.emit({ severityNumber: SeverityNumber.INFO, severityText: "INFO", body: `order ${order} placed`, attributes: { "order.id": order } });
      requests.add(1, { outcome: "ok" });
    }
    charge.end();
    span.end();
  });
}
await sdk.shutdown();
JS
OTEL_SERVICE_NAME=shop node shop.mjs
for i in $(seq 1 30); do curl -s http://127.0.0.1:8889/metrics | grep '^checkout_requests_total' > /dev/null && break; sleep 1; done
# the alert's view: drop the per-process labels to keep the line short
curl -s http://127.0.0.1:8889/metrics | grep '^checkout_requests_total' \
  | sed -E 's/instance="[^"]*",//; s/,otel_scope_[a-z_]*="[^"]*"//g'
```

```text output
checkout_requests_total{job="shop",outcome="error"} 1
checkout_requests_total{job="shop",outcome="ok"} 19
```

This is what an alert on the error ratio would see: one failed checkout out of 20 for `job="shop"`. The `job` label is the service name you set with `OTEL_SERVICE_NAME`, and the dotted metric name became `checkout_requests_total` in Prometheus style. The metric cannot say *which* request failed — metrics are aggregated.

### 3. From the metric to the log

Look for error records from the same service in that window:

```bash run
for i in $(seq 1 30); do grep -q '^SeverityText: ERROR' incident-otelcol.log && break; sleep 1; done
grep -A3 '^SeverityText: ERROR' incident-otelcol.log | grep -E '^SeverityText|^Body'
trace_id=$(grep -A8 '^SeverityText: ERROR' incident-otelcol.log | sed -n 's/^Trace ID: //p')
log_span_id=$(grep -A9 '^SeverityText: ERROR' incident-otelcol.log | sed -n 's/^Span ID: //p')
[ ${#trace_id} -eq 32 ] && echo "the error record names a trace: yes"
```

```text output
SeverityText: ERROR
Body: Str(checkout failed for order 1013: payment provider timed out after 3 s)
the error record names a trace: yes
```

The log says *what* happened, and its `Trace ID` (32 hexadecimal digits, different on every run) says *which request*.

### 4. From the log to the trace

```bash run
for i in $(seq 1 30); do curl -sf -o incident.json "http://127.0.0.1:16686/api/v3/traces/$trace_id" && break; sleep 1; done
echo "spans in the trace:"; grep -o '"name":"\(POST /checkout\|charge card\)"' incident.json | LC_ALL=C sort | sed 's/^/  /'
echo "failed spans:"; grep -o '"status":{[^}]*}' incident.json | LC_ALL=C sort -r | sed 's/^/  /'
echo "exception recorded:"; grep -o '"key":"exception.message","value":{"stringValue":"[^"]*"}' incident.json | sed 's/.*"stringValue":/  /; s/}$//'
grep -q "\"spanId\":\"$log_span_id\",\"flags\":[0-9]*,\"name\":\"POST /checkout\"" incident.json \
  && echo "the log record's span ID is the span POST /checkout: yes"
```

```text output
spans in the trace:
  "name":"POST /checkout"
  "name":"charge card"
failed spans:
  "status":{"message":"payment provider timed out after 3 s","code":2}
  "status":{"code":2}
exception recorded:
  "payment provider timed out after 3 s"
the log record's span ID is the span POST /checkout: yes
```

Read it like an engineer on call:

- Both spans have status code `2`, which is *Error* in OTLP. Only `charge card` carries a message and an `exception` event — that is where it failed; `POST /checkout` is marked failed because its child failed.
- The log record points at `POST /checkout` because that was the **active** span when the log was written: `charge card` was started with `startSpan`, which does not make it active. Use `startActiveSpan` if logs inside a span should point at it.
- In the Jaeger interface (<http://localhost:16686>, service **shop**, search by Trace ID) the same trace appears as a waterfall with the error highlighted. This step is not part of the automatic tests.

### 5. Clean up

```bash run
kill "$(cat incident-otelcol.pid)" "$(cat incident-jaeger.pid)"
for pid in $(cat incident-otelcol.pid incident-jaeger.pid); do while kill -0 "$pid" 2> /dev/null; do sleep 0.2; done; done
echo stopped
```

```text output
stopped
```

## Common mistakes

- **Different service names per signal.** If metrics say `checkout`, logs say `shop-api` and traces say `shop`, nothing joins. Set `OTEL_SERVICE_NAME` once per service.
- **Logging outside the span.** A record written after `span.end()`, or in a callback that lost its context, has no trace ID.
- **Errors only in logs.** Without `setStatus(ERROR)` and `recordException`, the trace looks healthy and a search for failed traces finds nothing.
- **Putting the trace ID in a metric label.** Every request becomes a new time series; use exemplars or logs for that link.
- **Sampling away the evidence.** With 10% head sampling, the failing request's trace is probably gone even though the log still names its ID — one reason for tail sampling (previous lesson).

## Where this fits in a real system

**Prometheus** scrapes the Collector's endpoint and fires the alert; **Grafana** shows the metric, a log panel filtered by the same `job` and time, and turns trace IDs into links to **Jaeger**. In **Kubernetes**, the Collector usually runs as a DaemonSet or a gateway Deployment and adds resource attributes such as `k8s.pod.name`, so all three signals can also be filtered by pod.
