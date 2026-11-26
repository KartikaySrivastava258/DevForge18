---
id: otel-context-propagation
title: Propagating context across services and queues
track: opentelemetry
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [otel-collector-and-jaeger]
learning_objectives:
  - Explain how the W3C traceparent header carries a trace from one service to the next, and what each of its fields means.
  - Carry trace context through a message queue by injecting it into message headers and extracting it in the consumer.
  - Pass a small key-value value along the whole request with baggage — and know what must never go in it.
  - Recognise a broken trace (a consumer starting a new trace) and its cause.
resources:
  - title: W3C Trace Context
    url: https://www.w3.org/TR/trace-context/
    publisher: W3C
    type: reference
    level: intermediate
    official: true
    why: The traceparent header — version, trace-id, parent-id and trace-flags — and the tracestate header.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Context propagation (OpenTelemetry concepts)
    url: https://opentelemetry.io/docs/concepts/context-propagation/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Propagators inject context into carriers (headers, message metadata) and extract it on the other side.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Baggage (OpenTelemetry concepts)
    url: https://opentelemetry.io/docs/concepts/signals/baggage/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Baggage carries key-value pairs alongside context to every downstream service — so it must not contain sensitive data.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Semantic conventions for messaging spans
    url: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: PRODUCER and CONSUMER span kinds and how messaging spans relate across a queue.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: traceparent
    prompt: In traceparent 00-4bf9…4736-00f0…02b7-01, what does the third field tell the receiver?
    options:
      - { id: a, text: "The service name" }
      - { id: b, text: "The ID of the caller's span — the receiver's span becomes its child; the second field is the trace ID shared by every span in the request, and 01 means sampled" }
      - { id: c, text: "The time of the request" }
    answer: b
    explanation: The lab shows the consumer's Parent ID equal to the producer's span ID.
  - id: queue
    prompt: HTTP instrumentation propagates context automatically. Why did the queue need code?
    options:
      - { id: a, text: "Queues cannot carry headers" }
      - { id: b, text: "The instrumentation only knows the protocols it instruments; for a custom queue the producer must inject context into the message and the consumer must extract it — otherwise the consumer starts a new trace" }
      - { id: c, text: "Queues are always slower" }
    answer: b
    explanation: Instrumentation libraries exist for Kafka, RabbitMQ and others; for anything else, inject and extract yourself.
  - id: baggage
    prompt: Is a user's email address a good baggage entry?
    options:
      - { id: a, text: "Yes, it is convenient" }
      - { id: b, text: "No — baggage is sent in headers to every downstream service, including third parties, and is easily logged; use non-sensitive values such as a region or a feature flag" }
      - { id: c, text: "Only if it is short" }
    answer: b
    explanation: The OpenTelemetry documentation warns that baggage is not secured and travels with requests.
verification:
  method: executed
  details: Every command is run by the test suite with the OpenTelemetry JavaScript SDK (api 1.10.0, sdk-node 0.301.2) and Collector 0.166.0 from the earlier lessons, after those lessons, and its output is compared with this lesson. Trace and span IDs are random, so the lab compares them instead of printing them. Checked against the W3C Trace Context specification and the OpenTelemetry documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A trace survives a hop between services only if the caller **injects** its context (trace ID and span ID) into what it sends — HTTP headers or message metadata — and the receiver **extracts** it and continues the same trace; HTTP instrumentation does this for you, queues often need you to do it.

## Explain it like I'm twelve

A parcel travels through several sorting offices. Each one stamps the same tracking number on its record and notes which office sent the parcel. If one office throws away the label, the next one starts a brand-new tracking number — and the parcel's journey breaks into two unrelated stories.

The tracking number is the **trace ID**, the "sent by" note is the **parent span ID**, the label is the **traceparent header**, and a sticker such as "fragile" that every office can read is **baggage**.

Where the analogy breaks: the "label" must be copied by software at every hop, including when the parcel waits in a queue.

## What problem it solves

A single user request often crosses several services and queues. Without propagation, each part produces its own unrelated trace, and nobody can follow the request end to end — the main reason for tracing in the first place. Most "my traces are broken" problems are a hop where context was not passed on.

