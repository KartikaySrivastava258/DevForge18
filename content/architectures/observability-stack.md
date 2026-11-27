---
id: observability-stack
title: Metrics, logs and traces for a service
summary: Services instrumented with the OpenTelemetry SDK send traces, metrics and logs to one Collector; Prometheus scrapes the metrics and evaluates SLO burn-rate alerts that Alertmanager routes, Jaeger stores the traces, and Grafana shows the signals joined by service name, time and trace ID.
problem: When users report that a service is slow or failing, the team must be able to see that something is wrong, how much, where in the request path and what happened — without logging into machines and without paying to keep every trace.
tracks: [opentelemetry, prometheus-grafana, docker]
diagram: media:architecture/observability-stack.svg
components:
  - { name: Instrumented services, track: opentelemetry, role: "The OpenTelemetry SDK records spans, metrics (counters, histograms) and log records under one service name; a log record written while a span is active carries its trace ID." }
  - { name: OpenTelemetry Collector, track: opentelemetry, role: "Receives OTLP from every service, batches it and runs one pipeline per signal, exporting traces to Jaeger, metrics to Prometheus and logs to a log store. It passes data on; it does not keep it." }
  - { name: Jaeger, track: opentelemetry, role: "Stores traces and lets you search them, for example by duration, and view each request as a waterfall of spans." }
  - { name: Prometheus, track: prometheus-grafana, role: "Scrapes the Collector's metrics endpoint, stores the time series, precomputes ratios with recording rules and evaluates alerting rules such as SLO burn rates." }
  - { name: Alertmanager, track: prometheus-grafana, role: "Routes firing alerts by their labels to receivers, groups related alerts, inhibits symptoms of a known cause and respects silences." }
  - { name: Grafana, track: prometheus-grafana, role: "Dashboards provisioned from files query Prometheus and Jaeger; Grafana stores no metrics itself." }
  - { name: Containers, track: docker, role: "The Collector and every back end run as containers from one Compose file, with ports chosen so that no two components clash." }
flow:
  - A request enters a service; the SDK starts a span, and HTTP instrumentation passes the trace context to downstream services (for a queue, the producer injects it into message headers and the consumer extracts it).
  - The service counts the request, records its latency in a histogram and writes log records inside the span, so each record carries the trace ID.
  - All three signals go over OTLP to the Collector, which batches them and exports each to its back end.
  - Prometheus scrapes the metrics, computes the error ratio over several windows and fires a burn-rate alert when the error budget is being spent too fast.
  - Alertmanager routes the alert to the on-call person, who opens Grafana, narrows the problem by service and time, follows a trace ID from a log record to Jaeger and finds the span that was slow or failed.
trade_offs:
  - { choice: "One Collector between services and back ends", gain: "Services speak one protocol; batching, sampling and the choice of back ends live in one configuration that can change without touching code.", cost: "Another component to run; it only holds data briefly, so data can be lost if a back end stays down." }
  - { choice: "Head sampling with a parent-based ratio", gain: "Tracing stays affordable, and kept traces are whole because downstream services follow the caller's decision.", cost: "The decision is made before anyone knows whether the request will fail or be slow, so interesting traces are thrown away; rates must come from metrics, which see every request." }
  - { choice: "Paging on SLO burn rate instead of fixed error thresholds", gain: "People are woken only when users are affected enough to threaten the budget.", cost: "The team must choose an SLI that users feel and an SLO, and maintain multiwindow rules that need their own tests (promtool test rules)." }
  - { choice: "Bounded labels on metrics, high-cardinality details on spans and logs", gain: "Prometheus stays small and fast.", cost: "Metrics cannot be queried per user or per request; that question goes through logs and traces." }
failure_modes:
  - { failure: "Each signal uses a different service name", effect: "Metrics, logs and traces cannot be joined during an incident.", mitigation: "Set OTEL_SERVICE_NAME once per service so every signal carries the same service.name." }
  - { failure: "A label with unbounded values (user ID, request ID, full URL)", effect: "The number of series explodes and Prometheus runs out of memory.", mitigation: "Use bounded values such as route patterns and status classes; drop the metric with metric_relabel_configs until the code is fixed; alert on prometheus_tsdb_head_series." }
  - { failure: "A consumer starts its span without extracting the context", effect: "The trace breaks into unrelated pieces at the queue.", mitigation: "Extract the context from message headers before starting the consumer span; use span links when one batch has many producers." }
  - { failure: "Prometheus itself stops", effect: "No alerts fire, and the silence looks like health.", mitigation: "A watchdog alert that always fires, so its absence is noticed." }
alternatives:
  - { instead_of: "The OpenTelemetry SDK with self-run back ends", consider: "A vendor agent and back end such as Datadog", when: "You are committed to that vendor and want its native features with the least setup, accepting that changing back end later means re-instrumenting." }
  - { instead_of: "Code instrumentation", consider: "eBPF auto-instrumentation (Grafana Beyla, now OpenTelemetry OBI)", when: "You need basic request metrics or traces from Linux services you cannot or do not want to change." }
  - { instead_of: "Long retention in one Prometheus", consider: "remote_write to Thanos, Grafana Mimir or VictoriaMetrics", when: "You need long retention, a global view across many Prometheus servers or high availability." }
decision_prompts:
  - Which SLI do users of this service actually feel, and which SLO and period do you choose?
  - Which attributes may become metric labels, and which must stay on spans and logs only?
  - What sampling do you use, and which traces must never be lost?
  - Which alerts page a person and which become tickets, and who receives each?
  - How does trace context cross every asynchronous hop in your system?
learn_more:
  - { kind: lesson, id: otel-collector-and-jaeger }
  - { kind: lesson, id: otel-correlating-signals }
  - { kind: lesson, id: prometheus-slos-and-error-budgets }
  - { kind: lesson, id: prometheus-alerting-and-alertmanager }
  - { kind: lab, id: opentelemetry-investigate-a-slow-request }
  - { kind: project, id: otel-telemetry-pipeline }
capstones: [capstone-a, capstone-c, capstone-g]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Add this stack to any service that people depend on, and especially once a request crosses more than one service or
queue: then the logs of one service no longer explain a slow request. It is a layer under the other reference
architectures rather than an alternative to them — the event-driven design needs trace context to cross Kafka, and the
retrieval-augmented assistant traces each question through retrieval and the model call.

The stack does not decide what matters. Without an SLO based on what users feel (requests, page loads, jobs
completed — not CPU), it produces dashboards and noisy alerts rather than answers; choose the SLI before building
panels.

## How it works

Each signal answers a different question, and the design depends on being able to move between them. Metrics see
every request and say that something is wrong and how much; logs say what happened; traces say where the time went.
They join because every signal carries the same service name and time, and every log record written inside a span
carries that span's trace ID — so an alert leads to a time window, the window to log records, and a record's trace ID
to the exact request in Jaeger.

The Collector is what keeps this manageable. Services send all three signals to it in one protocol, and its
configuration decides batching, sampling and where each signal goes. Alerts are tied to an error budget rather than
to single errors, so the people who are paged are paged for something users feel.
