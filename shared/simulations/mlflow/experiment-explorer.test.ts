import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { ExplorerActionSchema, ExplorerScenarioSchema } from "./schema.ts";
import { bestOverall, bestWithin, championRun, experimentExplorer as model, RUNS, visibleRuns, type ExplorerAction, type ExplorerScenario } from "./experiment-explorer.ts";

const scenario = (over: Partial<ExplorerScenario> = {}): ExplorerScenario => ({ limitMs: null, registered: [], champion: null, ...over });
const run = (over: Partial<ExplorerScenario>, actions: ExplorerAction[]) => replay(model, scenario(over), actions);
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("experiment explorer: the runs", () => {
  it("has a real trade-off: the lowest error is not the fastest", () => {
    assert.equal(bestOverall().name, "boost-1000");
    assert.equal(bestWithin(5)?.name, "boost-300");
    assert.equal(bestWithin(1)?.name, "forest-50x4");
    assert.ok(bestOverall().latencyMs > 5);
  });
  it("sorts and filters like a run search", () => {
    const s = run({}, [{ type: "sort", by: "rmse", dir: "asc" }, { type: "filter", kind: "forest", maxLatencyMs: 2 }]).state;
    assert.deepEqual(names(visibleRuns(s)), ["forest-50x8", "forest-50x4"]);
    const all = run({}, [{ type: "sort", by: "latencyMs", dir: "desc" }]).state;
    assert.equal(visibleRuns(all).length, RUNS.length);
    assert.equal(visibleRuns(all)[0]?.name, "boost-1000");
  });
});

describe("experiment explorer: the registry", () => {
  it("numbers versions in order and never changes them", () => {
    const { state } = run({}, [{ type: "register", runId: "r04" }, { type: "register", runId: "r04" }, { type: "register", runId: "r10" }]);
    assert.deepEqual(state.versions.map((v) => `${v.version}:${v.runId}`), ["1:r04", "2:r04", "3:r10"]);
  });
  it("moves the alias, explains the trade-off and warns about the budget", () => {
    const r = run({ limitMs: 5, registered: ["r04", "r10"], champion: 1 }, [{ type: "setChampion", version: 2 }]);
    assert.equal(championRun(r.state)?.name, "boost-1000");
    const last = r.events.at(-1) ?? "";
    assert.match(last, /RMSE down 1\.5, latency up 10\.4 ms/);
    assert.match(last, /over the service's 5 ms budget/);
  });
  it("refuses unknown runs and versions", () => {
    const s = run({}, []).state;
    assert.match(model.step(s, { type: "register", runId: "r99" }).error ?? "", /no run/);
    assert.match(model.step(s, { type: "setChampion", version: 1 }).error ?? "", /no version 1/);
  });
});

describe("experiment explorer: challenges, invariants and schemas", () => {
  it("champion-lowest-error and champion-best-within-limit", () => {
    const low = run({}, [{ type: "sort", by: "rmse", dir: "asc" }, { type: "register", runId: "r10" }, { type: "setChampion", version: 1 }]);
    assert.equal(model.checks["champion-lowest-error"]!(low.state, low.initial), true);
    const fast = run({ limitMs: 5 }, [{ type: "register", runId: "r10" }, { type: "setChampion", version: 1 }]);
    assert.equal(model.checks["champion-best-within-limit"]!(fast.state, fast.initial), false, "too slow");
    const ok = run({ limitMs: 5 }, [{ type: "register", runId: "r08" }, { type: "setChampion", version: 1 }]);
    assert.equal(model.checks["champion-best-within-limit"]!(ok.state, ok.initial), true);
    const roll = run({ limitMs: 5, registered: ["r04", "r08", "r10"], champion: 3 }, [{ type: "setChampion", version: 2 }]);
    assert.equal(model.checks["champion-best-within-limit"]!(roll.state, roll.initial), true);
    assert.equal(model.checks["champion-best-within-limit"]!(roll.initial, roll.initial), false);
  });
  it("keeps its invariants and describes every visible run", () => {
    let s = model.init(scenario({ registered: ["r01"], champion: 1 })).state;
    for (const a of [{ type: "register", runId: "r05" }, { type: "setChampion", version: 2 }, { type: "filter", kind: "boosting", maxLatencyMs: null }] as ExplorerAction[]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 1 + 4 + 2);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(ExplorerScenarioSchema.safeParse({ registered: ["r01"], champion: 2 }).success, false);
    assert.equal(ExplorerScenarioSchema.safeParse({ registered: ["nope"] }).success, false);
    assert.equal(ExplorerActionSchema.safeParse({ type: "register", runId: "x" }).success, false);
    assert.equal(ExplorerActionSchema.safeParse({ type: "sort", by: "secret", dir: "asc" }).success, false);
    assert.equal(ExplorerActionSchema.safeParse({ type: "setChampion", version: 1, extra: true }).success, false);
  });
});
