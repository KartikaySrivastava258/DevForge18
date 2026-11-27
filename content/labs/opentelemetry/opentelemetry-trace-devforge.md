---
id: opentelemetry-trace-devforge
title: Trace DevForge's own requests with a Collector and Jaeger
track: opentelemetry
level: intermediate
mode: local
estimated_minutes: 35
prerequisites: [otel-collector-and-jaeger]
starts_fresh: true
objectives:
  - Run an OpenTelemetry Collector and Jaeger in containers and point a real application at them with the standard OTEL_* environment variables.
  - Send a request that carries your own W3C traceparent, and find exactly that trace in Jaeger by its trace id.
  - Explain why spans are named after route templates, not raw paths, and what DevForge deliberately leaves out of its spans.
checkpoints:
  - { id: pipeline, text: "The Collector and Jaeger containers run on one Docker network, and the Collector configuration validates" }
  - { id: found, text: "Jaeger returned the trace with the id you chose, with DevForge's span as a child of your parent id" }
  - { id: operations, text: "Six requests to different track paths appeared as one operation, GET /api/tracks/:slug" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Semantic conventions for HTTP spans
    url: https://opentelemetry.io/docs/specs/semconv/http/http-spans/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: The span name rule ({method} {http.route}), the server-span attributes and when a span's status is Error.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Trace Context (W3C Recommendation)
    url: https://www.w3.org/TR/trace-context/
    publisher: W3C
    type: documentation
    level: intermediate
    official: true
    why: The traceparent header format, and which values a server must ignore.
    verification: { status: verified, checked_on: 2026-11-27 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Docker, the OpenTelemetry Collector 0.165.0 and Jaeger 2.23.0 images pinned by digest, against a real DevForge server started with OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 and OTEL_SERVICE_NAME=devforge, and the output is compared with this page. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Goal

DevForge itself is instrumented with OpenTelemetry: when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, it sends one **server span** per HTTP request (see ADR 0009 in the repository). In this lab you run the same pipeline as in *The Collector pipeline and Jaeger* — application → Collector → Jaeger — but in containers and with a real application, and you find one particular request among many.

## Before you start

- Docker, `curl` and Node.js 22 (which DevForge needs anyway).
- Your DevForge folder, built once with `npm run build` (see the README). Nothing from the earlier lessons needs to be running; stop any `otelcol` or `jaeger` you started there, because this lab uses the same ports (4318 and 16686).

The images are pinned by version **and** digest, so everyone runs exactly the same bytes: `otel/opentelemetry-collector:0.165.0` and `jaegertracing/jaeger:2.23.0`.

## Steps

### 1. A Collector configuration

```bash run
mkdir devforge-tracing && cd devforge-tracing
cat > otel-collector.yaml <<'EOF'
# DevForge -> (OTLP/HTTP :4318) -> Collector -> (OTLP/gRPC) -> Jaeger
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318   # all interfaces inside the container; Docker publishes it on 127.0.0.1 only

processors:
  batch:
    timeout: 1s

exporters:
  otlp_grpc:
    endpoint: jaeger:4317        # Jaeger's name on the Docker network
    tls:
      insecure: true             # plain gRPC inside the lab network; use TLS between hosts

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp_grpc]
EOF
COLLECTOR=otel/opentelemetry-collector:0.165.0@sha256:34b24b740c3c88d3467740e8642a397c13898ef76d7295c5425164c482ed1b73
docker pull -q "$COLLECTOR" > /dev/null
docker run --rm -e COLLECTOR_CONFIG="$(cat otel-collector.yaml)" "$COLLECTOR" validate --config=env:COLLECTOR_CONFIG > /dev/null && echo "otel-collector.yaml is valid"
```

```text output
otel-collector.yaml is valid
```

- DevForge exports OTLP over **HTTP with JSON** to port 4318, so the Collector only needs the `http` protocol of its OTLP receiver.
- `--config=env:COLLECTOR_CONFIG` reads the configuration from an environment variable instead of a mounted file — one less file permission to get right. `validate` checks it without starting anything.

### 2. Start Jaeger and the Collector on one network

```bash run
JAEGER=jaegertracing/jaeger:2.23.0@sha256:3823829974ccfc2485d2e48b165579091f32295022ae80ca49704e2f4834116e
docker pull -q "$JAEGER" > /dev/null
docker network create otel-lab > /dev/null
docker run -d --name otel-lab-jaeger --network otel-lab --network-alias=jaeger -p 127.0.0.1:16686:16686 "$JAEGER" > /dev/null
docker run -d --name otel-lab-collector --network otel-lab -p 127.0.0.1:4318:4318 \
  -e COLLECTOR_CONFIG="$(cat otel-collector.yaml)" "$COLLECTOR" --config=env:COLLECTOR_CONFIG > /dev/null
for i in $(seq 1 30); do docker logs otel-lab-collector 2>&1 | grep 'Everything is ready' > /dev/null && break; sleep 1; done
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:16686/ && break; sleep 1; done
for c in otel-lab-jaeger otel-lab-collector; do echo "$c: $(docker inspect -f '{{.State.Status}}' "$c")"; done
```

```text output
otel-lab-jaeger: running
otel-lab-collector: running
```

Only two ports reach your machine, both on `127.0.0.1`: the Collector's OTLP/HTTP port for DevForge, and Jaeger's UI and API. Jaeger's own OTLP port (4317) stays inside the Docker network, where only the Collector uses it.

### 3. Start DevForge with tracing on

In a **second terminal**, in your DevForge folder:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_SERVICE_NAME=devforge npm start
```

Among its first log lines DevForge says `"msg":"tracing on"` with the receiver and service name. Then, back in the first terminal:

```bash
export API=http://localhost:8080
```

These are the standard variables every OpenTelemetry SDK reads; DevForge appends `/v1/traces` to the endpoint, as the OTLP specification says.

### 4. Send a request with your own trace id

A W3C `traceparent` header is `version-traceid-parentid-flags`. Make up a trace id, send it, and keep it:

```bash run
trace_id=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
echo "$trace_id" > trace-id.txt
curl -s -o /dev/null -w '%{http_code}\n' -H "traceparent: 00-$trace_id-00f067aa0ba902b7-01" "$API/api/tracks/docker"
```

```text output
200
```

`00f067aa0ba902b7` plays the caller's span id, and the flags `01` say "sampled". DevForge honours the header: its span joins *your* trace instead of starting a new one — exactly what happens when one instrumented service calls another.

### 5. Find that trace in Jaeger

A small script that asks Jaeger's API for one trace by id and prints its spans:

```bash run
cat > show-trace.mjs <<'EOF'
// Usage: node show-trace.mjs <trace id> — prints the trace's spans from Jaeger's API.
const id = process.argv[2];
const res = await fetch(`http://127.0.0.1:16686/api/v3/traces/${id}`);
if (!res.ok) {
  console.log(`trace ${id} not found (HTTP ${res.status})`);
  process.exit(1);
}
const body = await res.json();
for (const rs of body.result.resourceSpans) {
  const service = rs.resource.attributes.find((a) => a.key === "service.name")?.value.stringValue;
  for (const ss of rs.scopeSpans) {
    for (const s of ss.spans) {
      console.log(`service: ${service}`);
      console.log(`span:    ${s.name} (kind ${s.kind === 2 ? "SERVER" : s.kind}, parent ${s.parentSpanId || "none"})`);
      const value = (v) => v.stringValue ?? v.intValue ?? (v.arrayValue?.values ?? []).map(value).join("; ");
      const attributes = [...s.attributes].sort((a, b) => a.key.localeCompare(b.key));
      for (const a of attributes) {
        if (a.key === "devforge.request_id") continue; // different on every run
        // Jaeger adds its own notes about a span under keys starting with @jaeger@.
        if (a.key.startsWith("@jaeger@")) console.log(`  (Jaeger ${a.key.slice(8)}: ${value(a.value)})`);
        else console.log(`  ${a.key} = ${value(a.value)}`);
      }
    }
  }
}
EOF
for i in $(seq 1 30); do node show-trace.mjs "$(cat trace-id.txt)" > /dev/null && break; sleep 1; done
node show-trace.mjs "$(cat trace-id.txt)"
```

```text output
service: devforge
span:    GET /api/tracks/:slug (kind SERVER, parent 00f067aa0ba902b7)
  (Jaeger warnings: parent span ID=00f067aa0ba902b7 is not in the trace; skipping clock skew adjustment)
  http.request.method = GET
  http.response.status_code = 200
  http.route = /api/tracks/:slug
  network.protocol.version = 1.1
  url.path = /api/tracks/docker
  url.scheme = http
```

- The wait loop is needed because spans travel in batches: DevForge sends every 5 seconds, the Collector every second.
- The parent is the id you invented. Jaeger has no span with that id — `curl` does not send spans — and says so in a warning it attaches to the span (the UI shows it too). In a real system the caller's span would be there, and Jaeger would use it to correct clock differences between the two hosts.
- In the UI, open <http://localhost:16686>, paste the trace id into the search box at the top, and you see the same span. The span's `devforge.request_id` attribute equals the `X-Request-Id` header of the response, and DevForge's access log line for the request carries the same `traceId`, so a log line leads to its trace and back.

### 6. Many requests, one operation

```bash run
for t in git-github redis kafka nginx; do curl -s -o /dev/null "$API/api/tracks/$t"; done
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/tracks/no-such-track"
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/users/someone@example.edu"
operations() { curl -s "http://127.0.0.1:16686/api/v3/operations?service=devforge" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () =>
    console.log((JSON.parse(s).operations ?? []).map((o) => o.name).sort().join("\n")));'; }
for i in $(seq 1 30); do [ "$(operations | wc -l)" -ge 2 ] && break; sleep 1; done
operations
```

```text output
404
404
GET
GET /api/tracks/:slug
```

- Six different track paths, including one that does not exist, are **one** operation: the span name is the route *template*. Naming spans after raw paths (`/api/tracks/redis`, `/api/tracks/kafka`, …) would create one operation per track, lesson or user — the same cardinality problem as putting raw URLs into Prometheus labels.
- `/api/users/someone@example.edu` matched no route, so its span is named just `GET`, as the HTTP semantic conventions require. Its `url.path` attribute is stored as `/api/users/REDACTED`: DevForge replaces anything that looks like an e-mail address, and never records request bodies, headers (cookies, tokens), query strings or client IP addresses.
- A 404 leaves a server span's status *unset*: the client asked for something that does not exist, which is not a server error. A 5xx response would set the status to Error.

## Check your work

Run this inside `devforge-tracing` while the containers and DevForge are running, with `API` set.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "otel-collector.yaml receives OTLP/HTTP and exports to Jaeger" 'grep -q "endpoint: 0.0.0.0:4318" otel-collector.yaml && grep -q "endpoint: jaeger:4317" otel-collector.yaml'
check "the Collector container is running" '[ "$(docker inspect -f "{{.State.Running}}" otel-lab-collector)" = true ]'
check "Jaeger answers on port 16686" 'curl -sf -o /dev/null http://127.0.0.1:16686/'
check "DevForge answers at \$API" 'curl -sf -o /dev/null "$API/api/health"'
id=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d " \n")
curl -s -o /dev/null -H "traceparent: 00-$id-00f067aa0ba902b7-01" "$API/api/tracks/docker" 2> /dev/null
if [ -f show-trace.mjs ]; then for i in $(seq 1 30); do node show-trace.mjs "$id" > /dev/null 2>&1 && break; sleep 1; done; fi
check "a new request with your traceparent reached Jaeger in your trace" 'node show-trace.mjs "$id" | grep "parent 00f067aa0ba902b7"'
check "its span is named by the route template" 'node show-trace.mjs "$id" | grep "span:    GET /api/tracks/:slug"'
check "it records the route and the status code" 'node show-trace.mjs "$id" | grep "http.route = /api/tracks/:slug" && node show-trace.mjs "$id" | grep "http.response.status_code = 200"'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: otel-collector.yaml receives OTLP/HTTP and exports to Jaeger
PASS: the Collector container is running
PASS: Jaeger answers on port 16686
PASS: DevForge answers at $API
PASS: a new request with your traceparent reached Jaeger in your trace
PASS: its span is named by the route template
PASS: it records the route and the status code
All checks passed
```

## Clean up

Stop DevForge with Ctrl+C in its terminal (it sends the spans still queued before it exits), then:

```bash run
docker rm -f -v otel-lab-collector otel-lab-jaeger > /dev/null
docker network rm otel-lab > /dev/null
echo "removed"
```

```text output
removed
```

## Reset

Run the clean-up, then steps 2 to 5 again. Jaeger keeps traces in memory, so a new container starts with none.

## What you practised

Turning tracing on is configuration, not code: the standard `OTEL_*` variables point an instrumented application at a Collector, and the Collector decides where traces go. A `traceparent` header joins a request to an existing trace, and a trace id is the key that connects a log line, a trace and a request. Span names from route templates keep operations few and meaningful, and what a span leaves out — bodies, cookies, query strings, personal data — matters as much as what it records.
