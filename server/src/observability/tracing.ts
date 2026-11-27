/**
 * OpenTelemetry tracing for DevForge's own HTTP requests, without the OpenTelemetry SDK (ADR 0009).
 *
 * - Off unless OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) is set.
 * - One SERVER span per request, named "{method} {route template}" (never the raw path), with the HTTP
 *   semantic-convention attributes (semantic conventions 1.45.0, HTTP spans page).
 * - An incoming W3C `traceparent` header is honoured: the span joins the caller's trace.
 * - Spans are exported in batches as OTLP/HTTP JSON (OTLP 1.11.1) to <endpoint>/v1/traces.
 *
 * Privacy: spans never carry request or response bodies, headers (so no cookies or tokens), the query
 * string, the client's IP address or user agent; path segments that look like e-mail addresses are
 * replaced. Export is best effort: a failed export drops its spans, counts them and logs (rate-limited).
 */
import { randomBytes } from "node:crypto";
import type { Logger } from "./logger.ts";

// ---------------------------------------------------------------------------------------------------------
// Configuration (standard OpenTelemetry environment variables)

export type SamplerName =
  | "always_on"
  | "always_off"
  | "traceidratio"
  | "parentbased_always_on"
  | "parentbased_always_off"
  | "parentbased_traceidratio";

export interface TracingConfig {
  /** Full URL spans are POSTed to (…/v1/traces). */
  tracesUrl: string;
  /** Extra request headers for the exporter, e.g. an API key for a hosted backend. Never logged. */
  headers: Record<string, string>;
  serviceName: string;
  resourceAttributes: Record<string, string>;
  sampler: SamplerName;
  /** Probability for the *traceidratio samplers, 0–1. */
  samplerRatio: number;
  /** Per-export timeout (OTEL_EXPORTER_OTLP_TIMEOUT, default 10 s). */
  timeoutMs: number;
  /** Batch delay (OTEL_BSP_SCHEDULE_DELAY, default 5 s). */
  scheduleDelayMs: number;
  /** Spans kept in memory while waiting for export (OTEL_BSP_MAX_QUEUE_SIZE, default 2048); more are dropped. */
  maxQueueSize: number;
  /** Spans per export request (OTEL_BSP_MAX_EXPORT_BATCH_SIZE, default 512). */
  maxExportBatchSize: number;
}

const SAMPLERS: readonly SamplerName[] = [
  "always_on",
  "always_off",
  "traceidratio",
  "parentbased_always_on",
  "parentbased_always_off",
  "parentbased_traceidratio",
];

/** key1=value1,key2=value2 with percent-encoded values (OTEL_EXPORTER_OTLP_HEADERS, OTEL_RESOURCE_ATTRIBUTES). */
function parseKeyValueList(raw: string | undefined, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) throw new Error(`${name}: expected key=value pairs separated by commas`);
    try {
      out[decodeURIComponent(part.slice(0, eq).trim())] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      throw new Error(`${name}: invalid percent-encoding`);
    }
  }
  return out;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/**
 * Tracing settings from the environment, or undefined when tracing is off. Throws a readable error for
 * invalid values, which stops start-up like every other configuration error.
 */