## How it works

![](media:opentelemetry/queue-propagation.svg)

- **traceparent** (W3C Trace Context): `00-<32-hex trace-id>-<16-hex parent span-id>-<flags>`; flag `01` means sampled.
- A **propagator** writes context into a carrier (`propagation.inject`) and reads it back (`propagation.extract`). OpenTelemetry's default propagators handle Trace Context and **Baggage**.
- HTTP instrumentation injects and extracts automatically (lesson 2). For a queue, the producer injects into the message's headers and the consumer extracts them before starting its span.
- Messaging spans use kinds **PRODUCER** and **CONSUMER**.

## Try it yourself

> **Local lab** — continues in `otel-node-lab` from *Instrumenting a Node.js service*, with the Collector configuration from *Traces, spans and context* (the debug exporter prints spans in its log). The queue is a file, standing in for Kafka or RabbitMQ. Every command is run automatically in DevForge's tests.

### 1. A producer and a consumer

```bash run
cat > tracing.mjs <<'EOF'
// Sets up the SDK (default propagators: W3C Trace Context and Baggage) and exports spans to the Collector.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
export const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" }) });
sdk.start();
EOF
cat > producer.mjs <<'EOF'
// Publishes order 42 to the queue (a file), with the trace context and baggage in the message headers.
import { appendFileSync } from "node:fs";
import { context, propagation, trace, SpanKind } from "@opentelemetry/api";
import { sdk } from "./tracing.mjs";
const tracer = trace.getTracer("orders");
const withCampus = propagation.setBaggage(context.active(), propagation.createBaggage({ campus: { value: "north" } }));
await context.with(withCampus, () =>
  tracer.startActiveSpan("orders publish", { kind: SpanKind.PRODUCER }, (span) => {
    const headers = {};
    if (process.env.PROPAGATE !== "no") propagation.inject(context.active(), headers);   // traceparent + baggage
    appendFileSync("queue.jsonl", JSON.stringify({ headers, body: { order: 42 } }) + "\n");
    console.log(`producer: trace ${span.spanContext().traceId}, span ${span.spanContext().spanId}`);
    span.end();
  }));
await sdk.shutdown();
EOF
cat > consumer.mjs <<'EOF'
// Takes the message off the queue and continues the producer's trace from its headers.
import { readFileSync, writeFileSync } from "node:fs";
import { ROOT_CONTEXT, propagation, trace, SpanKind } from "@opentelemetry/api";
import { sdk } from "./tracing.mjs";
const tracer = trace.getTracer("orders");
for (const line of readFileSync("queue.jsonl", "utf8").trim().split("\n")) {
  const message = JSON.parse(line);
  const parent = propagation.extract(ROOT_CONTEXT, message.headers);
  const span = tracer.startSpan("orders process", { kind: SpanKind.CONSUMER }, parent);
  const campus = propagation.getBaggage(parent)?.getEntry("campus")?.value ?? "(none)";
  console.log(`consumer: trace ${span.spanContext().traceId}, campus ${campus}`);
  span.end();
}
writeFileSync("queue.jsonl", "");   // the queue is now empty
await sdk.shutdown();
EOF
otelcol --config=../otel-lab/otelcol.yaml > queue-otelcol.log 2>&1 &   # a fresh log: otelcol.log here belongs to lesson 2
echo $! > queue-otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' queue-otelcol.log && break; sleep 1; done
grep -q 'Everything is ready' queue-otelcol.log && echo "Collector ready" || { echo "the Collector did not start:"; tail -n 5 queue-otelcol.log; exit 1; }
```

```text output
Collector ready
```

### 2. Publish, look at the message, consume

