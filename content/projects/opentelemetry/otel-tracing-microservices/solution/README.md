# Tracing the canteen demo

Two small Node.js services: `frontend` (port 8080, `GET /products`) calls `catalogue` (port 8081,
`GET /items`). When `/products` is slow, nobody can tell which service is to blame. Add distributed tracing:

1. `tracing.js` — start the OpenTelemetry Node SDK before the service code (`node --require ./tracing.js …`),
   with the HTTP instrumentation and the OTLP/HTTP (protobuf) trace exporter. The exporter's address comes from
   the standard `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable (for example `http://collector:4318`).
   Name the services `frontend` and `catalogue`.
2. In `catalogue.js`, wrap `loadProducts()` in a span named `load products` with the attribute
   `products.count` (the number of products returned).
3. `package.json` — add the OpenTelemetry packages (exact versions: `@opentelemetry/api@1.10.0`,
   `@opentelemetry/sdk-node@0.301.2`, `@opentelemetry/instrumentation-http@0.301.2`,
   `@opentelemetry/exporter-trace-otlp-proto@0.301.2`) and start both services with tracing.
4. `otel-collector.yaml` — receive OTLP over HTTP on port 4318 and send traces to Jaeger over OTLP/gRPC at
   `jaeger:4317` (no TLS inside this lab network), with the `batch` processor.

A request to `/products` must then appear in Jaeger as **one trace** spanning both services.
