/**
 * OpenTelemetry tracing (ADR 0009): configuration, W3C trace context, sampling, and the spans DevForge
 * exports — checked against a fake OTLP/HTTP receiver, and (with DEVFORGE_DOCKER_TEST=1) against a real
 * OpenTelemetry Collector container.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { dockerTestingEnabled } from "../../scripts/lib/lesson-runner.ts";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/observability/logger.ts";
import { parseTraceparent, scrubPath, shouldSample, Tracer, tracingConfigFromEnv, type OtlpSpan, type TracingConfig } from "../src/observability/tracing.ts";
import { Client, startTestServer, STRONG_PASSWORD, type TestServer } from "./helpers.ts";

const PARENT_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN = "00f067aa0ba902b7";

describe("tracing configuration", () => {
  it("is off unless an OTLP endpoint is set", () => {
    assert.equal(tracingConfigFromEnv({}), undefined);
    assert.equal(loadConfig({}).tracing, undefined);
    assert.equal(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318", OTEL_SDK_DISABLED: "true" }), undefined);
  });
  it("appends /v1/traces to the base endpoint only, and reads the standard variables", () => {
    const c = tracingConfigFromEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/",
      OTEL_SERVICE_NAME: "devforge-a",
      OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=staging,service.version=0.1.0",
      OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc%3D1",
    });
    assert.equal(c?.tracesUrl, "http://collector:4318/v1/traces");
    assert.equal(c?.serviceName, "devforge-a");
    assert.deepEqual(c?.resourceAttributes, { "deployment.environment.name": "staging", "service.version": "0.1.0" });
    assert.deepEqual(c?.headers, { "x-api-key": "abc=1" });
    assert.equal(c?.sampler, "parentbased_always_on");
    assert.equal(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otel.example.edu/in" })?.tracesUrl, "https://otel.example.edu/in");
    assert.equal(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318" })?.serviceName, "devforge");
  });
  it("rejects what it cannot do, with a configuration error", () => {
    assert.throws(() => loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4317", OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" }), /Invalid configuration:[\s\S]*http\/json/);
    assert.throws(() => tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" }), /URL/);
    assert.throws(() => tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "ftp://c" }), /http/);
    assert.throws(() => tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c", OTEL_TRACES_SAMPLER: "sometimes" }), /OTEL_TRACES_SAMPLER/);
    assert.throws(() => tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c", OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "2" }), /0 to 1/);
    assert.doesNotThrow(() => tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c", OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" }));
  });
});

describe("W3C trace context and sampling", () => {
  it("accepts a valid traceparent and keeps tracestate", () => {
    assert.deepEqual(parseTraceparent(`00-${PARENT_TRACE}-${PARENT_SPAN}-01`, "congo=t61rcWkgMzE"), {
      traceId: PARENT_TRACE,
      spanId: PARENT_SPAN,
      sampled: true,
      traceState: "congo=t61rcWkgMzE",
    });
    assert.equal(parseTraceparent(`00-${PARENT_TRACE}-${PARENT_SPAN}-00`)?.sampled, false);
    // A later version may append fields; version 00 may not.
    assert.equal(parseTraceparent(`01-${PARENT_TRACE}-${PARENT_SPAN}-01-extra`)?.traceId, PARENT_TRACE);
  });
  it("ignores invalid headers (a new trace starts instead)", () => {
    for (const bad of [
      undefined,
      "",
      `00-${PARENT_TRACE.toUpperCase()}-${PARENT_SPAN}-01`,
      `00-${"0".repeat(32)}-${PARENT_SPAN}-01`,
      `00-${PARENT_TRACE}-${"0".repeat(16)}-01`,
      `ff-${PARENT_TRACE}-${PARENT_SPAN}-01`,
      `00-${PARENT_TRACE}-${PARENT_SPAN}-01-extra`,
      `00-${PARENT_TRACE.slice(1)}-${PARENT_SPAN}-01`,
    ]) {
      assert.equal(parseTraceparent(bad), undefined, String(bad));
    }
    assert.equal(parseTraceparent([`00-${PARENT_TRACE}-${PARENT_SPAN}-01`, `00-${PARENT_TRACE}-${PARENT_SPAN}-01`]), undefined, "two headers");
  });
  it("follows the parent's decision under parentbased samplers and the ratio for roots", () => {
    const parent = { traceId: PARENT_TRACE, spanId: PARENT_SPAN, sampled: false };
    assert.equal(shouldSample("parentbased_always_on", 1, PARENT_TRACE, parent), false);
    assert.equal(shouldSample("parentbased_always_on", 1, PARENT_TRACE, undefined), true);
    assert.equal(shouldSample("always_on", 1, PARENT_TRACE, parent), true);
    assert.equal(shouldSample("always_off", 1, PARENT_TRACE, undefined), false);
    assert.equal(shouldSample("traceidratio", 0.5, `${"a".repeat(18)}${"0".repeat(14)}`, undefined), true);
    assert.equal(shouldSample("traceidratio", 0.5, `${"a".repeat(18)}${"f".repeat(14)}`, undefined), false);
  });
  it("scrubs e-mail-like path segments and caps the length", () => {
    assert.equal(scrubPath("/api/users/someone@example.edu/x"), "/api/users/REDACTED/x");
    assert.equal(scrubPath("/a/b%40c"), "/a/REDACTED");
    assert.equal(scrubPath(`/${"x".repeat(2000)}`).length, 1025);
  });
});

/** A fake OTLP/HTTP receiver: records each request's path, headers and JSON body. */
interface Receiver {
  url: string;
  requests: { path: string; headers: Record<string, string | string[] | undefined>; raw: string; body: any }[];
  status: number;
  close: () => Promise<void>;
}
async function startReceiver(): Promise<Receiver> {
  const requests: Receiver["requests"] = [];
  const state = { status: 200 };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d: Buffer) => (raw += d.toString()));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", headers: req.headers, raw, body: JSON.parse(raw || "{}") });
      res.statusCode = state.status;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get status() {
      return state.status;
    },
    set status(v: number) {
      state.status = v;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const spansOf = (receiver: Receiver): OtlpSpan[] =>
  receiver.requests.flatMap((r) => r.body.resourceSpans.flatMap((rs: any) => rs.scopeSpans.flatMap((ss: any) => ss.spans)));
const attrs = (span: OtlpSpan): Record<string, string | boolean> =>
  Object.fromEntries(span.attributes.map((a) => [a.key, Object.values(a.value)[0] as string | boolean]));

function testConfig(url: string, extra: Partial<TracingConfig> = {}): TracingConfig {
  return {
    ...(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: url, OTEL_SERVICE_NAME: "devforge-test", OTEL_EXPORTER_OTLP_HEADERS: "x-tenant=lab" }) as TracingConfig),
    scheduleDelayMs: 60_000, // tests flush explicitly
    ...extra,
  };
}

