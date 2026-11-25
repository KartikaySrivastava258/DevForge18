/**
 * Simulation: scraping, rate() and histogram_quantile() (REMAINING_WORK.md §5.7).
 *
 * Two DevForge instances count requests and request latency. Prometheus
 * scrapes both every `interval` seconds and keeps the samples; the learner
 * builds a query and sees what Prometheus would answer at the current time.
 *
 * Follows the Prometheus documentation: rate() is the per-second average
 * increase over the range and adjusts for counter resets (a drop is treated
 * as a restart from zero); it needs at least two samples in the range; take
 * rate() first, then aggregate; histogram_quantile() interpolates linearly
 * within the bucket that contains the requested rank and needs the le label.
 *
 * Simplified (shown to learners): real rate() also extrapolates to the edges
 * of the range, so its results are slightly higher than this model's; time
 * moves in whole seconds; scrapes never fail; latency follows a fixed pattern.
 */
import type { SimulationModel, StepResult } from "../types.ts";

/** Latency bucket upper bounds in seconds (le), as DevForge uses, cut short for the model; the last is +Inf. */
export const BOUNDS = [0.005, 0.01, 0.025, 0.05, 0.1, Infinity] as const;
/** Each instance serves requests whose latency bucket repeats this pattern (index into BOUNDS). */
const PATTERNS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 3],
  [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4],
] as const;

export const INTERVALS = [5, 15, 30, 60] as const;
export const WINDOWS = [30, 60, 300] as const;
export const QUERIES = ["raw", "rate", "sum-rate", "rate-sum", "p95"] as const;
export const P95_BY = ["le", "instance-le", "none"] as const;
export type Interval = (typeof INTERVALS)[number];
export type Window = (typeof WINDOWS)[number];
export type QueryKind = (typeof QUERIES)[number];
export type P95By = (typeof P95_BY)[number];

export interface Sample {
  t: number;
  total: number;
  /** Cumulative bucket counts, one per BOUNDS entry. */
  buckets: number[];
}

export interface Instance {
  name: string;
  /** Requests per second this instance is receiving. */
  rps: number;
  total: number;
  buckets: number[];
  /** Requests served since start (drives the latency pattern). */
  served: number;
  restarts: number;
  lastRestart: number | null;
  samples: Sample[];
}

export interface PromState {
  t: number;
  interval: Interval;
  window: Window;
  query: QueryKind;
  p95By: P95By;
  instances: Instance[];
}

export type PromAction =
  | { type: "tick"; count?: number | undefined }
  | { type: "setTraffic"; instance: number; rps: number }
  | { type: "restart"; instance: number }
  | { type: "setInterval"; seconds: Interval }
  | { type: "setWindow"; seconds: Window }
  | { type: "setQuery"; query: QueryKind; p95By?: P95By | undefined };

export interface PromScenario {
  interval: Interval;
  window: Window;
  rps: [number, number];
  query: QueryKind;
  p95By: P95By;
  /** Seconds of history to build before the learner starts. */
  warmup: number;
}

/** How long samples are kept: enough for the largest window. */
const RETENTION = 320;
const windowLabel = (w: Window) => (w === 300 ? "5m" : w === 60 ? "1m" : "30s");

/** The PromQL the current query corresponds to (shown in the UI). */
export function promql(state: Pick<PromState, "query" | "window" | "interval" | "p95By">): string {
  const w = windowLabel(state.window);
  switch (state.query) {
    case "raw":
      return "devforge_http_requests_total";
    case "rate":
      return `rate(devforge_http_requests_total[${w}])`;
    case "sum-rate":
      return `sum(rate(devforge_http_requests_total[${w}]))`;
    case "rate-sum":
      return `rate(sum(devforge_http_requests_total)[${w}:${state.interval}s])`;
    case "p95": {
      const by = state.p95By === "le" ? "sum by (le) " : state.p95By === "instance-le" ? "sum by (instance, le) " : "sum ";
      return `histogram_quantile(0.95, ${by}(rate(devforge_http_request_duration_seconds_bucket[${w}])))`;
    }
  }
}