export function tracingConfigFromEnv(env: NodeJS.ProcessEnv): TracingConfig | undefined {
  if ((env.OTEL_SDK_DISABLED ?? "").toLowerCase() === "true") return undefined;
  const signalUrl = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const baseUrl = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!signalUrl && !baseUrl) return undefined;
  // The signal-specific variable is used as is; /v1/traces is appended only to the base endpoint.
  const tracesUrl = signalUrl || `${(baseUrl ?? "").replace(/\/+$/, "")}/v1/traces`;
  let parsed: URL;
  try {
    parsed = new URL(tracesUrl);
  } catch {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT must be a URL such as http://localhost:4318");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT must use http:// or https://");
  }
  const protocol = (env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "").trim();
  if (protocol && protocol !== "http/json") {
    throw new Error(`OTEL_EXPORTER_OTLP_PROTOCOL=${protocol} is not supported: DevForge exports OTLP/HTTP with JSON (http/json) only (ADR 0009)`);
  }
  const sampler = (env.OTEL_TRACES_SAMPLER?.trim() || "parentbased_always_on") as SamplerName;
  if (!SAMPLERS.includes(sampler)) throw new Error(`OTEL_TRACES_SAMPLER must be one of ${SAMPLERS.join(", ")}`);
  let samplerRatio = 1;
  if (sampler.endsWith("traceidratio") && env.OTEL_TRACES_SAMPLER_ARG?.trim()) {
    samplerRatio = Number(env.OTEL_TRACES_SAMPLER_ARG);
    if (!(samplerRatio >= 0 && samplerRatio <= 1)) throw new Error("OTEL_TRACES_SAMPLER_ARG must be a number from 0 to 1");
  }
  const resourceAttributes = parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES, "OTEL_RESOURCE_ATTRIBUTES");
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || resourceAttributes["service.name"] || "devforge";
  const maxQueueSize = positiveInt(env.OTEL_BSP_MAX_QUEUE_SIZE, 2048, "OTEL_BSP_MAX_QUEUE_SIZE");
  return {
    tracesUrl,
    headers: {
      ...parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS, "OTEL_EXPORTER_OTLP_HEADERS"),
      ...parseKeyValueList(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS, "OTEL_EXPORTER_OTLP_TRACES_HEADERS"),
    },
    serviceName,
    resourceAttributes,
    sampler,
    samplerRatio,
    timeoutMs: positiveInt(env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT ?? env.OTEL_EXPORTER_OTLP_TIMEOUT, 10_000, "OTEL_EXPORTER_OTLP_TIMEOUT"),
    scheduleDelayMs: positiveInt(env.OTEL_BSP_SCHEDULE_DELAY, 5_000, "OTEL_BSP_SCHEDULE_DELAY"),
    maxQueueSize,
    maxExportBatchSize: Math.min(maxQueueSize, positiveInt(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE, 512, "OTEL_BSP_MAX_EXPORT_BATCH_SIZE")),
  };
}

// ---------------------------------------------------------------------------------------------------------
// W3C Trace Context (https://www.w3.org/TR/trace-context/)

export interface ParentContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
  traceState?: string;
}

const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

/** Parse a traceparent header; undefined when absent or invalid (then a new trace starts). */
export function parseTraceparent(header: string | string[] | undefined, tracestate?: string | string[]): ParentContext | undefined {
  // Several traceparent headers are invalid by the specification.
  if (typeof header !== "string") return undefined;
  const value = header.trim();
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/.exec(value);
  if (!m) return undefined;
  const [, version, traceId, spanId, flags, rest] = m as unknown as [string, string, string, string, string, string | undefined];
  if (version === "ff" || traceId === ZERO_TRACE || spanId === ZERO_SPAN) return undefined;
  // Version 00 has exactly four fields; a later version may add fields after a dash.
  if (version === "00" && rest !== undefined) return undefined;
  const state = Array.isArray(tracestate) ? tracestate.join(",") : tracestate;
  // tracestate is carried, not interpreted; keep it only if it is plausibly valid (≤ 512 chars, printable).
  const traceState = state && state.length <= 512 && /^[\x20-\x7e]+$/.test(state) ? state.trim() : undefined;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1, ...(traceState ? { traceState } : {}) };
}

function randomId(bytes: number): string {
  for (;;) {
    const id = randomBytes(bytes).toString("hex");
    if (!/^0+$/.test(id)) return id;
  }
}

/** Sampling decision for a new span; the trace id's lowest 56 bits stand for a uniform random number. */
export function shouldSample(sampler: SamplerName, ratio: number, traceId: string, parent: ParentContext | undefined): boolean {
  if (sampler.startsWith("parentbased_") && parent) return parent.sampled;
  const root = sampler.replace(/^parentbased_/, "");
  if (root === "always_on") return true;
  if (root === "always_off") return false;
  if (ratio >= 1) return true;
  if (ratio <= 0) return false;
  return Number.parseInt(traceId.slice(-14), 16) < ratio * 2 ** 56;
}

// ---------------------------------------------------------------------------------------------------------
// Spans

