---
id: opentelemetry-investigate-a-slow-request
title: Investigate a slow request using traces
track: opentelemetry
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [otel-collector-and-jaeger]
objectives:
  - Add a custom span with attributes around the work that matters, next to automatic HTTP spans.
  - Search for slow traces by duration through Jaeger's API, and read which span holds the time.
  - Use span attributes to explain the delay, fix it, and confirm with a new search that no slow traces remain.
checkpoints:
  - { id: found, text: "The search found exactly one slow trace among six requests" }
  - { id: explained, text: "The SELECT orders span's attributes (customer.id=c42, db.rows=5000) explained the delay" }
  - { id: confirmed, text: "After the fix, the same search found no slow traces" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: OpenTelemetry JavaScript — manual instrumentation (create spans)
    url: https://opentelemetry.io/docs/languages/js/instrumentation/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Getting a tracer, startActiveSpan, setting attributes and ending spans.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Jaeger APIs
    url: https://www.jaegertracing.io/docs/latest/architecture/apis/
    publisher: Jaeger documentation
    type: documentation
    level: advanced
    official: true
    why: The api/v3 query service used to search traces by service and duration.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Jaeger 2.23.0 and the OpenTelemetry JavaScript SDK packages from the previous lessons, after those lessons, and their output is compared with this page. The slow database is simulated with a fixed delay, and durations are rounded to the nearest 100 ms. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Users say the order page is "sometimes slow". Averages hide it; logs do not connect the services. You instrument the work that matters with a **custom span**, search Jaeger for **slow traces**, read which span holds the time and *why* from its attributes, fix the cause, and prove with the same search that the slow traces are gone.

## Before you start

Continue from *The Collector pipeline and Jaeger*: `jaeger` installed, and the `otel-node-lab` folder from *Instrumenting Node.js* with its packages and `instrumentation.mjs`. Everything from those lessons is stopped. Here the services send spans straight to Jaeger, without a Collector in between.

The "database" is simulated: one customer has 5000 orders and the lookup has no index, so it takes 400 ms; everyone else takes 10 ms.

## Steps

### 1. Two services, one with a custom span

```bash run
cd ../otel-node-lab
cat > catalog.cjs <<'EOF'
const http = require("node:http");
const { trace } = require("@opentelemetry/api");

const tracer = trace.getTracer("catalog");
// Simulated database: one customer has far more orders, and the lookup has no index.
const ORDERS = { c42: 5000 };
const lookupMs = (rows) => (rows > 1000 ? 400 : 10);

http.createServer((req, res) => {
  const customer = new URL(req.url, "http://localhost").searchParams.get("customer") ?? "unknown";
  tracer.startActiveSpan("SELECT orders", (span) => {
    const rows = ORDERS[customer] ?? 12;
    span.setAttribute("customer.id", customer);
    span.setAttribute("db.rows", rows);
    setTimeout(() => {
      span.end();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ customer, orders: rows }));
    }, lookupMs(rows));
  });
}).listen(7002, "127.0.0.1", () => console.log("catalog on http://127.0.0.1:7002"));
EOF
cat > shop.cjs <<'EOF'
const http = require("node:http");

http.createServer((req, res) => {
  const customer = new URL(req.url, "http://localhost").searchParams.get("customer");
  http.get(`http://127.0.0.1:7002/orders?customer=${customer}`, (answer) => {
    let body = "";
    answer.on("data", (chunk) => (body += chunk));
    answer.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
  });
}).listen(7001, "127.0.0.1", () => console.log("shop on http://127.0.0.1:7001"));
EOF
grep -c "startActiveSpan" catalog.cjs
```

```text output
1
```

- The HTTP instrumentation already makes a span for every request in and out. It cannot know that inside the catalog, the time goes into a database lookup — so `tracer.startActiveSpan("SELECT orders", …)` adds a span around exactly that work.
- `span.setAttribute(…)` records facts that will matter in an investigation: which customer, how many rows.
- Because the span is *active*, it becomes a child of the HTTP server span, so it lands in the same trace.

### 2. Start Jaeger and the services, and send six requests

```bash run
# If the previous lesson's Jaeger or Collector is still shutting down, wait until its ports are free.
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:16686/ || curl -s -o /dev/null http://127.0.0.1:8888/metrics || curl -s -o /dev/null http://127.0.0.1:4318/ || break; sleep 1; done
jaeger \
  --set=receivers.otlp.protocols.grpc.endpoint=127.0.0.1:4317 \
  --set=receivers.otlp.protocols.http.endpoint=127.0.0.1:4318 \
  --set=extensions.jaeger_query.http.endpoint=127.0.0.1:16686 \
  --set=extensions.jaeger_query.grpc.endpoint=127.0.0.1:16685 \
  > jaeger.log 2>&1 &