```bash run
: > queue.jsonl
producer=$(OTEL_SERVICE_NAME=shop node producer.mjs)
node -e 'const m = JSON.parse(require("fs").readFileSync("queue.jsonl", "utf8")); console.log("message headers:", Object.keys(m.headers).join(", ")); console.log("baggage:", m.headers.baggage);'
traceparent=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("queue.jsonl", "utf8")).headers.traceparent)')
echo "traceparent fields: $(echo "$traceparent" | awk -F- '{ printf "version %s, trace-id %d hex digits, parent-id %d hex digits, flags %s", $1, length($2), length($3), $4 }')"
consumer=$(OTEL_SERVICE_NAME=fulfilment node consumer.mjs)
echo "$consumer" | sed -E 's/trace [0-9a-f]{32}/trace …/'
p_trace=$(echo "$producer" | sed -E 's/.*trace ([0-9a-f]+).*/\1/'); c_trace=$(echo "$consumer" | sed -E 's/.*trace ([0-9a-f]+).*/\1/')
[ "$p_trace" = "$c_trace" ] && echo "same trace in both services: yes" || echo "same trace in both services: no"
```

```text output
message headers: traceparent, baggage
baggage: campus=north
traceparent fields: version 00, trace-id 32 hex digits, parent-id 16 hex digits, flags 01
consumer: trace …, campus north
same trace in both services: yes
```

The producer injected two headers into the message; the consumer extracted them, so its span joined the producer's trace and could read the baggage.

### 3. Who is whose parent

```bash run
for i in $(seq 1 30); do [ "$(grep -c '^Span #' queue-otelcol.log)" -ge 2 ] && break; sleep 1; done
p_span=$(echo "$producer" | sed -E 's/.*span ([0-9a-f]+).*/\1/')
echo "consumer span's parent is the producer's span: $(grep -B2 'Name           : orders process' queue-otelcol.log | grep -c "Parent ID      : $p_span")"
grep -E '^    (Name|Kind) ' queue-otelcol.log | paste -d ' ' - - | sed -E 's/ +/ /g'
grep -- '-> service.name' queue-otelcol.log | sed 's/^ *//'
```

```text output
consumer span's parent is the producer's span: 1
 Name : orders publish Kind : Producer
 Name : orders process Kind : Consumer
-> service.name: Str(shop)
-> service.name: Str(fulfilment)
```

Two services, one trace: the `fulfilment` service's CONSUMER span is a child of the `shop` service's PRODUCER span, exactly as if they had talked over HTTP.

### 4. Forget to inject, and the trace breaks

```bash run
producer=$(PROPAGATE=no OTEL_SERVICE_NAME=shop node producer.mjs)
consumer=$(OTEL_SERVICE_NAME=fulfilment node consumer.mjs)
echo "$consumer" | sed -E 's/trace [0-9a-f]{32}/trace …/'
p_trace=$(echo "$producer" | sed -E 's/.*trace ([0-9a-f]+).*/\1/'); c_trace=$(echo "$consumer" | sed -E 's/.*trace ([0-9a-f]+).*/\1/')
[ "$p_trace" = "$c_trace" ] && echo "same trace in both services: yes" || echo "same trace in both services: no"
```

```text output
consumer: trace …, campus (none)
same trace in both services: no
```

Without the headers, the consumer started a brand-new trace and lost the baggage. In Jaeger this looks like two unrelated requests — the classic sign of a hop that does not propagate context.

### 5. Stop the Collector

```bash run
kill "$(cat queue-otelcol.pid)"
```

## Common mistakes

- **Starting a span in the consumer without extracting.** It becomes a new root; always `extract`, then start the span with that context.
- **Losing context in async code.** Use `startActiveSpan` or `context.with` so callbacks and promises run in the right context.
- **Sensitive data in baggage.** It travels in headers to every downstream service; keep it to non-sensitive values.
- **Mixed propagation formats.** If one service speaks only B3 and another only W3C, configure both propagators on the edge services.
- **Long batches with one parent.** When a consumer processes many messages at once, use span links to each producer instead of a single parent.

## Where this fits in a real system

**Kafka** instrumentation stores traceparent in record headers exactly like this queue; **Nginx** and ingress gateways (Kubernetes lessons) should pass `traceparent` through; and **Airflow** or **n8n** workflows that call services can join the same trace. With context flowing, **Jaeger** shows one request across every hop.