describe("spans exported to an OTLP receiver", () => {
  let receiver: Receiver;
  let server: TestServer;
  let tracer: Tracer;
  const logLines: string[] = [];

  before(async () => {
    receiver = await startReceiver();
    tracer = new Tracer(testConfig(receiver.url), { logger: createLogger("debug", (l) => logLines.push(l)) });
    server = await startTestServer({}, undefined, { tracer, logger: createLogger("debug", (l) => logLines.push(l)) });
    server.app.router.get("/api/test/boom", () => {
      throw new Error("internal detail that must not reach a span");
    });
    await server.createUser("traced@example.edu", STRONG_PASSWORD);
  });
  after(async () => {
    await tracer.shutdown();
    await server.close();
    await receiver.close();
  });

  it("one SERVER span per request, named by method and route template, joining the caller's trace", async () => {
    receiver.requests.length = 0;
    const c = new Client(server.url);
    const res = await c.get("/api/tracks/docker?utm=from-a-query", { traceparent: `00-${PARENT_TRACE}-${PARENT_SPAN}-01`, tracestate: "vendor=x" });
    assert.equal(res.status, 200);
    await tracer.forceFlush();

    assert.equal(receiver.requests.length, 1);
    const request = receiver.requests[0]!;
    assert.equal(request.path, "/v1/traces");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-tenant"], "lab", "OTEL_EXPORTER_OTLP_HEADERS are sent");
    const resource = Object.fromEntries(request.body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, a.value.stringValue]));
    assert.equal(resource["service.name"], "devforge-test");

    const [span] = spansOf(receiver);
    assert.ok(span);
    assert.equal(span.name, "GET /api/tracks/:slug");
    assert.equal(span.kind, 2, "SPAN_KIND_SERVER");
    assert.equal(span.traceId, PARENT_TRACE);
    assert.equal(span.parentSpanId, PARENT_SPAN);
    assert.equal(span.traceState, "vendor=x");
    assert.match(span.spanId, /^[0-9a-f]{16}$/);
    assert.equal(span.status.code, 0, "2xx leaves the status unset");
    assert.match(span.startTimeUnixNano, /^\d{19}$/);
    assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
    const a = attrs(span);
    assert.equal(a["http.request.method"], "GET");
    assert.equal(a["http.route"], "/api/tracks/:slug");
    assert.equal(a["url.path"], "/api/tracks/docker");
    assert.equal(a["url.scheme"], "http");
    assert.equal(a["http.response.status_code"], "200");
    assert.equal(a["network.protocol.version"], "1.1");
    assert.equal(a["devforge.request_id"], res.headers.get("x-request-id"));
    assert.ok(!("url.query" in a), "the query string is never recorded");
    assert.doesNotMatch(request.raw, /utm|from-a-query/);

    // The access log line carries the same trace id.
    const log = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "request" && l.requestId === res.headers.get("x-request-id"));
    assert.equal(log?.traceId, PARENT_TRACE);
    assert.equal(log?.spanId, span.spanId);
  });

  it("starts a new trace without a traceparent, and names unmatched requests by method only", async () => {
    receiver.requests.length = 0;
    const c = new Client(server.url);
    assert.equal((await c.get("/api/no/such/endpoint/123")).status, 404);
    await tracer.forceFlush();
    const [span] = spansOf(receiver);
    assert.ok(span);
    assert.equal(span.name, "GET");
    assert.equal(span.parentSpanId, undefined);
    assert.notEqual(span.traceId, PARENT_TRACE);
    assert.equal(span.status.code, 0, "4xx leaves a server span's status unset");
    assert.ok(!("http.route" in attrs(span)));
    assert.ok(!("error.type" in attrs(span)));
  });

  it("marks 5xx responses as errors without recording the exception message", async () => {
    receiver.requests.length = 0;
    const c = new Client(server.url);
    assert.equal((await c.get("/api/test/boom")).status, 500);
    await tracer.forceFlush();
    const [span] = spansOf(receiver);
    assert.ok(span);
    assert.equal(span.name, "GET /api/test/boom");
    assert.equal(span.status.code, 2, "STATUS_CODE_ERROR");
    assert.equal(attrs(span)["error.type"], "500");
    assert.doesNotMatch(receiver.requests[0]!.raw, /internal detail/);
    const log = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "unhandled error");
    assert.equal(log?.traceId, span.traceId, "the error log line carries the trace id");
  });

  it("never puts e-mail addresses, passwords, cookies or tokens into spans", async () => {
    receiver.requests.length = 0;
    const c = new Client(server.url);
    const login = await c.post("/api/auth/login", { email: "traced@example.edu", password: STRONG_PASSWORD });
    assert.equal(login.status, 200);
    const cookieValue = c.cookie.split("=")[1] ?? "";
    assert.ok(cookieValue.length > 20);
    assert.equal((await c.get("/api/auth/me", { authorization: "Bearer secret-token-value" })).status, 200);
    assert.equal((await c.get("/api/users/someone@example.edu")).status, 404);
    await tracer.forceFlush();
    const raw = receiver.requests.map((r) => r.raw).join("\n");
    assert.equal(spansOf(receiver).length, 3);
    assert.ok(spansOf(receiver).some((s) => s.name === "POST /api/auth/login"));
    for (const secret of ["traced@example.edu", "someone@example.edu", STRONG_PASSWORD, cookieValue, "secret-token-value", "df_session"]) {
      assert.ok(!raw.includes(secret), `span data must not contain ${secret}`);
    }
  });

  it("exports nothing for an unsampled parent, but still logs its trace id", async () => {
    receiver.requests.length = 0;
    const unsampledTrace = "0af7651916cd43dd8448eb211c80319c";
    const res = await new Client(server.url).get("/api/tracks", { traceparent: `00-${unsampledTrace}-b7ad6b7169203331-00` });
    await tracer.forceFlush();
    assert.equal(spansOf(receiver).length, 0);
    const log = logLines.map((l) => JSON.parse(l)).find((l) => l.msg === "request" && l.requestId === res.headers.get("x-request-id"));
    assert.equal(log?.traceId, unsampledTrace);
  });

  it("reports exporter counters on /metrics", async () => {
    const res = await new Client(server.url).get("/metrics");
    assert.match(res.text, /^devforge_otel_spans_exported_total [1-9]\d*$/m);
    assert.match(res.text, /^devforge_otel_spans_dropped_total 0$/m);
  });
});