/** Methods known to the HTTP semantic conventions; anything else is reported as _OTHER. */
const KNOWN_METHODS = new Set(["CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"]);
const MAX_PATH_LENGTH = 1024;

/** url.path without anything personal: segments that look like e-mail addresses are replaced. */
export function scrubPath(path: string): string {
  const scrubbed = path
    .split("/")
    .map((segment) => (/@|%40/i.test(segment) ? "REDACTED" : segment))
    .join("/");
  return scrubbed.length > MAX_PATH_LENGTH ? `${scrubbed.slice(0, MAX_PATH_LENGTH)}…` : scrubbed;
}

type AttributeValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
interface OtlpAttribute {
  key: string;
  value: AttributeValue;
}
const str = (key: string, value: string): OtlpAttribute => ({ key, value: { stringValue: value } });
const int = (key: string, value: number): OtlpAttribute => ({ key, value: { intValue: String(Math.trunc(value)) } });

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceState?: string;
  flags: number;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number };
}

const SPAN_KIND_SERVER = 2;
const STATUS_UNSET = 0;
const STATUS_ERROR = 2;

/** What app.ts knows when a request starts. */
export interface ServerSpanStart {
  method: string;
  path: string;
  scheme: "http" | "https";
  httpVersion: string;
  traceparent: string | string[] | undefined;
  tracestate: string | string[] | undefined;
  requestId: string;
}

export interface ServerSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
  /** Finish the span. `route` is the matched route template, or undefined when no route matched. */
  end(result: { route: string | undefined; statusCode: number }): void;
}

/** Wall-clock nanoseconds with sub-millisecond resolution (process.hrtime anchored to Date.now once). */
const epochOffsetNs = BigInt(Date.now()) * 1_000_000n - process.hrtime.bigint();
const nowNs = (): bigint => epochOffsetNs + process.hrtime.bigint();

