---
id: otel-collector-and-jaeger
title: The Collector pipeline and Jaeger
track: opentelemetry
order: 3
level: beginner
estimated_minutes: 40
prerequisites: [otel-instrumenting-nodejs]
learning_objectives:
  - Build a Collector pipeline with a receiver, a processor and an exporter.
  - Store traces in Jaeger and look one up by its trace ID through Jaeger's API.
  - Spot what the SDK adds to every span about the machine and process, and why that matters.
resources:
  - title: Jaeger documentation
    url: https://www.jaegertracing.io/docs/latest/
    publisher: The Jaeger Authors
    type: documentation
    level: beginner
    official: true
    why: Getting started with Jaeger v2, its ports and its APIs, including which are stable.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Jaeger releases
    url: https://github.com/jaegertracing/jaeger/releases
    publisher: The Jaeger Authors
    type: reference
    level: intermediate
    official: true
    why: Official Jaeger binaries for every system, with checksums of the files inside each archive.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Collector configuration
    url: https://opentelemetry.io/docs/collector/configuration/
    publisher: OpenTelemetry Authors
    type: documentation
    level: beginner
    official: true
    why: How receivers, processors and exporters are defined and connected in pipelines.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: why-collector
    prompt: The services could send spans straight to Jaeger. Why put a Collector in between?
    options:
      - { id: a, text: "Jaeger cannot receive OTLP" }
      - { id: b, text: "The Collector is one place to batch, filter or enrich telemetry and to change where it goes, without touching any service" }
      - { id: c, text: "Spans are only valid after a Collector has seen them" }
    answer: b
    explanation: Services only need to know the Collector's address. Switching back ends, adding a second destination or dropping sensitive attributes becomes a Collector configuration change instead of a change to every service.
  - id: batch-order
    prompt: You add a memory_limiter processor to the pipeline. Where should batch go?
    options:
      - { id: a, text: "Before memory_limiter" }
      - { id: b, text: "After memory_limiter (and after any sampling processors)" }
      - { id: c, text: "It does not matter" }
    answer: b
    explanation: The batch processor's documentation says it should come after memory_limiter and any sampling processors, so that data that will be dropped is dropped before it is batched.
  - id: resource-attributes
    prompt: The trace in Jaeger includes host.name and the full path of the program. What should a team consider?
    options:
      - { id: a, text: "Nothing — telemetry is always private" }
      - { id: b, text: "These are added automatically by the SDK's resource detection; check that machine names and paths are acceptable to store, and remove what is not (for example in the Collector)" }
      - { id: c, text: "Delete the trace, because it is invalid" }
    answer: b
    explanation: Resource detectors describe where spans came from, which helps when debugging. They can also reveal internal hostnames or paths, so decide what is acceptable and filter in the Collector if needed.
verification:
  method: executed
  details: Every command is run by the test suite with Jaeger 2.23.0 and Collector 0.166.0 (official binaries, checksum-verified) and the services from the previous lesson; the output shown was recorded from that run. Viewing traces in the Jaeger web interface is not executed. Jaeger ports and API stability, and the batch processor's placement, were checked against the official documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

In production, services send telemetry to an **OpenTelemetry Collector**, whose **pipeline** receives it, processes it (for example, batches it) and exports it to a back end such as **Jaeger**, which stores traces and lets you search and view them.

## Explain it like I'm twelve

The services are people posting letters. The Collector is the sorting office: letters arrive (receiver), are bundled by destination (processor), and are sent on by van (exporter). Jaeger is the archive at the other end, where you can look any letter up by its number.

Where the analogy breaks: the sorting office can also change the letters on the way — removing a field, or adding a label such as which environment they came from.

## What problem it solves

If every service sent straight to a back end, changing the back end, adding a second one or removing sensitive data would mean changing every service. A Collector in the middle makes those decisions in one place. A back end such as Jaeger then answers the questions you actually ask during an incident: *show me this trace*, *show me the slowest checkouts in the last hour*.

## How it works

![](media:opentelemetry/collector-pipeline.svg)

- The services send OTLP to the Collector on port 4318, exactly as before.
- The pipeline's **batch** processor groups spans before sending, so there are fewer, larger requests.
- The **otlp** exporter forwards them to Jaeger over OTLP/gRPC.
- Jaeger stores them (in memory in this lab) and offers a web interface and an HTTP API on port 16686.

