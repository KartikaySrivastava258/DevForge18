# One telemetry pipeline for the orders API

The orders API sends traces, metrics and logs over OTLP. Today the Collector forwards traces only, unchanged —
including customers' email addresses and a health-check span every few seconds — and drops metrics and logs.
Rewrite `otel-collector.yaml` so that one Collector handles all three signals:

| Requirement | Detail |
|---|---|
| Receive | OTLP over gRPC (port 4317) and HTTP (port 4318) on all interfaces |
| Traces | to Jaeger over OTLP/gRPC at `jaeger:4317` (no TLS in the lab) |
| Metrics | exposed for Prometheus to scrape, on port 8889 |
| Logs | written as JSON lines to `/out/logs.jsonl` (the file exporter) |
| Environment | every span, metric and log carries the resource attribute `deployment.environment` = `lab` |
| Privacy | the attribute `user.email` is removed from spans and log records before they leave the Collector |
| Noise | spans named `GET /healthz` are dropped |
| Safety | `memory_limiter` is the first processor and `batch` the last in every pipeline |

`send_sample.py` sends one sample of each signal (the same data the check sends).
