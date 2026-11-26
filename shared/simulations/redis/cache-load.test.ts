import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { cacheLoad as model, hitRatio, peak, traffic, type CacheAction, type CacheScenario } from "./cache-load.ts";
import { CacheActionSchema, CacheScenarioSchema } from "./schema.ts";

const SC: CacheScenario = { cacheOn: true, ttl: 10, singleFlight: false, limit: 60, hotExpiresAt: 25 };
const MINUTE: CacheAction = { type: "tick", count: 60 };
const run = (over: Partial<CacheScenario>, actions: CacheAction[] = []) => replay(model, { ...SC, ...over }, [...actions, MINUTE]);

describe("cache under load", () => {
  it("without a cache, the database gets every request", () => {
    const s = run({ cacheOn: false }).state;
    assert.deepEqual([peak(s), hitRatio(s)], [400, 0]);
    assert.equal(traffic(25), 400);
  });
  it("when the hot key expires in the spike, its requests stampede the database", () => {
    const s = run({}).state;
    assert.equal(s.dbLoad[25], 240);
    assert.ok(hitRatio(s) > 0.9, "a high hit ratio can still hide a stampede");
  });
  it("a longer TTL does not stop a stampede that happens anyway", () => {
    assert.equal(run({ ttl: 60 }).state.dbLoad[25], 240);
  });
  it("single flight sends one query per expired key", () => {
    const s = run({ singleFlight: true }).state;
    assert.equal(s.dbLoad[25], 1);
    assert.ok(peak(s) <= 60);
  });
  it("a cold cache also stampedes, unless single flight is on", () => {
    assert.equal(run({ hotExpiresAt: null }).state.dbLoad[0], 100);
    assert.equal(run({ hotExpiresAt: null, singleFlight: true }).state.dbLoad[0], 41);
  });
});

describe("cache under load: challenge, refusals, invariants and schemas", () => {
  it("under-the-limit needs single flight here", () => {
    const ok = (r: ReturnType<typeof run>) => model.checks["under-the-limit"]!(r.state, r.initial);
    assert.equal(ok(run({})), false);
    assert.equal(ok(replay(model, SC, [{ type: "setSingleFlight", on: true }, MINUTE])), true);
  });
  it("settings change only before the traffic starts", () => {
    const started = replay(model, SC, [{ type: "tick" }]).state;
    assert.match(model.step(started, { type: "setTtl", seconds: 30 }).error ?? "", /before the traffic starts/);
  });
  it("keeps its invariants every second", () => {
    for (const over of [{}, { cacheOn: false }, { singleFlight: true, ttl: 1 }]) {
      let s = model.init({ ...SC, ...over }).state;
      for (let t = 0; t < 60; t++) {
        s = model.step(s, { type: "tick" }).state;
        assert.deepEqual(violations(model, s), []);
      }
      assert.equal(model.describe(s).length, 3);
    }
  });
  it("schemas reject bad input", () => {
    assert.equal(CacheActionSchema.safeParse({ type: "setTtl", seconds: 0 }).success, false);
    assert.equal(CacheScenarioSchema.safeParse({ hotExpiresAt: 99 }).success, false);
  });
});
