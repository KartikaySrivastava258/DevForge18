// Loaded before the service code with `node --require ./tracing.js`, so the HTTP module is instrumented
// before anything uses it. Configuration comes from standard environment variables:
//   OTEL_SERVICE_NAME            the service name in every span (set in package.json's scripts)
//   OTEL_EXPORTER_OTLP_ENDPOINT  where the Collector listens, e.g. http://collector:4318 (/v1/traces is added)
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { HttpInstrumentation } = require("@opentelemetry/instrumentation-http");

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new HttpInstrumentation()],
});
sdk.start();

// Send the spans still buffered in memory before the process stops.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => sdk.shutdown().finally(() => process.exit(0)));
}