describe("export failures", () => {
  it("drop the batch, count it and warn once, while requests keep working", async () => {
    const receiver = await startReceiver();
    receiver.status = 503;
    const warnings: string[] = [];
    const tracer = new Tracer(testConfig(receiver.url), { logger: createLogger("warn", (l) => warnings.push(l)) });
    const server = await startTestServer({}, undefined, { tracer });
    try {
      const c = new Client(server.url);
      for (let i = 0; i < 3; i++) {
        assert.equal((await c.get("/api/health")).status, 200);
        await tracer.forceFlush();
      }
      assert.equal(tracer.stats.dropped, 3);
      assert.equal(tracer.stats.failedExports, 3);
      assert.equal(warnings.length, 1, "rate-limited to one warning per minute");
      assert.match(warnings[0] ?? "", /trace export failed.*HTTP 503/);
      // An unreachable receiver behaves the same way.
      await receiver.close();
      assert.equal((await c.get("/api/health")).status, 200);
      await tracer.forceFlush();
      assert.equal(tracer.stats.dropped, 4);
    } finally {
      await tracer.shutdown();
      await server.close();
    }
  });
  it("bound the queue: spans beyond OTEL_BSP_MAX_QUEUE_SIZE are dropped", async () => {
    const receiver = await startReceiver();
    const tracer = new Tracer(testConfig(receiver.url, { maxQueueSize: 2, maxExportBatchSize: 2 }), { logger: createLogger("error", () => {}) });
    try {
      // Hold the exporter busy so the queue fills.
      const start = (i: number) => tracer.startServerSpan({ method: "GET", path: `/x/${i}`, scheme: "http", httpVersion: "1.1", traceparent: undefined, tracestate: undefined, requestId: String(i) });
      const spans = [0, 1, 2, 3, 4].map(start);
      spans.slice(0, 2).forEach((s) => s.end({ route: "/x/:i", statusCode: 200 })); // fills the batch: export starts
      spans.slice(2).forEach((s) => s.end({ route: "/x/:i", statusCode: 200 }));
      await tracer.forceFlush();
      assert.equal(tracer.stats.exported + tracer.stats.dropped, 5);
      assert.ok(tracer.stats.dropped >= 1);
    } finally {
      await tracer.shutdown();
      await receiver.close();
    }
  });
});

