---
id: otel-sampling-and-cost
title: Sampling traces without losing the story
track: opentelemetry
order: 6
level: advanced
estimated_minutes: 45
prerequisites: [otel-collector-and-jaeger]
learning_objectives:
  - Configure head sampling in the SDK with OTEL_TRACES_SAMPLER and OTEL_TRACES_SAMPLER_ARG, and check the kept fraction with a statistically safe test.
  - Explain why ParentBased keeps whole traces across services, and show what goes wrong without it.
  - Sample in the Collector with the probabilistic_sampler processor, and explain why hashing on the trace ID keeps traces complete.
  - Decide when tail sampling is needed, and what it costs to run.
resources:
  - title: Sampling (OpenTelemetry concepts)
    url: https://opentelemetry.io/docs/concepts/sampling/
    publisher: OpenTelemetry
    type: documentation
    level: intermediate
    official: true
    why: Head sampling decides early without seeing the whole trace (most commonly consistent probability sampling on the trace ID); tail sampling decides after seeing all or most spans, and is harder to run.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: SDK environment variables — OTEL_TRACES_SAMPLER
    url: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
    publisher: OpenTelemetry
    type: reference
    level: intermediate
    official: true
    why: The default is parentbased_always_on; the known values include traceidratio and parentbased_traceidratio, with the ratio in OTEL_TRACES_SAMPLER_ARG.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Tracing SDK specification — built-in samplers
    url: https://opentelemetry.io/docs/specs/otel/trace/sdk/
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: The default sampler is ParentBased(root=AlwaysOn); TraceIdRatioBased is deprecated in favour of the composable ProbabilitySampler, but SDKs must keep its behaviour.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Probabilistic sampling processor (README, v0.166.0)
    url: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.166.0/processor/probabilisticsamplerprocessor/README.md
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: sampling_percentage, the default hash_seed mode, and why every Collector in one tier must use the same hash_seed.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Tail sampling processor (README)
    url: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md
    publisher: OpenTelemetry
    type: reference
    level: advanced
    official: true
    why: Policies such as status_code and latency; decision_wait (default 30s) and num_traces (default 50000) held in memory; all spans of a trace must reach the same Collector instance.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: parentbased
    prompt: The edge service samples 10% of requests. A downstream service uses plain traceidratio at 10% too. What happens to a request the edge kept?
    options:
      - { id: a, text: "It is always kept downstream as well" }
      - { id: b, text: "The downstream service ignores the sampled flag in traceparent, so the trace is complete only when both happen to agree — use parentbased_traceidratio so services follow the caller's decision" }
      - { id: c, text: "The trace ID changes" }
    answer: b
    explanation: The lab shows plain traceidratio at 0 dropping a span whose caller said "sampled" (flag 01), while ParentBased keeps it. (Ratio samplers that hash the same trace ID with the same ratio do agree; with different ratios they do not.)
  - id: tail
    prompt: You must keep every trace that contains an error, but only 5% of the rest. Which sampling do you need?
    options:
      - { id: a, text: "Head sampling at 5%" }
      - { id: b, text: "Tail sampling in the Collector (a status_code policy plus a probabilistic policy), with all spans of a trace routed to the same Collector instance" }
      - { id: c, text: "No sampling" }
    answer: b
    explanation: A head decision is made before anyone knows the request will fail; only a decision after the trace is complete can choose by outcome.
  - id: stats
    prompt: Why does the lab accept anything from 60 to 140 kept traces out of 400 at 25%, instead of exactly 100?
    options:
      - { id: a, text: "The SDK is inaccurate" }
      - { id: b, text: "Trace IDs are random, so the count is a binomial variable (mean 100, standard deviation about 8.7); a range of ±40 makes a false failure astronomically unlikely while still catching a wrong ratio" }
      - { id: c, text: "To make the test pass" }
    answer: b
    explanation: Tests of random behaviour must bound the result, not pin it; asserting exactly 100 would fail most runs.
