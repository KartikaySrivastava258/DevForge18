---
id: otel-telemetry-pipeline
track: opentelemetry
title: Unified telemetry pipeline
level: intermediate
estimated_hours: 5
prerequisites: [otel-collector-and-jaeger, otel-metrics-and-logs, otel-correlating-signals]
related_tracks: [prometheus-grafana]
user_stories:
  - As a platform engineer, I want one Collector to receive traces, metrics and logs so that every service sends OTLP to one place and the backends can change without touching the services.
  - As a data-protection officer, I want customers' email addresses removed before telemetry leaves the Collector so that the trace and log stores hold no personal data.
  - As a developer investigating an error, I want the log record to keep its trace ID so that I can jump from the error to the request that caused it.
acceptance_criteria:
  - The configuration is valid and the Collector accepts OTLP over gRPC (4317) and HTTP (4318).
  - Traces reach Jaeger; metrics are exposed for Prometheus on port 8889; log records are written as JSON lines to /out/logs.jsonl, with their trace IDs.
  - Every span, metric and log record carries deployment.environment = lab.
  - user.email is removed from spans and log records, and other attributes stay.
  - Spans named GET /healthz are dropped.
  - Every pipeline starts with memory_limiter and ends with batch.
rubric:
  - { criterion: "Pipeline design", excellent: "One component per job, named instances (attributes/redact, filter/healthchecks), comments that say why each exists, and processors in a deliberate order (limit first, filter early, batch last).", good: "All requirements met in a readable configuration.", needs_work: "Copied blocks, unused components, or processors in an order that wastes work." }
  - { criterion: "Privacy", excellent: "Redaction applied to every signal that can carry the attribute, tested with real data, and a note on what else could leak (URLs, exception messages).", good: "user.email is removed from spans and logs.", needs_work: "Redaction only on one signal, or deleting whole spans to hide one attribute." }
  - { criterion: "Operations", excellent: "memory_limiter sized for the container, batch timeouts explained, and the Collector's own health and metrics considered.", good: "Safety processors present and correctly placed.", needs_work: "No memory limit, or batch first." }
hints:
  - Write the three pipelines first with no processors, run send_sample.py, and see each signal arrive. Then add one processor at a time.
  - Named instances let you use a component twice with different settings — attributes/redact and filter/healthchecks are names you choose after the slash.
  - The filter processor takes OTTL conditions; a span matching 'name == "GET /healthz"' is dropped.
  - Resource attributes are not labels by default in the Prometheus exporter; resource_to_telemetry_conversion copies them onto every metric.
  - The file exporter needs a path inside the container (/out/logs.jsonl); the check mounts /out for you.
stretch_goals:
  - Hash enduser.id instead of deleting it, so you can still count distinct users without storing who they are.
  - Add a second Collector tier with the probabilistic sampler (see "Sampling traces without losing the story") and keep the same hash seed in every instance.
  - Scrape port 8889 from Prometheus and graph orders per minute.
starter: starter
solution: solution
check_needs: [docker, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The orders API already sends traces, metrics and logs over OTLP, but the Collector in front of it only forwards
traces — unchanged. Customers' email addresses reach the trace store, a health check adds a useless span every
few seconds, and metrics and logs are dropped on the floor.

Rewrite the Collector configuration so that **one Collector handles all three signals**: traces to Jaeger,
metrics for Prometheus to scrape, logs to a file; every signal labelled with its environment; personal data
removed; noise filtered; and the Collector protected against memory spikes. The starter's README is the
specification, and `send_sample.py` sends exactly the data the check sends, so you can see the effect of every
change.

## Getting started

1. Copy the starter folder and run the lab (Jaeger UI on http://localhost:16686):

   ```bash
   docker network create otel-pipeline
   docker run -d --name jaeger --network otel-pipeline -p 127.0.0.1:16686:16686 jaegertracing/jaeger:2.23.0
   mkdir -p out && chmod 777 out
   docker run -d --name collector --network otel-pipeline -p 127.0.0.1:4318:4318 -p 127.0.0.1:8889:8889 \
     -v "$PWD/otel-collector.yaml:/cfg.yaml:ro" -v "$PWD/out:/out" otel/opentelemetry-collector:0.165.0 --config=/cfg.yaml
   python3 send_sample.py http://127.0.0.1:4318
   ```

2. After each change: `docker restart collector`, send the sample again, and look in Jaeger, at
   http://localhost:8889/metrics and in `out/logs.jsonl`. `docker logs collector` shows configuration errors.
3. Clean up (`docker rm -f jaeger collector && docker network rm otel-pipeline`) and run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
