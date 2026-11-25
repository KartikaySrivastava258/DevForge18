import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { evaluate, promql, quantile, rateOf, scrapeAndRate as model, type PromAction, type PromScenario, type PromState } from "./scrape-and-rate.ts";

const scenario = (over: Partial<PromScenario> = {}): PromScenario => ({ interval: 5, window: 60, rps: [10, 5], query: "rate", p95By: "le", warmup: 120, ...over });
const tick = (count: number): PromAction => ({ type: "tick", count });
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
const run = (over: Partial<PromScenario>, actions: PromAction[]) => replay(model, scenario(over), actions);
const values = (s: PromState) => {
  const r = evaluate(s);
  return r.kind === "series" ? r.series.map((x) => x.value) : r.kind;
};

describe("scrape-and-rate: the arithmetic", () => {
  it("rate() is the per-second increase, needs two samples, and treats a drop as a restart", () => {
    assert.equal(rateOf([{ t: 0, v: 100 }, { t: 10, v: 150 }]), 5);
    assert.equal(rateOf([{ t: 0, v: 100 }]), null);
    // 100 → 150 (+50), restart to 20 (+20 since the counter started again at 0), → 70 (+50): 120 over 30 s.
    assert.equal(rateOf([{ t: 0, v: 100 }, { t: 10, v: 150 }, { t: 20, v: 20 }, { t: 30, v: 70 }]), 4);
  });
  it("histogram_quantile() interpolates linearly inside the bucket, and caps at the highest finite bound", () => {
    // Cumulative counts for le = 0.005, 0.01, 0.025, 0.05, 0.1, +Inf. Rank 47.5 falls in (0.05, 0.1]: 0.05 + 0.05 × 7.5/10.
    near(quantile(0.95, [10, 20, 30, 40, 50, 50]), 0.0875);
    // The lowest bucket starts at 0.
    near(quantile(0.5, [10, 10, 10, 10, 10, 10]), 0.0025);
    // Rank in the +Inf bucket: Prometheus returns the highest finite bound.
    assert.equal(quantile(0.95, [0, 0, 0, 0, 0, 10]), 0.1);
    assert.equal(quantile(0.95, [0, 0, 0, 0, 0, 0]), null);
  });
  it("shows the PromQL for each query", () => {
    assert.equal(promql({ query: "sum-rate", window: 60, interval: 5, p95By: "le" }), "sum(rate(devforge_http_requests_total[1m]))");
    assert.equal(promql({ query: "rate-sum", window: 300, interval: 15, p95By: "le" }), "rate(sum(devforge_http_requests_total)[5m:15s])");
    assert.equal(promql({ query: "p95", window: 60, interval: 5, p95By: "le" }), "histogram_quantile(0.95, sum by (le) (rate(devforge_http_request_duration_seconds_bucket[1m])))");
  });
});