verification:
  method: executed
  details: Every command is run by the test suite with the OpenTelemetry JavaScript SDK (api 1.10.0, sdk-node 0.301.2, OTLP proto exporter 0.301.2) and Collector 0.166.0, after the earlier OpenTelemetry lessons, and its output is compared with this lesson. Counts of sampled traces are random, so the lab checks that they fall in a range. The tail sampling configuration is shown but not run, because tail_sampling is not part of the core Collector distribution used here. Checked against the OpenTelemetry documentation and specification and the processor READMEs on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Sampling** keeps a fraction of traces so tracing stays affordable — and doing it right means keeping **whole traces** (every span of a kept request), deciding consistently across services, and knowing which interesting traces a cheap, early decision will throw away.

## Explain it like I'm twelve

A teacher cannot read every homework every day, so they read one in four. Two ways to choose:

- **Head sampling**: decide when the homework is handed in — "every fourth name on the register". Cheap and simple, but the one homework with a serious mistake might not be among them.
- **Tail sampling**: glance at *all* of them first, then read every one with red ink plus a quarter of the rest. Better choices, but the teacher must hold the whole pile on the desk until the end of the day.

And if the teacher picks a homework, every page of it must be read — half a homework (half a trace) is useless.

## What problem it solves

A busy service produces thousands of spans per second. Exporting, storing and indexing all of them costs network, CPU and storage — tracing backends commonly charge or scale by span volume. Most traces of healthy requests look alike, so keeping a representative fraction loses little. Metrics (previous lesson) still count *every* request, so rates and error ratios stay exact while traces become samples.

## How it works

![](media:opentelemetry/sampling.svg)

- **The default** sampler is `parentbased_always_on`: keep every new trace, and follow the caller's decision.
- **`traceidratio`** keeps a trace when its (random) trace ID falls below a threshold — the same trace ID always gets the same answer for the same ratio. The specification now deprecates it in favour of a composable `ProbabilitySampler`, but SDKs must keep its behaviour; the JavaScript SDK used here (0.301.2) still offers only the ratio sampler.
- **`parentbased_…`** applies the root sampler only to new traces; spans with a parent follow the parent's **sampled flag** — the last two digits of `traceparent` (`01` sampled, `00` not).
- **Unsampled spans are not recorded**: span processors and exporters never see them, so they cost almost nothing.
- **In the Collector**, `probabilistic_sampler` hashes the trace ID, so all spans of a trace get the same decision; every Collector in a tier must use the same `hash_seed`.
- **Tail sampling** (`tail_sampling` processor, in the contrib distribution) waits until a trace is complete, then applies policies such as "status is ERROR" or "latency above 500 ms".

## Try it yourself

> **Local lab** — continues in `otel-node-lab` from *Instrumenting a Node.js service* and *The Collector pipeline and Jaeger*. Each run produces 400 traces of two spans: a request (`GET /orders`) and a database call (`SELECT orders`). Every command is run automatically in DevForge's tests.

### 1. Head sampling in the SDK

A tiny span processor counts the spans that were actually recorded — unsampled ones never reach it.

```bash run
cat > sampling.mjs <<'JS'
import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";
// Count recorded spans: processors only ever see spans the sampler kept.
const seen = { requests: 0, queries: 0 };
const counter = { onStart() {}, onEnd(span) { span.name === "GET /orders" ? seen.requests++ : seen.queries++; },
                  forceFlush: async () => {}, shutdown: async () => {} };
const sdk = new NodeSDK({ spanProcessors: [counter] });   // the sampler comes from OTEL_TRACES_SAMPLER
sdk.start();
const tracer = trace.getTracer("sampling");
for (let i = 0; i < 400; i++) {
  tracer.startActiveSpan("GET /orders", (request) => { tracer.startSpan("SELECT orders").end(); request.end(); });
}
await sdk.shutdown();
console.log(seen.requests, seen.queries);
JS
read requests queries < <(node sampling.mjs)
echo "default sampler (parentbased_always_on): kept $requests of 400 traces"
read requests queries < <(OTEL_TRACES_SAMPLER=parentbased_traceidratio OTEL_TRACES_SAMPLER_ARG=0.25 node sampling.mjs)
echo "parentbased_traceidratio, ratio 0.25:"
[ "$requests" -ge 60 ] && [ "$requests" -le 140 ] && echo "  kept 60–140 of 400 traces (25% would be 100): yes"
[ "$queries" -eq "$requests" ] && echo "  every kept trace is complete: yes"
```

