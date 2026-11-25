---
id: otel-instrumenting-nodejs
title: Instrumenting a Node.js service
track: opentelemetry
order: 2
level: beginner
estimated_minutes: 40
prerequisites: [otel-traces-spans-and-context]
learning_objectives:
  - Add the OpenTelemetry SDK to a Node.js service without changing its code.
  - Watch context propagation turn calls between two services into one trace.
  - Follow a traceparent header to the exact spans it connects.
resources:
  - title: Getting started with OpenTelemetry for Node.js
    url: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
    publisher: OpenTelemetry Authors
    type: tutorial
    level: beginner
    official: true
    why: The official guide to the Node.js SDK, the instrumentation file and the --import flag used here.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: OpenTelemetry JavaScript (source and release notes)
    url: https://github.com/open-telemetry/opentelemetry-js
    publisher: OpenTelemetry Authors
    type: source-code
    level: intermediate
    official: true
    why: Supported Node.js versions and the release notes for each SDK version, including the 3.x changes.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: no-code-change
    prompt: backend.cjs and frontend.cjs contain no OpenTelemetry code, yet they produce spans. How?
    options:
      - { id: a, text: "Node.js creates spans for every program automatically" }
      - { id: b, text: "node --import ./instrumentation.mjs starts the SDK before the service, and the HTTP instrumentation wraps Node's http module so every request in or out becomes a span" }
      - { id: c, text: "The Collector adds the spans by watching network traffic" }
    answer: b
    explanation: Instrumentation libraries patch common modules (here http) when they are loaded. That is why the SDK must start before the application code — the purpose of --import.
  - id: broken-propagation
    prompt: The backend shows up as a separate trace with no parent, even though the frontend called it. What is the most likely cause?
    options:
      - { id: a, text: "The backend's service.name is wrong" }
      - { id: b, text: "The traceparent header did not reach the backend — for example, the frontend was not instrumented, or something in between dropped the header" }
      - { id: c, text: "The Collector was restarted" }
    answer: b
    explanation: The backend can only join the trace if it receives the context. Without traceparent it has nothing to continue, so its server span becomes the root of a new trace.
  - id: service-name
    prompt: Why set OTEL_SERVICE_NAME differently for the two programs?
    options:
      - { id: a, text: "So that each span says which service produced it; otherwise both would appear under the same default name" }
      - { id: b, text: "The SDK refuses to start without it" }
      - { id: c, text: "It changes the trace ID" }
    answer: a
    explanation: service.name is a resource attribute attached to every span a process produces. Tracing tools group and filter by it, so each service needs its own.
verification:
  method: executed
  details: Every command is run by the test suite with Node.js 22, OpenTelemetry JavaScript SDK 3.1.1 (@opentelemetry/sdk-node 0.301.2) installed from npm, and Collector 0.166.0; the output shown was recorded from that run. IDs that are random on every run are shown as …. SDK setup and Node.js requirements were checked against the OpenTelemetry documentation and release notes on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

An OpenTelemetry **SDK** loaded into a service turns its work into spans automatically, and passes the trace context on in every outgoing request, so a call that crosses two services ends up as one connected trace.

## Explain it like I'm twelve

Imagine two shops in a relay: a customer asks the front shop for an item, and the front shop phones the warehouse. If the front shop reads out the customer's order number on the phone, the warehouse can file its notes under the same number, and later you can see the whole order in one folder.

The SDK is the assistant who writes the notes (spans) in each shop and always remembers to read out the order number (the `traceparent` header) on the phone.

Where the analogy breaks: nobody has to remember anything — the instrumentation adds the header to every outgoing request by itself.

## What problem it solves

Adding tracing code by hand to every request handler and every HTTP call is slow and easy to get wrong. OpenTelemetry's instrumentation libraries do it for common frameworks and modules, so you get useful traces from an existing service by starting it differently, not by rewriting it. Because the context travels in a standard header, services written in different languages join the same trace.

## How it works

```diagram steps=opentelemetry/propagation
```

