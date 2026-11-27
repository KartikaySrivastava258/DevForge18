---
id: otel-tracing-microservices
track: opentelemetry
title: Distributed tracing for a microservice demo
level: beginner
estimated_hours: 5
prerequisites: [otel-traces-spans-and-context, otel-instrumenting-nodejs, otel-collector-and-jaeger]
related_tracks: [docker]
user_stories:
  - As a developer on call, I want one request to show up as one trace across every service it touched so that I can see which service made it slow.
  - As a service owner, I want my own spans for the important work inside a request so that the trace shows more than "an HTTP call happened".
  - As a platform engineer, I want services to send telemetry to a Collector rather than straight to a backend so that the backend can change without touching every service.
acceptance_criteria:
  - otel-collector.yaml is a valid Collector configuration that receives OTLP over HTTP and exports traces to Jaeger over OTLP/gRPC.
  - Both services start with tracing, and GET /products still returns the catalogue's items.
  - Spans reach Jaeger from services named frontend and catalogue.
  - One request forms one trace across both services, with the catalogue's server span a child of the frontend's client span.
  - The catalogue records a span named "load products", with the attribute products.count, as a child of its request span.
rubric:
  - { criterion: "Instrumentation", excellent: "The SDK starts before any other module, service names come from configuration, buffered spans are flushed on shutdown, and the README shows a screenshot of the trace with both services.", good: "Both services are traced and linked.", needs_work: "Separate traces per service, or tracing that only works on one machine." }
  - { criterion: "Manual spans", excellent: "Spans named for the work (not the function), attributes that help an investigation, errors recorded on the span, and the span always ended (finally).", good: "The required span and attribute are present.", needs_work: "Spans that are never ended, or attributes holding personal data." }
  - { criterion: "Collector configuration", excellent: "Minimal and commented; batch processor; clear about why TLS is off in the lab and on between hosts.", good: "A valid pipeline that delivers traces.", needs_work: "Copied configuration with unused components." }
hints:
  - Start with the Collector and Jaeger, then one service. The lesson "Instrumenting a Node.js service" builds exactly this SDK setup.
  - "--require ./tracing.js must load the SDK before frontend.js loads node:http; otherwise there is nothing to instrument."
  - Without a url, the OTLP exporter reads OTEL_EXPORTER_OTLP_ENDPOINT and adds /v1/traces itself. OTEL_SERVICE_NAME sets the service name.
  - The frontend calls the catalogue with node:http on purpose — the HTTP instrumentation adds the traceparent header to those calls. Global fetch is a different client and needs its own instrumentation.
  - tracer.startActiveSpan("load products", span => { …; span.end(); }) creates a child of whatever span is active — inside a request handler, the server span.
stretch_goals:
  - Add a third service behind the catalogue and see the trace grow.
  - Record an exception on the span when the catalogue fails, and find it in Jaeger.
  - Switch the frontend to fetch and add the matching instrumentation so the trace stays connected.
starter: starter
solution: solution
check_needs: [docker, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A canteen ordering demo has two Node.js services: `frontend` answers `GET /products` by calling `catalogue`.
When the page is slow, each team says its own service is fine — and without tracing nobody can show otherwise.
Add OpenTelemetry tracing to both services so that **one request appears as one trace across both**, send the
spans through an OpenTelemetry Collector, and look at them in Jaeger.

The starter has the two services, a `package.json` without any telemetry and a Collector configuration that
receives data but has nowhere to send it. The README in the starter lists the exact names the check relies on
(service names, the span name and attribute, the package versions).

## Getting started

1. Copy the starter folder and run it without tracing to see it work:

   ```bash
   npm install
   node catalogue.js &  CATALOGUE_URL=http://127.0.0.1:8081 node frontend.js &
   curl -s http://127.0.0.1:8080/products; kill %1 %2
   ```

2. Run Jaeger and the Collector in Docker (one network; Jaeger's interface on http://localhost:16686):

   ```bash
   docker network create otel-lab
   docker run -d --name jaeger --network otel-lab -p 127.0.0.1:16686:16686 jaegertracing/jaeger:2.23.0
   docker run -d --name collector --network otel-lab -p 127.0.0.1:4318:4318 \
     -v "$PWD/otel-collector.yaml:/cfg.yaml:ro" otel/opentelemetry-collector:0.165.0 --config=/cfg.yaml
   ```

3. Write `tracing.js`, add the packages, change the start scripts, and start the services with
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`. Request `/products` and find the trace in Jaeger.
4. Remove the lab containers and run the check:

   ```bash
   docker rm -f jaeger collector && docker network rm otel-lab
   bash check.sh path/to/your/project
   ```

   The check runs everything on its own network and reads the traces back from Jaeger's API.