/** Per-second average increase over the samples, treating any drop as a counter reset. Null with fewer than 2 samples. */
export function rateOf(points: { t: number; v: number }[]): number | null {
  if (points.length < 2) return null;
  let increase = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.v;
    const cur = points[i]!.v;
    increase += cur >= prev ? cur - prev : cur; // a drop means the counter restarted from zero
  }
  return increase / (points.at(-1)!.t - points[0]!.t);
}

/** histogram_quantile with linear interpolation inside the bucket that holds the rank. */
export function quantile(q: number, cumulative: number[]): number | null {
  const total = cumulative.at(-1) ?? 0;
  if (total <= 0) return null;
  const rank = q * total;
  const i = cumulative.findIndex((c) => c >= rank);
  if (i < 0) return null;
  if (BOUNDS[i] === Infinity) return BOUNDS[i - 1] ?? null; // rank in the +Inf bucket: the highest finite bound
  const lower = i === 0 ? 0 : (BOUNDS[i - 1] ?? 0);
  const below = i === 0 ? 0 : (cumulative[i - 1] ?? 0);
  const inBucket = (cumulative[i] ?? 0) - below;
  return lower + ((BOUNDS[i] ?? 0) - lower) * (inBucket === 0 ? 1 : (rank - below) / inBucket);
}

export type QueryResult =
  | { kind: "series"; series: { labels: string; value: number }[] }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

const inWindow = (s: PromState, inst: Instance) => inst.samples.filter((p) => p.t > s.t - s.window && p.t <= s.t);
const fmt = (n: number) => Number(n.toFixed(4));

/** What Prometheus would answer for the current query at the current time. */
export function evaluate(s: PromState): QueryResult {
  const label = (i: Instance) => `{instance="${i.name}"}`;
  switch (s.query) {
    case "raw": {
      const series = s.instances.flatMap((i) => (i.samples.length ? [{ labels: label(i), value: i.samples.at(-1)!.total }] : []));
      return series.length ? { kind: "series", series } : { kind: "empty", reason: "Nothing has been scraped yet." };
    }
    case "rate":
    case "sum-rate": {
      const rates = s.instances.map((i) => ({ i, r: rateOf(inWindow(s, i).map((p) => ({ t: p.t, v: p.total }))) }));
      const ok = rates.filter((x) => x.r !== null);
      if (!ok.length) return { kind: "empty", reason: `Fewer than two samples in the last ${windowLabel(s.window)} for every series: with a ${s.interval}s scrape interval, rate() has nothing to compare.` };
      if (s.query === "rate") return { kind: "series", series: ok.map((x) => ({ labels: label(x.i), value: fmt(x.r!) })) };
      return { kind: "series", series: [{ labels: "{}", value: fmt(ok.reduce((n, x) => n + x.r!, 0)) }] };
    }
    case "rate-sum": {
      // The subquery evaluates sum(...) at each scrape time, then rate() runs over that one summed series.
      const times = [...new Set(s.instances.flatMap((i) => inWindow(s, i).map((p) => p.t)))].sort((a, b) => a - b);
      const points = times.map((t) => ({ t, v: s.instances.reduce((n, i) => n + (i.samples.find((p) => p.t === t)?.total ?? 0), 0) }));
      const r = rateOf(points);
      return r === null ? { kind: "empty", reason: "Fewer than two samples in the window." } : { kind: "series", series: [{ labels: "{}", value: fmt(r) }] };
    }
    case "p95": {
      const bucketRates = s.instances.map((i) => {
        const pts = inWindow(s, i);
        return { i, rates: BOUNDS.map((_, b) => rateOf(pts.map((p) => ({ t: p.t, v: p.buckets[b] ?? 0 })))) };
      });
      const usable = bucketRates.filter((x) => x.rates.every((r) => r !== null)) as { i: Instance; rates: number[] }[];
      if (!usable.length) return { kind: "empty", reason: "Fewer than two samples in the window." };
      if (s.p95By === "none") {
        return { kind: "empty", reason: "sum(...) without by (le) removes the le label, so histogram_quantile() cannot tell the buckets apart and returns nothing." };
      }
      if (s.p95By === "instance-le") {
        return { kind: "series", series: usable.map((x) => ({ labels: label(x.i), value: fmt(quantile(0.95, x.rates) ?? NaN) })) };
      }
      const summed = BOUNDS.map((_, b) => usable.reduce((n, x) => n + (x.rates[b] ?? 0), 0));
      const v = quantile(0.95, summed);
      return v === null ? { kind: "empty", reason: "No requests in the window." } : { kind: "series", series: [{ labels: "{}", value: fmt(v) }] };
    }
  }
}