The SDK is started *before* the service's own code with Node.js's `--import` flag, so the HTTP instrumentation can wrap the `http` module before the service uses it. Spans are collected in memory and sent to the Collector in batches.

## Try it yourself

> **Local lab** — you need Node.js 22.15 or newer (OpenTelemetry's JavaScript SDK 3.x requires it; DevForge itself needs 22.18), internet access for `npm install`, and the `otelcol` Collector from the previous lesson. Every command is run automatically in DevForge's tests. Trace and span IDs are random, so they are shown as `…`.

### 1. Install the SDK

Start in the folder that contains `otel-lab`. The previous lesson left you inside `otel-lab`, so go up one level first:

```bash run
cd .. && mkdir -p otel-node-lab && cd otel-node-lab
npm init -y > /dev/null
npm install --silent --no-audit --no-fund --save-exact \
  @opentelemetry/api@1.10.0 @opentelemetry/sdk-node@0.301.2 \
  @opentelemetry/instrumentation-http@0.301.2 @opentelemetry/exporter-trace-otlp-proto@0.301.2
npm ls --depth=0
```

```text output
otel-node-lab@1.0.0 …
├── @opentelemetry/api@1.10.0
├── @opentelemetry/exporter-trace-otlp-proto@0.301.2
├── @opentelemetry/instrumentation-http@0.301.2
└── @opentelemetry/sdk-node@0.301.2
```

- `@opentelemetry/api` — the interfaces your code (and libraries) talk to.
- `@opentelemetry/sdk-node` — the SDK that creates, batches and exports spans. Its version line (0.301.x) belongs with the 3.1.x stable packages.
- `@opentelemetry/instrumentation-http` — turns requests handled and made with Node's `http` module into spans.
- `@opentelemetry/exporter-trace-otlp-proto` — sends spans over OTLP/HTTP.
- `--save-exact` pins exact versions, so the lab behaves the same next month.

### 2. Write the instrumentation file and two services

```bash run
cat > instrumentation.mjs <<'EOF'
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" }),
  instrumentations: [new HttpInstrumentation()],
});
sdk.start();
// Send any spans still waiting in memory before the process exits.
process.on("SIGTERM", () => sdk.shutdown().finally(() => process.exit(0)));
EOF
cat > backend.cjs <<'EOF'
const http = require("node:http");

http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ stock: 3, traceparent: req.headers.traceparent ?? null }));
}).listen(7002, "127.0.0.1", () => console.log("backend on http://127.0.0.1:7002"));
EOF
cat > frontend.cjs <<'EOF'
const http = require("node:http");

http.createServer((req, res) => {
  http.get("http://127.0.0.1:7002/stock", (answer) => {
    let body = "";
    answer.on("data", (chunk) => (body += chunk));
    answer.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ page: "checkout", backend: JSON.parse(body) }));
    });
  });
}).listen(7001, "127.0.0.1", () => console.log("frontend on http://127.0.0.1:7001"));
EOF
```

- `instrumentation.mjs` is the only file that knows about OpenTelemetry. It sends spans to the Collector's OTLP/HTTP receiver.
- `backend.cjs` answers with stock information — and, so you can see it, the `traceparent` header it received.
- `frontend.cjs` handles `/checkout` by calling the backend.
- The services are CommonJS files (`.cjs`, using `require`), like the official getting-started example, so `--import` can instrument them without extra loader settings.

### 3. Start a Collector and the two services

The same Collector configuration as the previous lesson: OTLP in, `debug` out.

```bash run
cp ../otel-lab/otelcol.yaml .
otelcol --config=otelcol.yaml > otelcol.log 2>&1 &
echo $! > otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' otelcol.log && break; sleep 1; done
OTEL_SERVICE_NAME=backend node --import ./instrumentation.mjs backend.cjs > backend.log 2>&1 &
echo $! > backend.pid
OTEL_SERVICE_NAME=frontend node --import ./instrumentation.mjs frontend.cjs > frontend.log 2>&1 &
echo $! > frontend.pid
for i in $(seq 1 30); do grep -q 'on http' backend.log && grep -q 'on http' frontend.log && break; sleep 1; done
cat backend.log frontend.log
```

```text output
backend on http://127.0.0.1:7002
frontend on http://127.0.0.1:7001
```

`OTEL_SERVICE_NAME` is the standard environment variable for the `service.name` resource attribute, so each process labels its spans with its own name.

### 4. Make one request

```bash run
answer=$(curl -s http://127.0.0.1:7001/checkout)
echo "$answer"
```

```text output
{"page":"checkout","backend":{"stock":3,"traceparent":"00-…-…-01"}}
```

The backend received a `traceparent` header that nobody wrote: the frontend's HTTP instrumentation added it to the outgoing call. Its second field is the trace ID; its third is the ID of the frontend's span for that call.

### 5. Follow the header to the spans

The SDK sends spans in batches, so wait until all three have reached the Collector, then take the header apart:

```bash run
for i in $(seq 1 30); do [ "$(grep -c '^Span #' otelcol.log)" -ge 3 ] && break; sleep 1; done
traceparent=$(echo "$answer" | grep -o '00-[0-9a-f]*-[0-9a-f]*-01')
trace_id=$(echo "$traceparent" | cut -d- -f2)
caller_span=$(echo "$traceparent" | cut -d- -f3)
echo "spans received: $(grep -c '^Span #' otelcol.log)"
grep -- '-> service.name' otelcol.log | sort
echo "spans in trace $trace_id: $(grep -c "Trace ID       : $trace_id" otelcol.log)"
grep -A3 "^    ID             : $caller_span" otelcol.log
echo "spans whose parent is $caller_span: $(grep -c "Parent ID      : $caller_span" otelcol.log)"
```

```text output
spans received: 3
     -> service.name: Str(backend)
     -> service.name: Str(frontend)
spans in trace …: 3
    ID             : …
    Name           : GET
    Kind           : Client
    Start time     : …
spans whose parent is …: 1
```

`cut -d- -f2` splits the header at each `-` and keeps the second field. What the output shows:

- **Three spans from two services**, all with the trace ID from the header: one trace.
- The span named in the header is the frontend's **Client** span — its call to the backend.
- Exactly **one** span has that as its parent: the backend's **Server** span. That link is how a tracing tool knows to draw the backend's work *inside* the frontend's call.
- The third span is the frontend's own **Server** span for `/checkout`, the root. Span names are just `GET`, the HTTP method; frameworks with routes give more specific names.

### 6. Stop everything

Stop the services first and wait until they have exited: on `SIGTERM` the SDK sends any spans still waiting, and the Collector must still be running to receive them. Then stop the Collector.

```bash run
kill "$(cat frontend.pid)" "$(cat backend.pid)"
for pid in $(cat frontend.pid backend.pid); do while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done; done
kill "$(cat otelcol.pid)"
```

`kill -0` sends no signal; it only checks whether the process still exists.

## Common mistakes

- **Loading the SDK after the application.** Instrumentation must patch modules before they are used: start Node with `--import ./instrumentation.mjs`.
- **ES modules without the extra loader.** Services written as ES modules (`import http from "node:http"`) need an additional loader hook for instrumentation; this lesson's CommonJS files avoid that.
- **Forgetting `OTEL_SERVICE_NAME`.** Every service then appears under a default name and traces are hard to read.
- **Node.js older than the SDK supports.** SDK 3.x needs Node.js 22.15 or newer; check `node --version`.
- **Calls through a proxy that drops headers.** If `traceparent` does not arrive, the trace breaks into pieces. Proxies such as Nginx pass request headers on by default unless told otherwise.

## Where this fits in a real system

Each service — Node.js, Java, Python, Go — runs an OpenTelemetry SDK that sends OTLP to a **Collector**, often one on each machine or **Kubernetes** node, forwarding to a central one. The `traceparent` header crosses **Nginx** and other proxies, so traces stay connected end to end. The next lesson stores these traces in Jaeger and searches them; **Grafana** can show the same traces next to **Prometheus** metrics.