Jaeger version 2 is itself built on the OpenTelemetry Collector, so it is configured in the same style. Here its own OTLP ports are moved to 14317 and 14318 so that they do not clash with the Collector in front of it.

## Try it yourself

> **Local lab** — you need the services from the previous lesson (`otel-node-lab`), the `otelcol` Collector and Jaeger. Every command is run automatically in DevForge's tests with Jaeger 2.23.0. Looking at traces in Jaeger's web interface is the one step that is not.

### 0. Install Jaeger

Download Jaeger 2.23.0 for your system from the [Jaeger releases page](https://github.com/jaegertracing/jaeger/releases) and unpack it. On Linux, for example:

```bash
curl -fsSLO https://github.com/jaegertracing/jaeger/releases/download/v2.23.0/jaeger-2.23.0-linux-amd64.tar.gz
tar -xzf jaeger-2.23.0-linux-amd64.tar.gz
export PATH="$PWD/jaeger-2.23.0-linux-amd64:$PATH"
```

Jaeger also publishes `…sha256sum.txt` files; after unpacking, `sha256sum -c jaeger-2.23.0-linux-amd64.sha256sum.txt` checks the programs inside the archive.

```bash run
jaeger version 2>/dev/null; echo
```

```text output
{"gitCommit":"d723f91447f29a345c288f37eb8d1ce7807bc0be","gitVersion":"v2.23.0","buildDate":"2026-11-04T16:02:09Z"}
```

Jaeger also prints a timestamped log line about its version on the error stream; `2>/dev/null` hides it, and `echo` ends the line.

### 1. Start Jaeger

```bash run
cd .. && mkdir -p otel-jaeger-lab && cd otel-jaeger-lab
jaeger \
  --set=receivers.otlp.protocols.grpc.endpoint=127.0.0.1:14317 \
  --set=receivers.otlp.protocols.http.endpoint=127.0.0.1:14318 \
  --set=extensions.jaeger_query.http.endpoint=127.0.0.1:16686 \
  --set=extensions.jaeger_query.grpc.endpoint=127.0.0.1:16685 \
  > jaeger.log 2>&1 &
echo $! > jaeger.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:16686/ && break; sleep 1; done
curl -s http://127.0.0.1:16686/api/v3/services
```

```text output
{"services":[]}
```

- Without a configuration file, Jaeger runs as an *all-in-one*: it receives, stores (in memory) and serves traces.
- `--set` changes one setting of that built-in configuration: OTLP moves to 14317/14318, and the web interface listens only on `127.0.0.1`, so other computers on your network cannot reach it.
- `/api/v3/…` is the Jaeger API that its documentation marks as **stable**. No services have sent traces yet.

### 2. Build the Collector pipeline

```bash run
cat > pipeline.yaml <<'EOF'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
processors:
  batch:
    timeout: 1s
exporters:
  otlp:
    endpoint: 127.0.0.1:14317
    tls:
      insecure: true
service:
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
EOF
otelcol validate --config=pipeline.yaml && echo "configuration is valid"
otelcol --config=pipeline.yaml > otelcol.log 2>&1 &
echo $! > otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' otelcol.log && break; sleep 1; done
grep -o 'Everything is ready.*data\.' otelcol.log
```

```text output
configuration is valid
Everything is ready. Begin running and processing data.
```

- `batch` with `timeout: 1s` sends a batch at least every second. In a larger pipeline it belongs after any `memory_limiter` or sampling processors, as its documentation says.
- The `otlp` exporter speaks OTLP over gRPC to Jaeger. `tls: insecure: true` is acceptable only because both run on this computer; between machines, use TLS.
- `telemetry: metrics: level: none` turns off the Collector's own metrics endpoint, which would otherwise compete with Jaeger's for the same port.

### 3. Send traffic through it

Start the services from the previous lesson again. Their instrumentation still sends to port 4318, which is now the pipeline:

```bash run
cd ../otel-node-lab
OTEL_SERVICE_NAME=backend node --import ./instrumentation.mjs backend.cjs > backend.log 2>&1 &
echo $! > backend.pid
OTEL_SERVICE_NAME=frontend node --import ./instrumentation.mjs frontend.cjs > frontend.log 2>&1 &
echo $! > frontend.pid
for i in $(seq 1 30); do grep -q 'on http' backend.log && grep -q 'on http' frontend.log && break; sleep 1; done
answer=$(curl -s http://127.0.0.1:7001/checkout)
trace_id=$(echo "$answer" | grep -o '00-[0-9a-f]*-' | cut -d- -f2)
for i in $(seq 1 30); do
  curl -s http://127.0.0.1:16686/api/v3/services | grep backend > /dev/null && curl -s http://127.0.0.1:16686/api/v3/services | grep frontend > /dev/null && break
  sleep 1
done
curl -s http://127.0.0.1:16686/api/v3/services | grep -o '"[a-z]*end"' | sort
```

```text output
"backend"
"frontend"
```

Both services now appear in Jaeger. (Jaeger does not promise an order, so the names are sorted.)

### 4. Look up the trace

```bash run
curl -s "http://127.0.0.1:16686/api/v3/traces/$trace_id" > trace.json
grep -o '"stringValue":"\(frontend\|backend\)"\|"kind":[0-9]\|"name":"GET"' trace.json | sort | uniq -c
```

```text output
      2 "kind":2
      1 "kind":3
      3 "name":"GET"
      1 "stringValue":"backend"
      1 "stringValue":"frontend"
```

The trace has three spans named `GET` — two *Server* spans (`kind` 2) and one *Client* span (`kind` 3) — from the two services, exactly as the Collector printed them in the previous lesson, now stored and searchable. `uniq -c` counts repeated lines; the output is grouped by `sort`.

Ask for a trace that does not exist:

```bash run
curl -s "http://127.0.0.1:16686/api/v3/traces/00000000000000000000000000000001"
```

```text output
{"error":{"httpCode":404,"message":"No traces found"}}
```

### 5. What the SDK told Jaeger about your machine

```bash run
grep -o '"key":"\(host\.name\|os\.type\|process\.command\|process\.runtime\.name\)"' trace.json | sort -u
```

```text output
"key":"host.name"
"key":"os.type"
"key":"process.command"
"key":"process.runtime.name"
```

The SDK's *resource detection* added the machine's name, its operating system and the command that started each service to every span. That helps when debugging ("which machine was slow?"), but it can also reveal internal hostnames or file paths. Decide what is acceptable to store; a Collector processor can remove attributes before they leave your network.

### 6. Look at it

Open <http://localhost:16686>, choose the service **frontend** and select **Find Traces**. Open the trace: the frontend's server span, its client call, and the backend's server span appear as a waterfall, indented by parent. This step is not part of the automatic tests.

### 7. Stop everything

Services first (so their last spans still reach the Collector), then the Collector, then Jaeger:

```bash run
kill "$(cat frontend.pid)" "$(cat backend.pid)"
for pid in $(cat frontend.pid backend.pid); do while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done; done
kill "$(cat ../otel-jaeger-lab/otelcol.pid)" "$(cat ../otel-jaeger-lab/jaeger.pid)"
# Wait until both have exited, so their ports are free for the next lesson.
for pid in $(cat ../otel-jaeger-lab/otelcol.pid ../otel-jaeger-lab/jaeger.pid); do while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done; done
```

Jaeger kept the traces in memory, so they are gone when it stops. Real deployments configure a storage back end.

## Common mistakes

- **Two programs on the same port.** The Collector and Jaeger both use 4317/4318 and a metrics port by default; move one, as here.
- **TLS turned off between machines.** `insecure: true` is for a single computer only.
- **Expecting the Collector to keep data.** It passes telemetry on; it is not storage. If the destination stays down, data can be lost.
- **Using undocumented APIs in scripts.** Jaeger marks its `/api/v3` HTTP API as stable; its older internal API may change between versions.
- **Forgetting that in-memory storage is temporary.** Restarting Jaeger here loses every trace.

## Where this fits in a real system

The same Collector can carry metrics and logs too, exporting metrics to **Prometheus** and traces to Jaeger or another back end, all from one Collector configuration kept in **Git** and deployed by **GitHub Actions** or **Jenkins**. **Grafana** can query Jaeger next to Prometheus, so a dashboard panel showing slow requests can link straight to example traces.
