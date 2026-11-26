# OpenTelemetry — research notes

Checked 2026-11-26 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| OpenTelemetry Collector (core distribution `otelcol`) | 0.166.0 | pinned in CI since milestone 4 |
| Jaeger | 2.23.0 | pinned in CI; all-in-one with in-memory storage |
| `@opentelemetry/api` | 1.10.0 | exports `trace`, `metrics`, `logs`, `propagation`, `context` |
| `@opentelemetry/sdk-node`, OTLP proto exporters, `instrumentation-http` | 0.301.2 | |
| `@opentelemetry/sdk-metrics`, `sdk-logs`, `sdk-trace` | 3.1.1 | sdk-node 0.301.2 depends on these exact versions |

## Facts confirmed (source → wording)

- Metrics concepts (opentelemetry.io/docs/concepts/signals/metrics/): counter only goes up; histogram is a client-side aggregation of values.
- Metrics SDK spec (…/specs/otel/metrics/sdk/): default explicit bucket boundaries `[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]`; the `ExplicitBucketBoundaries` advisory parameter.
- Logs concepts (…/concepts/signals/logs/): the Logs Bridge API is for appenders (logging-library bridges), not application code; log record top-level fields include TraceId, SpanId, TraceFlags.
- Metrics data model (…/specs/otel/metrics/data-model/): "An exemplar is a recorded value that associates OpenTelemetry context to a metric event"; one use case is linking traces with metrics.
- Prometheus compatibility (…/specs/otel/compatibility/prometheus_and_openmetrics/): `service.name` and `service.instance.id` become `job` and `instance`; other resource attributes go to `target_info`.
- Prometheus exporter README (contrib v0.166.0): exemplars are exported only in OpenMetrics format (`enable_open_metrics`), only for histograms and monotonic sums.
- Sampling concepts (…/concepts/sampling/): head sampling decides early without the whole trace, most commonly consistent probability sampling on the trace ID; tail sampling decides after all or most spans; three downsides of tail sampling (difficult to implement and operate, …).
- SDK env vars (…/specs/otel/configuration/sdk-environment-variables/): `OTEL_TRACES_SAMPLER` default `parentbased_always_on`; known values include `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio`; ratio in `OTEL_TRACES_SAMPLER_ARG`.
- Trace SDK spec (…/specs/otel/trace/sdk/): default sampler `ParentBased(root=AlwaysOn)`; "The TraceIdRatioBased sampler is deprecated in favor of the composable ProbabilitySampler"; SDKs shall not remove or change the original behaviour.
- Probabilistic sampler README (contrib v0.166.0): `sampling_percentage`; mode default `hash_seed`; every Collector in a tier must use the same `hash_seed`.
- Tail sampling README (contrib main): `decision_wait` default 30s, `num_traces` default 50000; "All spans for a given trace MUST be received by the same collector instance".

## Observed while building lessons

- `otelcol components` (0.166.0, core): processors `attributes batch filter memory_limiter probabilistic_sampler queue_batch resource resource_detection span transform` — **no `tail_sampling`**; exporters include `debug file otlp_grpc otlp_http prometheus prometheus_remote_write`; the older exporter name `otlp` still works.
- The JavaScript `sdk-node` 0.301.2 builds samplers from env only for the six values above (no ProbabilitySampler); `@opentelemetry/sdk-metrics` 3.1.1 contains no exemplar code.
- `SimpleSpanProcessor`/`BatchLogRecordProcessor` in the 3.x SDK take an options object (`{ exporter }`), not the exporter itself.
- `NodeSDK({ spanProcessors: [] })` installs no tracer provider (every span is non-recording); pass at least one processor.
- `parentbased_traceidratio` with ratio 0 still records a span whose incoming `traceparent` ends in `-01`; plain `traceidratio` with ratio 0 drops it.
- Seconds-valued histograms with default buckets: 0.08/0.12/0.31 s all land in bucket #1 `(0, 5]`.
- Collector debug exporter: log records print `Trace ID:` and `Span ID:` lines; the Prometheus exporter turns `checkout.requests` into `checkout_requests_total` with `job`, `instance` and `otel_scope_*` labels.
- A Collector still shutting down holds port 8888 (its own metrics); wait for the pid to exit before starting the next one, or set `service.telemetry.metrics.level: none`.