// A real OpenTelemetry Collector accepts DevForge's OTLP/JSON and decodes the span (debug exporter output).
const COLLECTOR_IMAGE = "otel/opentelemetry-collector:0.165.0@sha256:34b24b740c3c88d3467740e8642a397c13898ef76d7295c5425164c482ed1b73"; // published 2026-11-07
const COLLECTOR_CONFIG = `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
`;

describe("OpenTelemetry Collector", { skip: dockerTestingEnabled() ? false : "needs DEVFORGE_DOCKER_TEST=1 and a Docker engine" }, () => {
  it("accepts and decodes DevForge's spans", async () => {
    const name = `devforge-test-otelcol-${process.pid}`;
    const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 180_000 });
    try {
      const run = spawnSync(
        "docker",
        ["run", "-d", "--name", name, "-p", "127.0.0.1::4318", "-e", "COLLECTOR_CONFIG", COLLECTOR_IMAGE, "--config=env:COLLECTOR_CONFIG"],
        { encoding: "utf8", timeout: 300_000, env: { ...process.env, COLLECTOR_CONFIG } },
      );
      assert.equal(run.status, 0, run.stderr);
      const port = /:(\d+)\s*$/m.exec(docker("port", name, "4318/tcp").stdout)?.[1];
      assert.ok(port, "collector port");
      for (let i = 0; i < 60 && !docker("logs", name).stderr.includes("Everything is ready"); i++) await new Promise((r) => setTimeout(r, 500));

      const tracer = new Tracer(testConfig(`http://127.0.0.1:${port}`), { logger: createLogger("error", () => {}) });
      const server = await startTestServer({}, undefined, { tracer });
      try {
        const res = await new Client(server.url).get("/api/tracks/redis", { traceparent: `00-${PARENT_TRACE}-${PARENT_SPAN}-01` });
        assert.equal(res.status, 200);
        await tracer.forceFlush();
        assert.equal(tracer.stats.exported, 1, `dropped ${tracer.stats.dropped}`);
      } finally {
        await tracer.shutdown();
        await server.close();
      }
      let logs = "";
      for (let i = 0; i < 20; i++) {
        logs = docker("logs", name).stderr + docker("logs", name).stdout;
        if (logs.includes("GET /api/tracks/:slug")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.match(logs, /Trace ID\s*: 4bf92f3577b34da6a3ce929d0e0e4736/);
      assert.match(logs, /Parent ID\s*: 00f067aa0ba902b7/);
      assert.match(logs, /Name\s*: GET \/api\/tracks\/:slug/);
      assert.match(logs, /Kind\s*: Server/);
      assert.match(logs, /http\.route: Str\(\/api\/tracks\/:slug\)/);
      assert.match(logs, /http\.response\.status_code: Int\(200\)/);
      assert.match(logs, /service\.name: Str\(devforge-test\)/);
    } finally {
      docker("rm", "-f", "-v", name);
    }
  });
});
