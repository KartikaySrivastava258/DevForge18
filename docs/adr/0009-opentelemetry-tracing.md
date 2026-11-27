# ADR 0009 — OpenTelemetry tracing with a built-in OTLP/HTTP JSON exporter

- **Status:** Accepted (2026-11-27)

## Context

REMAINING_WORK.md §6.4 asks for OpenTelemetry tracing of DevForge itself, which also serves as the OpenTelemetry track's lab (`content/labs/opentelemetry/opentelemetry-trace-devforge.md`). DevForge already writes structured JSON logs and Prometheus metrics without dependencies (`server/src/observability/`). The repository's rule is that no runtime dependency is added without an ADR; ADR 0001 keeps zod as the only one.

What DevForge needs is narrow: one SERVER span per HTTP request (DevForge makes no outgoing HTTP calls, and SQLite runs in-process and synchronously), W3C Trace Context on the way in, export to a Collector or any OTLP backend, and the trace id in the log lines.

## Problem

Use the official OpenTelemetry JavaScript SDK, or write a small exporter for exactly this span?

## Options considered

1. **Official packages**, exact pins published at least 14 days before 2026-11-27 (checked with `npm view <pkg> time --json` on 2026-11-27): `@opentelemetry/api` 1.9.1 (2026-03-25), `@opentelemetry/sdk-trace-node` 2.12.1 (2026-11-09), `@opentelemetry/sdk-trace-base` 2.12.1 (2026-11-09), `@opentelemetry/resources` 2.12.1 (2026-11-09), `@opentelemetry/exporter-trace-otlp-http` 0.223.2 (2026-11-12), `@opentelemetry/semantic-conventions` 1.45.0 (2026-11-06). A dry-run install of that set adds **14 packages** (including `sdk-logs`, `sdk-metrics`, `api-logs` and `otlp-transformer`, pulled in by the exporter); automatic HTTP instrumentation (`@opentelemetry/instrumentation-http` 0.301.2) would add the instrumentation loader and its import hooks on top. The current lines do not fit together: `sdk-trace-node` 2.12.1 declares `peer @opentelemetry/api ">=1.0.0 <1.10.0"` while `exporter-trace-otlp-http` 0.301.2 needs `^1.10.0` (npm reports ERESOLVE), so the exporter must stay on the older 0.223 line. Spans would carry exactly the same data as option 2.
2. **Built-in exporter** (`server/src/observability/tracing.ts`, about 400 lines with comments): a span is created in `app.ts`, which already knows the method, the matched route template and the status; spans are batched and sent as OTLP/HTTP **JSON** to `<endpoint>/v1/traces` with `fetch`. It reads the standard environment variables.
3. **No tracing; correlate logs by request id.** Already possible, but does not show where time goes across services, and gives the OpenTelemetry track nothing real to look at.

## Decision

Option 2, the built-in exporter. It is off by default.

- **Enabling:** `OTEL_EXPORTER_OTLP_ENDPOINT` (base URL; `/v1/traces` is appended) or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (used as is), as in the OTLP exporter specification. Also read: `OTEL_SERVICE_NAME` (default `devforge`), `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_HEADERS` (never logged), `OTEL_EXPORTER_OTLP_TIMEOUT` (10 s), `OTEL_TRACES_SAMPLER` / `_ARG` (default `parentbased_always_on`; `traceidratio` variants supported), `OTEL_BSP_SCHEDULE_DELAY` (5 s), `OTEL_BSP_MAX_QUEUE_SIZE` (2048), `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` (512), `OTEL_SDK_DISABLED`. `OTEL_EXPORTER_OTLP_PROTOCOL` other than `http/json` stops start-up with a clear error instead of silently sending another encoding.
- **Span:** kind SERVER, named `{method} {http.route}` from the router's template (`GET /api/tracks/:slug`), or `{method}` alone when no route matched (static files, 404s) — never the raw path. Unknown methods become `_OTHER` and the name `HTTP`.
- **Attributes** (HTTP semantic conventions, [HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/), semantic conventions 1.45.0, page checked on 2026-11-27): `http.request.method`, `url.path`, `url.scheme`, `http.route`, `http.response.status_code`, `network.protocol.version`, `error.type` (the status code, for 5xx), plus `devforge.request_id` (the `X-Request-Id` the response carries).
- **Status:** Error for 5xx; unset for everything else, including 4xx, as the conventions require for server spans.
- **Trace context:** a valid `traceparent` makes the span a child of the caller's span in the same trace; `tracestate` is kept; an invalid header starts a new trace ([W3C Trace Context](https://www.w3.org/TR/trace-context/)). Unsampled parents are respected (no export).
- **Logs:** the access log line and the "unhandled error" line gain `traceId` and `spanId` when tracing is on.
- **Export:** OTLP/HTTP JSON as in [OTLP 1.11.1](https://opentelemetry.io/docs/specs/otlp/) (hex trace and span ids, integer enums, 64-bit integers as decimal strings, `partialSuccess` counted as dropped). Best effort: a failed export drops its batch, increments `devforge_otel_spans_dropped_total` and `devforge_otel_export_failures_total`, and logs at most one warning a minute. A full queue drops new spans. On SIGTERM the queue is flushed before exit.

### Privacy: what never goes into a span

No request or response bodies, no headers (so no cookies, session tokens or `Authorization`), no query string, no e-mail addresses (path segments containing `@` or `%40` are replaced by `REDACTED`; no route has an e-mail in its path), no exception messages. Two attributes the conventions mark *Recommended* are left out on purpose: `client.address` (a learner's IP address is personal data and the logs do not record it either) and `user_agent.original`. `url.query` (*Conditionally Required*) is left out because search queries are typed by learners. The tests assert all of this against the exported JSON.

## Positive consequences

- No new runtime dependency; the exporter is small enough to read in one sitting and is covered by tests against a fake OTLP receiver and a real OpenTelemetry Collector 0.165.0 container.
- Span names and attributes come from the router, so they are low-cardinality by construction — the same rule as the Prometheus `route` label.
- Any OTLP backend works through a Collector, which can add retries, sampling and protocol conversion.

## Negative consequences

- No automatic instrumentation and no context API: a future outgoing call (an e-mail service, an LLM API) needs its own CLIENT span and `traceparent` header — or this decision revisited.
- Only http/json. Some vendor endpoints accept only protobuf or gRPC; send through a Collector then.
- No retries: an export that fails is dropped (counted). A Collector next to the app is the place for buffering.
- We must follow changes to the semantic conventions ourselves (the HTTP conventions are stable; the status rules are marked Development on the page).

## Revisit when

DevForge starts making outgoing calls or runs work outside the request (queues, scheduled jobs) that should be in the same trace, or needs metrics and logs over OTLP too — then the official SDK (option 1) pays for itself, once its package lines agree on one API version.