echo $! > jaeger.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:16686/ && break; sleep 1; done
start() {  # usage: start <service>
  OTEL_SERVICE_NAME=$1 node --import ./instrumentation.mjs "$1.cjs" > "$1.log" 2>&1 &
  echo $! > "$1.pid"
  for i in $(seq 1 30); do grep -q 'on http' "$1.log" && break; sleep 1; done
}
start catalog
start shop
for c in c1 c2 c42 c3 c4 c5; do curl -s "http://127.0.0.1:7001/orders?customer=$c"; echo; done
```

```text output
{"customer":"c1","orders":12}
{"customer":"c2","orders":12}
{"customer":"c42","orders":5000}
{"customer":"c3","orders":12}
{"customer":"c4","orders":12}
{"customer":"c5","orders":12}
```

The instrumentation file sends spans to `127.0.0.1:4318`, which is now Jaeger's own OTLP receiver.

### 3. Search for slow traces

A script that asks Jaeger's API for traces of a service above a duration, and lists their spans:

```bash run
cat > slow-traces.mjs <<'EOF'
// Usage: node slow-traces.mjs <service> <minimum duration, e.g. 300ms> [only traces after this ISO time]
const [service, minimum, after] = process.argv.slice(2);
const now = new Date();
const query = new URLSearchParams({
  "query.service_name": service,
  "query.start_time_min": (after ? new Date(after) : new Date(now - 10 * 60 * 1000)).toISOString(),
  "query.start_time_max": now.toISOString(),
  "query.duration_min": minimum,
  "query.search_depth": "50",
});
const body = await (await fetch(`http://127.0.0.1:16686/api/v3/traces?${query}`)).json();
const spans = (body.result?.resourceSpans ?? []).flatMap((rs) => {
  const svc = rs.resource.attributes.find((a) => a.key === "service.name")?.value.stringValue;
  return rs.scopeSpans.flatMap((ss) => ss.spans.map((s) => ({ ...s, svc })));
});
console.log(`${new Set(spans.map((s) => s.traceId)).size} trace(s) of ${service} over ${minimum}`);
spans.sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1));
for (const s of spans) {
  const ms = Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6;
  const attrs = (s.attributes ?? []).filter((a) => ["customer.id", "db.rows"].includes(a.key))
    .map((a) => `${a.key}=${a.value.stringValue ?? a.value.intValue}`).join(" ");
  console.log(`  ${s.svc.padEnd(8)} ${s.name.padEnd(14)} ~${Math.round(ms / 100) * 100} ms  ${attrs}`.trimEnd());
}
EOF
for i in $(seq 1 30); do node slow-traces.mjs shop 300ms | grep -q '^1 trace' && break; sleep 1; done
node slow-traces.mjs shop 300ms
```

```text output
1 trace(s) of shop over 300ms
  shop     GET            ~400 ms
  shop     GET            ~400 ms
  catalog  GET            ~400 ms
  catalog  SELECT orders  ~400 ms  customer.id=c42 db.rows=5000