```text output
default sampler (parentbased_always_on): kept 400 of 400 traces
parentbased_traceidratio, ratio 0.25:
  kept 60–140 of 400 traces (25% would be 100): yes
  every kept trace is complete: yes
```

About a quarter of the requests were kept, and each kept request kept its database span too: the child followed its parent's decision instead of rolling its own dice. A count of *exactly* 100 is not expected — trace IDs are random, so the kept count varies from run to run (mean 100, standard deviation about 8.7).

### 2. Follow the caller — or break the trace

A downstream service receives requests whose `traceparent` already says *sampled* (`…-01`) or *not sampled* (`…-00`). Give it a ratio of **0**, so it would never start a trace on its own:

```bash run
cat > downstream.mjs <<'JS'
import { NodeSDK } from "@opentelemetry/sdk-node";
import { context, propagation, trace } from "@opentelemetry/api";
// A processor that does nothing: with no processor at all, NodeSDK would not install a tracer provider.
const sdk = new NodeSDK({ spanProcessors: [{ onStart() {}, onEnd() {}, forceFlush: async () => {}, shutdown: async () => {} }] });
sdk.start();
const tracer = trace.getTracer("downstream");
for (const flag of ["01", "00"]) {
  const incoming = { traceparent: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-${flag}` };
  const span = tracer.startSpan("GET /stock", {}, propagation.extract(context.active(), incoming));
  console.log(`  caller says ${flag === "01" ? "sampled    " : "not sampled"} → recorded here: ${span.isRecording()}`);
  span.end();
}
await sdk.shutdown();
JS
for sampler in parentbased_traceidratio traceidratio; do
  echo "$sampler, ratio 0:"
  OTEL_TRACES_SAMPLER=$sampler OTEL_TRACES_SAMPLER_ARG=0 node downstream.mjs
done
```

```text output
parentbased_traceidratio, ratio 0:
  caller says sampled     → recorded here: true
  caller says not sampled → recorded here: false
traceidratio, ratio 0:
  caller says sampled     → recorded here: false
  caller says not sampled → recorded here: false
