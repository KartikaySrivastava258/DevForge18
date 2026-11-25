/**
 * Simulation: a trace waterfall (REMAINING_WORK.md §5.15).
 *
 * One request, GET /checkout, travels gateway → api → cache, database and
 * payment. Every request produces a trace whose spans have parent IDs, start
 * and end times, exactly the shape the lessons send to a Collector and Jaeger.
 * The learner changes the system (add latency, cache hit or miss, calls in
 * sequence or in parallel), sends requests and reads the waterfall: which span
 * is slow, and which spans decide the total (the critical path).
 *
 * Simplified (shown to learners): durations are fixed numbers, not
 * measurements; the network adds a fixed 2 ms each way between services; the
 * cache and database are not instrumented themselves, so they appear only as
 * the API's client spans — as uninstrumented databases do in real traces.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const SERVICES = ["gateway", "api", "cache", "database", "payment"] as const;
export type Service = (typeof SERVICES)[number];
export const LATENCIES = [0, 50, 100, 300] as const;
export type Latency = (typeof LATENCIES)[number];

export interface Span {
  spanId: string;
  parentId: string | null;
  service: Service;
  name: string;
  kind: "Server" | "Client";
  /** Milliseconds from the start of the trace. */
  start: number;
  end: number;
}

export interface Trace {
  traceId: string;
  spans: Span[];
}

export interface WaterfallState {
  cacheHit: boolean;
  parallel: boolean;
  extra: Record<Service, number>;
  requests: number;
  /** Most recent last; only the last few are kept. */
  traces: Trace[];
  selected: string | null;
}

export type WaterfallAction =
  | { type: "send" }
  | { type: "setCache"; hit: boolean }
  | { type: "setParallel"; parallel: boolean }
  | { type: "setLatency"; service: Service; ms: Latency }
  | { type: "select"; spanId: string };

export interface WaterfallScenario {
  cacheHit: boolean;
  parallel: boolean;
  extra: Partial<Record<Service, Latency>>;
  /** Requests already sent when the scenario starts. */
  sent: number;
}

/** Base work in milliseconds. */
const BASE = { gatewayBefore: 3, gatewayAfter: 1, apiBefore: 8, apiAfter: 2, cache: 2, database: 25, payment: 60 } as const;
const NET = 2; // each way between services
const KEEP = 3;