export interface TracerStats {
  exported: number;
  dropped: number;
  failedExports: number;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export class Tracer {
  readonly config: TracingConfig;
  readonly stats: TracerStats = { exported: 0, dropped: 0, failedExports: 0 };
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;
  private readonly queue: OtlpSpan[] = [];
  private readonly timer: NodeJS.Timeout;
  private readonly resource: { attributes: OtlpAttribute[] };
  private exporting: Promise<void> = Promise.resolve();
  private lastWarnAt = 0;
  private closed = false;

  constructor(config: TracingConfig, options: { logger: Logger; fetch?: FetchLike }) {
    this.config = config;
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? (fetch as unknown as FetchLike);
    this.resource = {
      attributes: [
        ...Object.entries(config.resourceAttributes)
          .filter(([k]) => k !== "service.name")
          .map(([k, v]) => str(k, v)),
        str("service.name", config.serviceName),
        str("telemetry.sdk.name", "devforge-builtin"),
        str("telemetry.sdk.language", "nodejs"),
        str("telemetry.sdk.version", "1"),
      ],
    };
    this.timer = setInterval(() => void this.forceFlush(), config.scheduleDelayMs);
    this.timer.unref();
  }

  startServerSpan(input: ServerSpanStart): ServerSpan {
    const parent = parseTraceparent(input.traceparent, input.tracestate);
    const traceId = parent?.traceId ?? randomId(16);
    const spanId = randomId(8);
    const sampled = shouldSample(this.config.sampler, this.config.samplerRatio, traceId, parent);
    const start = nowNs();
    const method = KNOWN_METHODS.has(input.method) ? input.method : "_OTHER";
    let ended = false;
    return {
      traceId,
      spanId,
      sampled,
      end: ({ route, statusCode }) => {
        if (ended) return;
        ended = true;
        if (!sampled || this.closed) return;
        const base = method === "_OTHER" ? "HTTP" : method;
        const attributes: OtlpAttribute[] = [
          str("http.request.method", method),
          ...(method === "_OTHER" ? [str("http.request.method_original", input.method.slice(0, 32))] : []),
          str("url.path", scrubPath(input.path)),
          str("url.scheme", input.scheme),
          ...(route ? [str("http.route", route)] : []),
          int("http.response.status_code", statusCode),
          str("network.protocol.version", input.httpVersion),
          ...(statusCode >= 500 ? [str("error.type", String(statusCode))] : []),
          str("devforge.request_id", input.requestId),
        ];
        this.enqueue({
          traceId,
          spanId,
          ...(parent ? { parentSpanId: parent.spanId } : {}),
          ...(parent?.traceState ? { traceState: parent.traceState } : {}),
          // Bit 0: sampled. Bits 8 and 9 (OTLP SpanFlags): "is the parent remote" is known, and it is.
          flags: 0x01 | (parent ? 0x300 : 0),
          name: route ? `${base} ${route}` : base,
          kind: SPAN_KIND_SERVER,
          startTimeUnixNano: start.toString(),
          endTimeUnixNano: nowNs().toString(),
          attributes,
          // Server spans: 4xx is the client's problem and leaves the status unset; 5xx is an error.
          status: { code: statusCode >= 500 ? STATUS_ERROR : STATUS_UNSET },
        });
      },
    };
  }

  private enqueue(span: OtlpSpan): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      this.stats.dropped += 1;
      this.warn("trace queue full; span dropped", { maxQueueSize: this.config.maxQueueSize });
      return;
    }
    this.queue.push(span);
    if (this.queue.length >= this.config.maxExportBatchSize) void this.forceFlush();
  }

  /** Export everything queued so far; resolves when done (never rejects). */
  forceFlush(): Promise<void> {
    this.exporting = this.exporting.then(async () => {
      while (this.queue.length > 0) await this.exportBatch(this.queue.splice(0, this.config.maxExportBatchSize));
    });
    return this.exporting;
  }

  /** Flush and stop; later spans are discarded. */
  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.forceFlush();
    this.closed = true;
  }

  private async exportBatch(spans: OtlpSpan[]): Promise<void> {
    const body = JSON.stringify({
      resourceSpans: [{ resource: this.resource, scopeSpans: [{ scope: { name: "devforge.http", version: "1" }, spans }] }],
    });
    try {
      const res = await this.fetchImpl(this.config.tracesUrl, {
        method: "POST",
        headers: { ...this.config.headers, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`the receiver answered HTTP ${res.status}`);
      // HTTP 200 with partialSuccess.rejectedSpans: some spans were refused (and must not be retried).
      let rejected = 0;
      try {
        rejected = Number((JSON.parse(text || "{}") as { partialSuccess?: { rejectedSpans?: string | number } }).partialSuccess?.rejectedSpans ?? 0) || 0;
      } catch {
        rejected = 0;
      }
      this.stats.exported += spans.length - rejected;
      if (rejected > 0) {
        this.stats.dropped += rejected;
        this.warn("trace receiver rejected spans", { rejected });
      }
    } catch (err) {
      this.stats.dropped += spans.length;
      this.stats.failedExports += 1;
      // Log the receiver's origin only: the full URL could carry credentials.
      // fetch() reports "fetch failed" and keeps the useful part (ECONNREFUSED, a DNS error…) in err.cause.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const reason = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
      this.warn("trace export failed; spans dropped", { receiver: new URL(this.config.tracesUrl).origin, spans: spans.length, reason });
    }
  }

  /** At most one warning per minute, so an unreachable receiver cannot flood the logs. */
  private warn(msg: string, fields: Record<string, unknown>): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn(msg, fields);
  }

  /** Prometheus lines for /metrics. */
  metricLines(): string[] {
    return [
      "# HELP devforge_otel_spans_exported_total Spans accepted by the OTLP receiver.",
      "# TYPE devforge_otel_spans_exported_total counter",
      `devforge_otel_spans_exported_total ${this.stats.exported}`,
      "# HELP devforge_otel_spans_dropped_total Spans dropped (queue full, export failed or rejected).",
      "# TYPE devforge_otel_spans_dropped_total counter",
      `devforge_otel_spans_dropped_total ${this.stats.dropped}`,
      "# HELP devforge_otel_export_failures_total OTLP export requests that failed.",
      "# TYPE devforge_otel_export_failures_total counter",
      `devforge_otel_export_failures_total ${this.stats.failedExports}`,
    ];
  }
}