```

- `query.duration_min=300ms` keeps only traces whose duration is at least 300 ms: one of the six. That is the point of tracing — finding the *one* slow request among many fast ones.
- The script waits until the trace has arrived: the SDK sends spans in batches, every few seconds.
- Read the spans top to bottom: the shop's server span, its client call, the catalog's server span — all about 400 ms because each *contains* the next — and finally `SELECT orders`, the innermost span, which holds the time itself.

### 4. Explain, then fix

The attributes give the explanation: **customer c42** has **5000 rows**, and the lookup scans them. The fix in a real database would be an index on the customer column (see the PostgreSQL track); here it is simulated by making the lookup fast for every customer:

```bash run
sed -i.bak 's/const lookupMs = (rows) => (rows > 1000 ? 400 : 10);/const lookupMs = () => 10; \/\/ with an index, every lookup is fast/' catalog.cjs && rm catalog.cjs.bak
kill "$(cat catalog.pid)"
while kill -0 "$(cat catalog.pid)" 2> /dev/null; do sleep 0.2; done
start catalog
fixed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sleep 1
curl -s "http://127.0.0.1:7001/orders?customer=c42"; echo
```

```text output
{"customer":"c42","orders":5000}
```

### 5. Confirm with the same search

Only traces since the fix count. Wait until the new trace has arrived, then search for slow ones again:

```bash run
for i in $(seq 1 30); do node slow-traces.mjs catalog 0ms "$fixed_at" | grep -q '^1 trace' && break; sleep 1; done
node slow-traces.mjs catalog 0ms "$fixed_at" | grep 'SELECT orders'
node slow-traces.mjs shop 300ms "$fixed_at"
```

```text output
  catalog  SELECT orders  ~0 ms  customer.id=c42 db.rows=5000
0 trace(s) of shop over 300ms
```

The same customer, the same 5000 rows, and the lookup now rounds to 0 ms: no trace is over 300 ms. Rerunning the *same* query that found the problem is how you show it is fixed — and the same query, run on a schedule, would catch it coming back.

## Check your work

Run this inside `otel-node-lab` while Jaeger and both services are running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "catalog.cjs adds a custom span with attributes" 'grep -q "startActiveSpan(\"SELECT orders\"" catalog.cjs && grep -q "setAttribute(\"db.rows\"" catalog.cjs'
check "Jaeger is running" 'curl -sf -o /dev/null http://127.0.0.1:16686/'
since=$(date -u +%Y-%m-%dT%H:%M:%SZ); sleep 1
curl -s "http://127.0.0.1:7001/orders?customer=c42" > /dev/null 2>&1
for i in $(seq 1 30); do node slow-traces.mjs catalog 0ms "$since" 2> /dev/null | grep -q '^1 trace' && break; sleep 1; done
check "a new request for c42 is traced through both services" 'node slow-traces.mjs shop 0ms "$since" | grep -q "catalog  SELECT orders"'
check "the span records the customer and the row count" 'node slow-traces.mjs catalog 0ms "$since" | grep -q "customer.id=c42 db.rows=5000"'
check "no trace since then is over 300 ms" 'node slow-traces.mjs shop 300ms "$since" | grep -q "^0 trace"'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: catalog.cjs adds a custom span with attributes
PASS: Jaeger is running
PASS: a new request for c42 is traced through both services
PASS: the span records the customer and the row count
PASS: no trace since then is over 300 ms
All checks passed
```

## Clean up

Services first, so their last spans are sent, then Jaeger:

```bash run
kill "$(cat shop.pid)" "$(cat catalog.pid)"
for pid in $(cat shop.pid catalog.pid); do while kill -0 "$pid" 2> /dev/null; do sleep 0.2; done; done
kill "$(cat jaeger.pid)"
```

## Reset

Stop everything (as above) and run steps 1 and 2 again; Jaeger keeps traces in memory, so restarting it starts with none.

## What you practised

Automatic instrumentation shows *where* a request spent its time across services; a custom span with attributes around the important work shows *why*. Searching by duration finds the rare slow request, the innermost span with the time is the place to look, and rerunning the same search after the fix is the proof.