describe("scrape-and-rate: behaviour", () => {
  it("scrapes on the interval, and a steady counter's rate equals its traffic", () => {
    const { state } = run({}, []);
    assert.equal(state.t, 120);
    assert.equal(state.instances[0]!.samples.length, 24, "120 s / 5 s");
    assert.deepEqual(values(state), [10, 5]);
    assert.deepEqual(values(run({ query: "sum-rate" }, []).state), [15]);
  });
  it("after a restart, sum(rate()) stays right but rate(sum()) is badly wrong", () => {
    const after: PromAction[] = [tick(30), { type: "restart", instance: 1 }, tick(15)];
    const good = run({ query: "sum-rate" }, after).state;
    assert.deepEqual(values(good), [15]);
    const bad = run({ query: "rate-sum" }, after).state;
    const [wrong] = values(bad) as number[];
    assert.ok(wrong! > 30, `rate(sum()) should overestimate after a reset, got ${wrong}`);
  });
  it("a range shorter than two scrapes returns nothing until the interval is shortened", () => {
    const slow = run({ interval: 60, window: 30, warmup: 240 }, []).state;
    assert.equal(evaluate(slow).kind, "empty");
    const fixed = run({ interval: 60, window: 30, warmup: 240 }, [{ type: "setInterval", seconds: 5 }, tick(30)]).state;
    assert.deepEqual(values(fixed), [10, 5]);
  });
  it("histogram_quantile needs le: by (le) gives one value, by (instance, le) one per instance, sum() alone none", () => {
    const p95 = (p95By: PromScenario["p95By"]) => evaluate(run({ query: "p95", p95By }, []).state);
    const overall = p95("le");
    assert.equal(overall.kind, "series");
    const perInstance = p95("instance-le");
    assert.ok(perInstance.kind === "series" && perInstance.series.length === 2);
    const [fast, slow] = perInstance.kind === "series" ? perInstance.series.map((s) => s.value) : [];
    assert.ok(slow! > fast!, "devforge-2 has the slower latency pattern");
    const none = p95("none");
    assert.ok(none.kind === "empty" && /removes the le label/.test(none.reason));
  });
  it("refuses no-op changes and unknown instances", () => {
    const { state } = run({}, []);
    for (const a of [{ type: "setInterval", seconds: 5 }, { type: "setWindow", seconds: 60 }, { type: "setQuery", query: "rate" }, { type: "restart", instance: 7 }, { type: "setTraffic", instance: 0, rps: 10 }] as PromAction[]) {
      assert.ok(model.step(state, a).error, JSON.stringify(a));
    }
  });
});

describe("scrape-and-rate: invariants and challenges", () => {
  it("invariants hold through a long mixed sequence, and the model is deterministic", () => {
    const actions: PromAction[] = [tick(20), { type: "restart", instance: 0 }, { type: "setTraffic", instance: 1, rps: 30 }, tick(37), { type: "setInterval", seconds: 15 }, tick(60), { type: "setQuery", query: "p95", p95By: "instance-le" }, { type: "restart", instance: 1 }, tick(45)];
    let s = model.init(scenario()).state;
    for (const a of actions) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), [], JSON.stringify(a));
    }
    assert.deepEqual(run({}, actions).state, run({}, actions).state);
  });
  it("total-survives-restart passes only with sum(rate()) after a restart in the window", () => {
    const check = model.checks["total-survives-restart"]!;
    const params = { query: "rate-sum" as const };
    const initial = run(params, []).initial;
    const solved = run(params, [{ type: "restart", instance: 1 }, tick(10), { type: "setQuery", query: "sum-rate" }]).state;
    assert.equal(check(solved, initial), true);
    assert.equal(check(run(params, [{ type: "restart", instance: 1 }, tick(10)]).state, initial), false, "rate(sum()) is wrong after the restart");
    assert.equal(check(run(params, [{ type: "setQuery", query: "sum-rate" }]).state, initial), false, "no restart yet");
  });
  it("rate-with-short-window and p95-for-the-service", () => {
    const short = model.checks["rate-with-short-window"]!;
    const p = { interval: 60, window: 60, warmup: 240 } as const;
    assert.equal(short(run(p, [{ type: "setWindow", seconds: 30 }]).state, run(p, []).initial), false);
    assert.equal(short(run(p, [{ type: "setWindow", seconds: 30 }, { type: "setInterval", seconds: 5 }, tick(30)]).state, run(p, []).initial), true);
    const p95 = model.checks["p95-for-the-service"]!;
    const q = { query: "p95", p95By: "instance-le" } as const;
    assert.equal(p95(run(q, []).state, run(q, []).initial), false);
    assert.equal(p95(run(q, [{ type: "setQuery", query: "p95", p95By: "none" }]).state, run(q, []).initial), false);
    assert.equal(p95(run(q, [{ type: "setQuery", query: "p95", p95By: "le" }]).state, run(q, []).initial), true);
  });
});