const trueRate = (s: PromState) => s.instances.reduce((n, i) => n + i.rps, 0);

function tickOnce(s: PromState): { state: PromState; events: string[] } {
  const t = s.t + 1;
  const events: string[] = [];
  const instances = s.instances.map((inst, k) => {
    const pattern = PATTERNS[k % PATTERNS.length]!;
    let { total, served } = inst;
    const buckets = [...inst.buckets];
    for (let r = 0; r < inst.rps; r++) {
      const slot = pattern[served % pattern.length]!;
      for (let b = slot; b < BOUNDS.length; b++) buckets[b] = (buckets[b] ?? 0) + 1; // cumulative: every bucket at or above
      total += 1;
      served += 1;
    }
    let samples = inst.samples;
    if (t % s.interval === 0) {
      samples = [...samples, { t, total, buckets: [...buckets] }].filter((p) => p.t > t - RETENTION);
    }
    return { ...inst, total, buckets, served, samples };
  });
  if (t % s.interval === 0) events.push(`t=${t}s: Prometheus scraped both instances (${instances.map((i) => `${i.name} = ${i.total}`).join(", ")}).`);
  return { state: { ...s, t, instances }, events };
}

const refuse = (state: PromState, error: string): StepResult<PromState> => ({ state, events: [], error });

function step(state: PromState, action: PromAction): StepResult<PromState> {
  switch (action.type) {
    case "tick": {
      let s = state;
      const events: string[] = [];
      for (let i = 0; i < (action.count ?? 1); i++) {
        const r = tickOnce(s);
        s = r.state;
        events.push(...r.events);
      }
      return { state: s, events };
    }
    case "setTraffic": {
      const inst = state.instances[action.instance];
      if (!inst) return refuse(state, "There is no such instance.");
      if (inst.rps === action.rps) return refuse(state, `${inst.name} already receives ${action.rps} requests per second.`);
      const instances = state.instances.map((x, k) => (k === action.instance ? { ...x, rps: action.rps } : x));
      return { state: { ...state, instances }, events: [`${inst.name} now receives ${action.rps} requests per second (the true total is ${trueRate({ ...state, instances })}/s).`] };
    }
    case "restart": {
      const inst = state.instances[action.instance];
      if (!inst) return refuse(state, "There is no such instance.");
      const instances = state.instances.map((x, k) =>
        k === action.instance ? { ...x, total: 0, buckets: BOUNDS.map(() => 0), restarts: x.restarts + 1, lastRestart: state.t } : x,
      );
      return { state: { ...state, instances }, events: [`${inst.name} restarted at t=${state.t}s: its counters start again from 0. Earlier samples stay in Prometheus.`] };
    }
    case "setInterval":
      if (action.seconds === state.interval) return refuse(state, `The scrape interval is already ${action.seconds}s.`);
      return { state: { ...state, interval: action.seconds }, events: [`Prometheus now scrapes every ${action.seconds}s.`] };
    case "setWindow":
      if (action.seconds === state.window) return refuse(state, `The range is already ${windowLabel(action.seconds)}.`);
      return { state: { ...state, window: action.seconds }, events: [`The query's range is now [${windowLabel(action.seconds)}].`] };
    case "setQuery": {
      const p95By = action.p95By ?? state.p95By;
      if (action.query === state.query && p95By === state.p95By) return refuse(state, "That query is already selected.");
      const next = { ...state, query: action.query, p95By };
      return { state: next, events: [`Query: ${promql(next)}`] };
    }
  }
}