```

With `ParentBased`, the downstream service honours the caller: the trace the edge decided to keep stays complete. Plain `traceidratio` ignores the flag and decides alone — here it drops a span the caller kept, leaving a trace with a hole in it. Configure the **edge** (the first service a request meets) with the ratio, and everything behind it with `parentbased_…`.

### 3. Sampling in the Collector instead

Sometimes you cannot redeploy every service, or want one place to set the rate. Keep everything in the SDK and sample in the Collector:

```bash run
cat > collector-sampling.yaml <<'EOF2'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
processors:
  probabilistic_sampler:
    sampling_percentage: 25        # hashes the trace ID, so a trace's spans share one decision
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces: { receivers: [otlp], processors: [probabilistic_sampler], exporters: [debug] }
EOF2
cat > burst.mjs <<'JS'
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { trace } from "@opentelemetry/api";
const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" }) });
sdk.start();
const tracer = trace.getTracer("burst");
for (let i = 0; i < 400; i++) {
  tracer.startActiveSpan("GET /orders", (request) => { tracer.startSpan("SELECT orders").end(); request.end(); });
}
await sdk.shutdown();   // waits until the Collector has accepted every batch
JS
otelcol --config=collector-sampling.yaml > sampling-otelcol.log 2>&1 &
echo $! > sampling-otelcol.pid
for i in $(seq 1 30); do grep -q 'Everything is ready' sampling-otelcol.log && break; sleep 1; done
grep -q 'Everything is ready' sampling-otelcol.log || { echo "the Collector did not start:"; tail -n 5 sampling-otelcol.log; exit 1; }
OTEL_TRACES_SAMPLER=always_on node burst.mjs
# wait until the debug output stops growing
last=-1; for i in $(seq 1 30); do now=$(grep -c '^Span #' sampling-otelcol.log); [ "$now" -gt 0 ] && [ "$now" = "$last" ] && break; last=$now; sleep 1; done
spans=$(grep -c '^Span #' sampling-otelcol.log)
traces=$(grep -E '^    Trace ID' sampling-otelcol.log | sort -u | wc -l)
echo "SDK sent 800 spans in 400 traces"
[ "$traces" -ge 60 ] && [ "$traces" -le 140 ] && echo "Collector kept 60–140 traces: yes"
[ "$spans" -eq $((traces * 2)) ] && echo "every kept trace is complete: yes"
kill "$(cat sampling-otelcol.pid)"; while kill -0 "$(cat sampling-otelcol.pid)" 2> /dev/null; do sleep 0.2; done
```

```text output
SDK sent 800 spans in 400 traces
Collector kept 60–140 traces: yes
every kept trace is complete: yes
```

The trade-off: every span still travels from the service to the Collector, so this saves storage and backend cost, not the service's network and export CPU. Head sampling in the SDK saves both.

### 4. What head sampling cannot do

Both kinds of sampling above decide **without knowing how the request ended**. A rare failing request is kept only by luck — at 25%, three out of four errors leave no trace. Keeping "all errors and all slow requests, plus a few of the rest" needs **tail sampling**, which is not in the core Collector you have been running:

```bash run
otelcol components | grep -E '^    - name: (probabilistic_sampler|tail_sampling)$' || true
echo "tail_sampling available in this Collector: $(otelcol components | grep -qE 'name: tail_sampling$' && echo yes || echo no)"
```

```text output
    - name: probabilistic_sampler
tail_sampling available in this Collector: no
```

It ships in the **contrib** distribution (`otelcol-contrib`). A typical configuration — shown here, **not run** in this lab:

```yaml
processors:
  tail_sampling:
    decision_wait: 10s            # hold each trace this long before deciding (default 30s)
    num_traces: 50000             # traces kept in memory while waiting (the default)
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: some-of-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
```

The price: the Collector holds every span of every recent trace in memory for `decision_wait`, and **all spans of a trace must reach the same Collector instance** — with several Collectors you need a first tier that routes by trace ID (the contrib `loadbalancing` exporter) in front of the tail-sampling tier.

## Common mistakes

- **Plain `traceidratio` on downstream services.** Use `parentbased_traceidratio` so they follow the caller and traces stay whole.
- **Asserting an exact sampled count in tests.** Sampling is random; test a range wide enough to make false failures negligible.
- **Computing rates from sampled traces.** Count requests and errors with metrics, which see every request; use traces for examples and detail.
- **Tail sampling behind a plain load balancer.** Spans of one trace land on different Collectors and each sees an incomplete trace.
- **Different `hash_seed` values in one Collector tier.** The same trace gets different decisions on different instances.
- **Sampling logs by accident.** Log records outside sampled spans still flow; decide separately how much log volume you keep.

## Where this fits in a real system

The edge — an **Nginx** proxy, an ingress in **Kubernetes**, or the first service — makes the head decision and passes it on in `traceparent`; every service behind it follows. **Prometheus** metrics stay unsampled for SLOs and alerts, while **Jaeger** stores the sampled traces; tail sampling in a Collector tier keeps the errors that an alert will make you look for.