function hex(seed: string, length: number): string {
  let out = "";
  let h = 0x811c9dc5;
  for (let round = 0; out.length < length; round++) {
    for (const ch of `${seed}#${round}`) {
      h ^= ch.codePointAt(0) ?? 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

/** Build the trace for request number n under the current configuration. */
export function buildTrace(s: Pick<WaterfallState, "cacheHit" | "parallel" | "extra">, n: number): Trace {
  const traceId = hex(`trace-${n}`, 32);
  let k = 0;
  const id = () => hex(`${traceId}-${k++}`, 16);
  const spans: Span[] = [];
  const add = (span: Omit<Span, "spanId">) => {
    const full = { ...span, spanId: id() };
    spans.push(full);
    return full;
  };
  const x = s.extra;
  const gateway = add({ parentId: null, service: "gateway", name: "GET /checkout", kind: "Server", start: 0, end: 0 });
  const gwCall = add({ parentId: gateway.spanId, service: "gateway", name: "GET /api/checkout", kind: "Client", start: BASE.gatewayBefore + x.gateway, end: 0 });
  const api = add({ parentId: gwCall.spanId, service: "api", name: "GET /api/checkout", kind: "Server", start: gwCall.start + NET, end: 0 });
  let t = api.start + BASE.apiBefore + x.api;
  const cache = add({ parentId: api.spanId, service: "api", name: "GET cart (cache)", kind: "Client", start: t, end: t + BASE.cache + x.cache });
  t = cache.end;
  const calls: { service: Service; dur: number; name: string }[] = [];
  if (!s.cacheHit) calls.push({ service: "database", dur: BASE.database + x.database, name: "SELECT cart (database)" });
  calls.push({ service: "payment", dur: BASE.payment + x.payment + 2 * NET, name: "POST /authorize (payment)" });
  let end = t;
  for (const c of calls) {
    const start = s.parallel ? t : end;
    // Calls made by the API are the API's client spans; only payment, a service of its own, adds a server span.
    const span = add({ parentId: api.spanId, service: "api", name: c.name, kind: "Client", start, end: start + c.dur });
    if (c.service === "payment") add({ parentId: span.spanId, service: "payment", name: "POST /authorize", kind: "Server", start: start + NET, end: start + c.dur - NET });
    end = Math.max(end, span.end);
  }
  api.end = end + BASE.apiAfter;
  gwCall.end = api.end + NET;
  gateway.end = gwCall.end + BASE.gatewayAfter;
  return { traceId, spans };
}

export const duration = (t: Trace) => Math.max(...t.spans.map((s) => s.end)) - Math.min(...t.spans.map((s) => s.start));
export const children = (t: Trace, parent: string) => t.spans.filter((s) => s.parentId === parent);

/** Time a span spends in its own work: its duration minus the time covered by its children. */
export function selfTime(t: Trace, span: Span): number {
  const kids = children(t, span.spanId).map((c) => [Math.max(c.start, span.start), Math.min(c.end, span.end)] as const).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cursor = span.start;
  for (const [a, b] of kids) {
    if (b <= cursor) continue;
    covered += b - Math.max(a, cursor);
    cursor = b;
  }
  return span.end - span.start - covered;
}

/** The spans that decide the total: from the root, always follow the child that finishes last. */
export function criticalPath(t: Trace): string[] {
  const root = t.spans.find((s) => s.parentId === null);
  const path: string[] = [];
  let current = root;
  while (current) {
    path.push(current.spanId);
    const kids = children(t, current.spanId);
    current = kids.length ? kids.reduce((a, b) => (b.end > a.end ? b : a)) : undefined;
  }
  return path;
}

export const latest = (s: WaterfallState) => s.traces.at(-1);
const slowest = (t: Trace) => t.spans.reduce((a, b) => (selfTime(t, b) > selfTime(t, a) ? b : a));

function send(s: WaterfallState): StepResult<WaterfallState> {
  const trace = buildTrace(s, s.requests + 1);
  const path = criticalPath(trace).map((id) => trace.spans.find((x) => x.spanId === id));
  return {
    state: { ...s, requests: s.requests + 1, traces: [...s.traces, trace].slice(-KEEP), selected: null },
    events: [
      `Request ${s.requests + 1}: trace ${trace.traceId.slice(0, 8)}… took ${duration(trace)} ms in ${trace.spans.length} spans.`,
      `Critical path: ${path.map((p) => `${p?.service} ${p?.kind === "Client" ? "→ " : ""}${p?.name}`).join(", then ")}.`,
    ],
  };
}

const refuse = (state: WaterfallState, error: string): StepResult<WaterfallState> => ({ state, events: [], error });

function step(s: WaterfallState, a: WaterfallAction): StepResult<WaterfallState> {
  switch (a.type) {
    case "send":
      return send(s);
    case "setCache":
      if (a.hit === s.cacheHit) return refuse(s, `The cache already ${a.hit ? "hits" : "misses"}.`);
      return { state: { ...s, cacheHit: a.hit }, events: [a.hit ? "The cart is now in the cache: the API will skip the database. Send a request to see it." : "The cache now misses: the API must query the database too."] };
    case "setParallel":
      if (a.parallel === s.parallel) return refuse(s, `The calls are already ${a.parallel ? "parallel" : "sequential"}.`);
      return { state: { ...s, parallel: a.parallel }, events: [a.parallel ? "The API now calls the database and payment at the same time." : "The API now waits for the database before calling payment."] };
    case "setLatency": {
      if (s.extra[a.service] === a.ms) return refuse(s, `${a.service} already has ${a.ms} ms of extra latency.`);
      return { state: { ...s, extra: { ...s.extra, [a.service]: a.ms } }, events: [`${a.service} now adds ${a.ms} ms of extra work to every request.`] };
    }
    case "select": {
      const t = latest(s);
      const span = t?.spans.find((x) => x.spanId === a.spanId);
      if (!t || !span) return refuse(s, "That span is not in the latest trace.");
      return { state: { ...s, selected: a.spanId }, events: [`Selected ${span.service} ${span.kind} span "${span.name}": ${span.end - span.start} ms in total, ${selfTime(t, span)} ms of its own work.`] };
    }
  }
}

function init(p: WaterfallScenario): StepResult<WaterfallState> {
  let s: WaterfallState = {
    cacheHit: p.cacheHit,
    parallel: p.parallel,
    extra: Object.fromEntries(SERVICES.map((sv) => [sv, p.extra[sv] ?? 0])) as Record<Service, number>,
    requests: 0,
    traces: [],
    selected: null,
  };
  for (let i = 0; i < p.sent; i++) s = send(s).state;
  const t = latest(s);
  return { state: s, events: [t ? `Scenario ready: the last checkout took ${duration(t)} ms.` : "Scenario ready: send a request to see its trace."] };
}

function describe(s: WaterfallState): string[] {
  const lines = [`Cache ${s.cacheHit ? "hit" : "miss"}; database and payment called ${s.parallel ? "in parallel" : "one after the other"}. Extra latency: ${SERVICES.filter((sv) => s.extra[sv]).map((sv) => `${sv} +${s.extra[sv]} ms`).join(", ") || "none"}.`];
  const t = latest(s);
  if (!t) return [...lines, "No request has been sent yet."];
  const path = new Set(criticalPath(t));
  lines.push(`Latest trace ${t.traceId}: ${duration(t)} ms.`);
  const depth = (span: Span): number => (span.parentId ? 1 + depth(t.spans.find((x) => x.spanId === span.parentId)!) : 0);
  for (const span of t.spans) {
    lines.push(`${"  ".repeat(depth(span))}${span.service} ${span.kind} "${span.name}": ${span.start}–${span.end} ms (${span.end - span.start} ms, ${selfTime(t, span)} ms own work)${path.has(span.spanId) ? ", on the critical path" : ""}${s.selected === span.spanId ? ", selected" : ""}.`);
  }
  return lines;
}

export const traceWaterfall: SimulationModel<WaterfallState, WaterfallAction, WaterfallScenario> = {
  id: "opentelemetry-trace-waterfall",
  track: "opentelemetry",
  init,
  step,
  invariants: [
    {
      name: "every span ends after it starts, and only the root has no parent",
      check: (s) => {
        for (const t of s.traces) {
          if (t.spans.some((x) => x.end < x.start)) return `trace ${t.traceId} has a span that ends before it starts`;
          if (t.spans.filter((x) => x.parentId === null).length !== 1) return `trace ${t.traceId} does not have exactly one root`;
        }
        return null;
      },
    },
    {
      name: "children start and end within their parent",
      check: (s) => {
        for (const t of s.traces) {
          for (const c of t.spans) {
            const p = t.spans.find((x) => x.spanId === c.parentId);
            if (c.parentId && !p) return `span ${c.spanId} has a missing parent`;
            if (p && (c.start < p.start || c.end > p.end)) return `span ${c.name} is outside its parent ${p.name}`;
          }
        }
        return null;
      },
    },
    {
      name: "every span in a trace has a unique ID of the right length",
      check: (s) => {
        for (const t of s.traces) {
          const ids = new Set(t.spans.map((x) => x.spanId));
          if (ids.size !== t.spans.length || t.spans.some((x) => x.spanId.length !== 16) || t.traceId.length !== 32) return `trace ${t.traceId} has bad IDs`;
        }
        return null;
      },
    },
  ],
  checks: {
    /** The selected span is the one with the most time of its own in the latest trace. */
    "find-the-slow-span": (s) => {
      const t = latest(s);
      return Boolean(t && s.selected && s.selected === slowest(t).spanId);
    },
    /** The latest checkout took less than 150 ms, by changing the design, not the database's latency. */
    "checkout-under-150ms": (s, initial) => {
      const t = latest(s);
      return Boolean(t && duration(t) < 150 && s.extra.database === initial.extra.database);
    },
  },
  describe,
};
