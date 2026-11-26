import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { buildTrace, criticalPath, duration, latest, selfTime, traceWaterfall as model, type WaterfallAction, type WaterfallScenario } from "./trace-waterfall.ts";

const scenario = (over: Partial<WaterfallScenario> = {}): WaterfallScenario => ({ cacheHit: false, parallel: false, extra: {}, sent: 1, ...over });
const config = (over: Partial<WaterfallScenario> = {}) => {
  const p = scenario(over);
  return { cacheHit: p.cacheHit, parallel: p.parallel, extra: { gateway: 0, api: 0, cache: 0, database: 0, payment: 0, ...p.extra } };
};
const names = (ids: string[], t: ReturnType<typeof buildTrace>) => ids.map((id) => t.spans.find((s) => s.spanId === id)?.name);

describe("trace waterfall: the trace", () => {
  it("has one root, children inside parents, and fixed timings that add up", () => {
    const t = buildTrace(config(), 1);
    assert.equal(t.spans.length, 7, "gateway server+client, api server, cache, database, payment client+server");
    assert.equal(t.traceId.length, 32);
    // 3 + (2 + [8 + 2 + 25 + 64 + 2] + 2) + 1 = 109 ms when everything is sequential and the cache misses.
    assert.equal(duration(t), 109);
    assert.equal(duration(buildTrace(config({ parallel: true }), 1)), 84, "database and payment overlap: max(25, 64)");
    assert.equal(duration(buildTrace(config({ cacheHit: true }), 1)), 84, "no database call");
    assert.equal(buildTrace(config(), 1).spans.filter((s) => s.service === "api" && s.kind === "Client").length, 3, "the API's calls are its own client spans");
  });
  it("self time subtracts the time covered by children; overlapping children are counted once", () => {
    const t = buildTrace(config({ parallel: true }), 1);
    const api = t.spans.find((s) => s.kind === "Server" && s.service === "api")!;
    // api: 8 own before + 2 cache + max(25, 64) + 2 own after = 76 ms; own work 8 + 2 = 10 ms.
    assert.equal(api.end - api.start, 76);
    assert.equal(selfTime(t, api), 10);
  });
  it("the critical path holds every call a span waited for, but only the slower of overlapping calls", () => {
    // Sequential: the cache, then the database, then payment — each waits for the one before, so all three decide the total.
    const seq = buildTrace(config(), 1);
    assert.deepEqual(names(criticalPath(seq), seq), ["GET /checkout", "GET /api/checkout", "GET /api/checkout", "GET cart (cache)", "SELECT cart (database)", "POST /authorize (payment)", "POST /authorize"]);
    // Parallel: the database overlaps the slower payment call, so it is off the path.
    const par = buildTrace(config({ parallel: true }), 1);
    assert.ok(!names(criticalPath(par), par).includes("SELECT cart (database)"));
    assert.ok(names(criticalPath(par), par).includes("POST /authorize (payment)"));
    const slowDb = buildTrace(config({ parallel: true, extra: { database: 100 } }), 1);
    assert.deepEqual(names(criticalPath(slowDb), slowDb).slice(-1), ["SELECT cart (database)"], "a slow database becomes the critical path when the calls run in parallel");
  });
  it("is deterministic and gives every request new IDs", () => {
    assert.deepEqual(buildTrace(config(), 3), buildTrace(config(), 3));
    assert.notEqual(buildTrace(config(), 3).traceId, buildTrace(config(), 4).traceId);
  });
});

describe("trace waterfall: actions, invariants and challenges", () => {
  it("refuses no-op changes and spans that are not in the latest trace", () => {
    const { state } = replay(model, scenario(), []);
    for (const a of [{ type: "setCache", hit: false }, { type: "setParallel", parallel: false }, { type: "setLatency", service: "payment", ms: 0 }, { type: "select", spanId: "0000000000000000" }] as WaterfallAction[]) {
      assert.ok(model.step(state, a).error, JSON.stringify(a));
    }
  });
  it("keeps the invariants through every configuration", () => {
    let s = model.init(scenario({ sent: 0 })).state;
    const actions: WaterfallAction[] = [{ type: "send" }, { type: "setParallel", parallel: true }, { type: "send" }, { type: "setLatency", service: "database", ms: 300 }, { type: "send" }, { type: "setCache", hit: true }, { type: "setLatency", service: "gateway", ms: 50 }, { type: "send" }];
    for (const a of actions) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), [], JSON.stringify(a));
    }
    assert.equal(s.traces.length, 3, "only the last three traces are kept");
  });
  it("find-the-slow-span: passes only when the span with the most own time is selected", () => {
    const check = model.checks["find-the-slow-span"]!;
    const params = scenario({ extra: { payment: 300 } });
    const { state, initial } = replay(model, params, []);
    const t = latest(state)!;
    const paymentServer = t.spans.find((s) => s.service === "payment" && s.kind === "Server")!;
    assert.equal(selfTime(t, paymentServer), 360);
    const paymentClient = t.spans.find((s) => s.name === "POST /authorize (payment)")!;
    assert.equal(check(model.step(state, { type: "select", spanId: paymentServer.spanId }).state, initial), true);
    assert.equal(check(model.step(state, { type: "select", spanId: paymentClient.spanId }).state, initial), false, "the client span only waited for the payment service");
    assert.equal(check(state, initial), false);
  });
  it("checkout-under-150ms: parallel calls or a cache hit fix a slow database; sending is needed to see it", () => {
    const check = model.checks["checkout-under-150ms"]!;
    const params = scenario({ extra: { database: 100 } });
    const start = replay(model, params, []);
    assert.equal(duration(latest(start.state)!), 209);
    assert.equal(check(start.state, start.initial), false);
    assert.equal(check(replay(model, params, [{ type: "setParallel", parallel: true }]).state, start.initial), false, "no new request yet");
    assert.equal(check(replay(model, params, [{ type: "setParallel", parallel: true }, { type: "send" }]).state, start.initial), true);
    assert.equal(check(replay(model, params, [{ type: "setCache", hit: true }, { type: "send" }]).state, start.initial), true);
    assert.equal(check(replay(model, params, [{ type: "setLatency", service: "database", ms: 0 }, { type: "send" }]).state, start.initial), false, "removing the database's latency is not the design change asked for");
  });
});