function init(p: PromScenario): StepResult<PromState> {
  let s: PromState = {
    t: 0,
    interval: p.interval,
    window: p.window,
    query: p.query,
    p95By: p.p95By,
    instances: p.rps.map((rps, k) => ({ name: `devforge-${k + 1}`, rps, total: 0, buckets: BOUNDS.map(() => 0), served: 0, restarts: 0, lastRestart: null, samples: [] })),
  };
  for (let i = 0; i < p.warmup; i++) s = tickOnce(s).state;
  return { state: s, events: [`Scenario ready at t=${s.t}s: scraping every ${s.interval}s. Query: ${promql(s)}`] };
}

function describe(s: PromState): string[] {
  const result = evaluate(s);
  const lines = [
    `Time t=${s.t}s. Prometheus scrapes every ${s.interval}s. True total traffic: ${trueRate(s)} requests per second.`,
    ...s.instances.map((i) => `${i.name}: ${i.rps} requests/s, counter now ${i.total}, ${i.restarts} restart(s); last samples: ${i.samples.slice(-4).map((p) => `${p.total} at ${p.t}s`).join(", ") || "none yet"}.`),
    `Query: ${promql(s)}`,
  ];
  if (result.kind === "series") lines.push(...result.series.map((r) => `Result ${r.labels}: ${r.value}`));
  else lines.push(`Result: no data. ${result.kind === "empty" ? result.reason : result.message}`);
  return lines;
}

const restartedInWindow = (s: PromState) => s.instances.some((i) => i.lastRestart !== null && i.lastRestart > s.t - s.window && i.lastRestart < s.t);

export const scrapeAndRate: SimulationModel<PromState, PromAction, PromScenario> = {
  id: "prometheus-scrape-and-rate",
  track: "prometheus-grafana",
  init,
  step,
  tick: { type: "tick", count: 5 },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : 1),
  invariants: [
    {
      name: "counters and buckets never go negative, and the +Inf bucket equals the total",
      check: (s) => {
        const bad = s.instances.find((i) => i.total < 0 || i.buckets.some((b) => b < 0) || i.buckets.at(-1) !== i.total);
        return bad ? `${bad.name}: total ${bad.total}, +Inf bucket ${bad.buckets.at(-1)}` : null;
      },
    },
    {
      name: "buckets are cumulative (each counts everything in the buckets below it)",
      check: (s) => {
        const bad = s.instances.find((i) => i.buckets.some((b, k) => k > 0 && b < (i.buckets[k - 1] ?? 0)));
        return bad ? `${bad.name} has a bucket smaller than the one below it` : null;
      },
    },
    {
      name: "samples are in time order and only taken on scrape times",
      check: (s) => {
        const bad = s.instances.find((i) => i.samples.some((p, k) => p.t > s.t || (k > 0 && p.t <= (i.samples[k - 1]?.t ?? -1))));
        return bad ? `${bad.name} has samples out of order` : null;
      },
    },
  ],
  checks: {
    /** One correct total rate, even though an instance restarted inside the window. */
    "total-survives-restart": (s) => {
      const r = evaluate(s);
      return s.query === "sum-rate" && restartedInWindow(s) && r.kind === "series" && Math.abs((r.series[0]?.value ?? 0) - trueRate(s)) <= 0.5;
    },
    /** A rate from a 30-second range. */
    "rate-with-short-window": (s) => s.window === 30 && (s.query === "rate" || s.query === "sum-rate") && evaluate(s).kind === "series",
    /** One 95th-percentile latency for the whole service. */
    "p95-for-the-service": (s) => {
      const r = evaluate(s);
      return s.query === "p95" && s.p95By === "le" && r.kind === "series" && r.series.length === 1;
    },
  },
  describe,
};
