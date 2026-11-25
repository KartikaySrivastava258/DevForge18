---
id: otel-traces-spans-and-context
title: Traces, spans and context
track: opentelemetry
order: 1
level: beginner
estimated_minutes: 35
prerequisites: []
learning_objectives:
  - Explain what a trace and a span are, and how parent IDs turn spans into a tree.
  - Read the traceparent header that carries a trace from one service to the next.
  - Run an OpenTelemetry Collector and send it a trace in the OTLP format.
resources:
  - title: OpenTelemetry documentation
    url: https://opentelemetry.io/docs/
    publisher: OpenTelemetry Authors
    type: documentation
    level: all
    official: true
    why: Concepts (signals, context propagation) and per-language guides.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Trace Context (W3C Recommendation)
    url: https://www.w3.org/TR/trace-context/
    publisher: W3C
    type: reference
    level: intermediate
    official: true
    why: The standard traceparent header — its four fields and their exact format. The IDs in this lesson are the specification's own example.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Collector configuration
    url: https://opentelemetry.io/docs/collector/configuration/
    publisher: OpenTelemetry Authors
    type: documentation
    level: beginner
    official: true
    why: Receivers, processors, exporters and pipelines, and why configuring a component does not yet enable it.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: OpenTelemetry Collector releases
    url: https://github.com/open-telemetry/opentelemetry-collector-releases/releases
    publisher: OpenTelemetry Authors
    type: reference
    level: intermediate
    official: true
    why: Official Collector binaries for every system, with checksums.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: span-vs-trace
    prompt: A request to /checkout made the API call a database and a payment service. How many traces and spans does that produce, at least?
    options:
      - { id: a, text: "Three traces, one per service" }
      - { id: b, text: "One trace containing several spans: one for the API's handling of the request, and one each for the database and payment calls" }
      - { id: c, text: "One span containing three traces" }
    answer: b
    explanation: A trace is the whole journey of one request; each span is one piece of work within it. All the spans share the trace ID, and each child points to its parent with a parent ID.
  - id: root-span
    prompt: In the Collector's output, one span has an empty Parent ID. What does that mean?
    options:
      - { id: a, text: "The span was lost" }
      - { id: b, text: "It is the root span: the first piece of work in the trace, which every other span descends from" }
      - { id: c, text: "It belongs to a different trace" }
    answer: b
    explanation: Only the root span has no parent. Every other span in the trace has a parent ID that matches another span's ID, which is how tools draw the tree or waterfall.
  - id: traceparent-fields
    prompt: A service receives traceparent 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01. Which value becomes the parent ID of the span it creates?
    options:
      - { id: a, text: "4bf92f3577b34da6a3ce929d0e0e4736" }
      - { id: b, text: "00f067aa0ba902b7" }
      - { id: c, text: "01" }
    answer: b
    explanation: The fields are version, trace ID (32 hex characters), parent ID (16 hex characters, the caller's span) and flags. The new span keeps the trace ID and records the caller's span as its parent. 01 is the flag saying the caller sampled (recorded) the trace.
  - id: not-enabled
    prompt: You add a processor under processors in the Collector's configuration, but nothing changes. What is the likely mistake?
    options:
      - { id: a, text: "Processors only work with the debug exporter" }
      - { id: b, text: "It is configured but not listed in a pipeline under service, so it is not enabled" }
      - { id: c, text: "The Collector must be reinstalled after adding a processor" }
    answer: b
    explanation: The Collector documentation says that configuring a component does not enable it; it must also be added to a pipeline in the service section.
verification:
  method: executed
  details: Every command is run by the test suite with the OpenTelemetry Collector 0.166.0 (the official otelcol distribution, checksum-verified); the output shown was recorded from that run. Facts about traceparent, span kinds and Collector configuration were checked against the W3C specification, the OpenTelemetry protocol definitions and the Collector documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **trace** follows one request through every service it touches; it is made of **spans** — one per piece of work, each with a start, an end and a pointer to the span that caused it — and **context** is the small piece of information (trace ID and parent span ID) passed along so that every service adds its spans to the same trace.

## Explain it like I'm twelve

Think of a parcel going through the post. At every depot, someone scans the label and notes when it arrived and when it left. The tracking number is the same at every depot, so later you can see the whole journey — and spot the depot where it sat for three days.

The tracking number is the **trace ID**; each depot's record is a **span**; and the label stuck on the parcel, so the next depot knows which journey this is, is the **context**.

Where the analogy breaks: a span also records which earlier step caused it (its parent), so a trace is a tree, not just a line — one request can fan out to several services at once.

## What problem it solves

In a system of many services, a slow or failing request is hard to explain. Metrics say *that* checkout is slow; logs from ten services do not say which lines belong to the same request. A trace stitches the work for one request together, so you can see that 180 of the 250 milliseconds were spent in one database query.

**OpenTelemetry** is a vendor-neutral standard and set of tools for producing this telemetry (traces, metrics and logs) and sending it, in its own protocol **OTLP**, to any back end. The **Collector** is a program that receives telemetry, can process it, and forwards it.

## How it works

![](media:opentelemetry/trace-tree.svg)

Each span has:

- a **trace ID** (32 hexadecimal characters), shared by every span of the request;
- its own **span ID** (16 hexadecimal characters);
- a **parent ID** — the span ID of the span that caused it, empty for the first (*root*) span;
- a **name**, a **kind** (for example *Server*: handling an incoming request; *Client*: a request to another service), start and end times, and **attributes** such as the HTTP method.

When a service calls another, it sends the context in the standard `traceparent` HTTP header, defined by the W3C:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                └ flags: 01 = sampled (recorded)
             │  │                                └ parent ID: the caller's span
             │  └ trace ID
             └ version
```

## Try it yourself

> **Local lab** — you send a trace by hand to an OpenTelemetry Collector running on your computer. Every command is run automatically in DevForge's tests with Collector 0.166.0.

### 0. Install the Collector

Download the `otelcol` archive for your system from the [Collector releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) (version 0.166.0 here) and unpack it. On Linux, for example:

```bash
curl -fsSLO https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.166.0/otelcol_0.166.0_linux_amd64.tar.gz
mkdir -p otelcol && tar -xzf otelcol_0.166.0_linux_amd64.tar.gz -C otelcol
export PATH="$PWD/otelcol:$PATH"
```

```bash run
otelcol --version
```

```text output
otelcol version 0.166.0
```

### 1. Configure a pipeline

```bash run
mkdir -p otel-lab && cd otel-lab
cat > otelcol.yaml <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
EOF
otelcol validate --config=otelcol.yaml && echo "configuration is valid"
```

```text output
configuration is valid
```

- A **receiver** accepts telemetry: here OTLP over HTTP on port 4318, OTLP's usual HTTP port.
- An **exporter** sends it somewhere: `debug` prints every span to the Collector's log, ideal for learning.
- A **pipeline** under `service` connects them. A component that is configured but not in a pipeline does nothing.

### 2. Start the Collector

```bash run
otelcol --config=otelcol.yaml > otelcol.log 2>&1 &
echo $! > otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' otelcol.log && break; sleep 1; done
grep -o 'Everything is ready.*data\.' otelcol.log
```

```text output
Everything is ready. Begin running and processing data.
```

The Collector runs in the background and writes its log to `otelcol.log`; the loop waits until it reports that it is ready.

### 3. Send a trace by hand

Applications normally produce spans with an OpenTelemetry SDK (next lesson). Writing two spans by hand shows exactly what one contains. This is OTLP in JSON: a `checkout` service handled `GET /checkout` and, inside it, ran a database query.

```bash run
cat > trace.json <<'EOF'
{"resourceSpans": [{
  "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "checkout"}}]},
  "scopeSpans": [{"scope": {"name": "by-hand"}, "spans": [
    {"traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "00f067aa0ba902b7",
     "name": "GET /checkout", "kind": 2,
     "startTimeUnixNano": "1767225600000000000", "endTimeUnixNano": "1767225600250000000",
     "attributes": [{"key": "http.request.method", "value": {"stringValue": "GET"}},
                    {"key": "http.response.status_code", "value": {"intValue": "200"}}]},
    {"traceId": "4bf92f3577b34da6a3ce929d0e0e4736", "spanId": "b7ad6b7169203331",
     "parentSpanId": "00f067aa0ba902b7", "name": "SELECT orders", "kind": 3,
     "startTimeUnixNano": "1767225600020000000", "endTimeUnixNano": "1767225600200000000"}
  ]}]
}]}
EOF
curl -s -X POST -H 'Content-Type: application/json' --data @trace.json http://127.0.0.1:4318/v1/traces
```

```text output
{"partialSuccess":{}}
```

- `resource` describes *who* produced the spans; `service.name` is the most important attribute.
- `kind` is a number in OTLP: 2 is *Server* (handling an incoming request), 3 is *Client* (a call to another service or database).
- Times are nanoseconds since 1970: the request took 250 ms (0.25 s), the query 180 ms of it.
- `{"partialSuccess":{}}` with nothing inside means everything was accepted.

### 4. Read the spans

```bash run
for i in $(seq 1 30); do grep -q '^Span #1' otelcol.log && break; sleep 1; done
grep -E '^(     -> service.name|Span #|    (Trace ID|Parent ID|ID|Name|Kind|Start time|End time) )' otelcol.log
```

```text output
     -> service.name: Str(checkout)
Span #0
    Trace ID       : 4bf92f3577b34da6a3ce929d0e0e4736
    Parent ID      :
    ID             : 00f067aa0ba902b7
    Name           : GET /checkout
    Kind           : Server
    Start time     : 2026-01-01 00:00:00 +0000 UTC
    End time       : 2026-01-01 00:00:00.25 +0000 UTC
Span #1
    Trace ID       : 4bf92f3577b34da6a3ce929d0e0e4736
    Parent ID      : 00f067aa0ba902b7
    ID             : b7ad6b7169203331
    Name           : SELECT orders
    Kind           : Client
    Start time     : 2026-01-01 00:00:00.02 +0000 UTC
    End time       : 2026-01-01 00:00:00.2 +0000 UTC
```

Both spans share the trace ID. `GET /checkout` has no parent: it is the root. `SELECT orders` names it as its parent and starts 20 ms after it, so a tracing tool draws it indented underneath, inside the request's time.

### 5. A malformed trace ID

```bash run fails
curl -s -f -X POST -H 'Content-Type: application/json' -o /dev/null -w 'HTTP %{http_code}\n' \
  -d '{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"abc","spanId":"1","name":"x"}]}]}]}' \
  http://127.0.0.1:4318/v1/traces
```

```text output
HTTP 400
```

A trace ID must be exactly 32 hexadecimal characters and a span ID 16. The Collector rejects the request with `400 Bad Request` instead of storing broken data. (`-f` makes curl fail on an error status, which is why this command is marked as expected to fail.)

### 6. Stop the Collector

```bash run
kill "$(cat otelcol.pid)"
```

## Try it in the simulation

Read a waterfall like the one Jaeger draws: find the slow span, then change the design and see which spans decide the total. It is a labelled teaching model with fixed timings, not a real system.

```simulation opentelemetry-trace-waterfall scenario=slow-payment
```

## Common mistakes

- **Configuring a component but not adding it to a pipeline.** It is silently unused.
- **Expecting the Collector to store traces.** It receives, processes and forwards; storage and search are a back end's job (lesson 3 uses Jaeger).
- **Wrong port or path.** OTLP over HTTP uses `/v1/traces` on port 4318; OTLP over gRPC usually uses port 4317. An SDK set up for one cannot talk to a receiver expecting the other.
- **Breaking the context.** If a service does not pass `traceparent` on when it calls another, the next service starts a new trace and the request falls apart into unrelated pieces.
- **Putting secrets or personal data in span attributes.** Traces are often kept for days and seen by many engineers.

## Where this fits in a real system

Every service in a system sends spans — and often metrics and logs — over OTLP to a Collector, which forwards them to a tracing back end such as Jaeger, and metrics to **Prometheus**. Traces answer *where* a request spent its time; **Prometheus** metrics answer *how often* and *how slow overall*. Messages sent through a queue such as **Kafka** can carry the same context in their headers, so one trace can follow work across asynchronous steps too.
