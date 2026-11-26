import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { PlannerActionSchema, PlannerScenarioSchema } from "./schema.ts";
import { queryPlanner as model, usableConditions, QUERIES, type Column, type PlannerAction } from "./query-planner.ts";

const idx = (...columns: Column[]): PlannerAction => ({ type: "createIndex", columns });
const EXPLAIN: PlannerAction = { type: "explain" };
const run = (query: string, actions: PlannerAction[], indexes: Column[][] = []) => replay(model, { query, indexes }, [...actions, EXPLAIN]);
const last = (r: ReturnType<typeof run>) => r.state.last!;

describe("query planner: plans", () => {
  it("without an index, a sequential scan touches every row", () => {
    const p = last(run("customer", []));
    assert.deepEqual([p.kind, p.touched, p.returned], ["seq", 100000, 20]);
  });
  it("a selective index is used and touches only the matching rows", () => {
    const p = last(run("customer", [idx("customer_id")]));
    assert.deepEqual([p.kind, p.index, p.touched], ["index", "orders_customer_id_idx", 20]);
  });
  it("an index on a column that matches most rows is ignored", () => {
    const p = last(run("shipped", [idx("status")]));
    assert.equal(p.kind, "seq");
    assert.ok(p.considered.some((c) => c.label.includes("orders_status_idx") && c.cost > p.cost));
  });
  it("a two-column index helps only through its leading column", () => {
    const q = QUERIES.customer!;
    assert.equal(usableConditions({ name: "a", columns: ["status", "customer_id"] }, q).length, 0);
    assert.equal(usableConditions({ name: "b", columns: ["customer_id", "status"] }, q).length, 1);
    assert.equal(last(run("customer", [idx("status", "customer_id")])).kind, "seq");
  });
});

describe("query planner: challenges", () => {
  const ok = (r: ReturnType<typeof run>) => model.checks["under-1-percent"]!(r.state, r.initial);
  it("customer query: an index on customer_id", () => {
    assert.equal(ok(run("customer", [])), false);
    assert.equal(ok(run("customer", [idx("customer_id")])), true);
  });
  it("pending-on-day query: status alone is not enough; day, or status and day together, is", () => {
    assert.equal(ok(run("pendingDay", [idx("status")])), false);
    const day = last(run("pendingDay", [idx("day")]));
    assert.deepEqual([day.kind, day.touched], ["index", 274]);
    const both = last(run("pendingDay", [idx("status", "day")]));
    assert.deepEqual([both.kind, both.touched, both.returned], ["index", 27, 27]);
    assert.equal(ok(run("pendingDay", [idx("status", "day")])), true);
  });
});

describe("query planner: invariants, refusals and schemas", () => {
  it("keeps its invariants and refuses duplicates", () => {
    let s = model.init({ query: "pendingDay", indexes: [] }).state;
    for (const a of [idx("status"), EXPLAIN, idx("day"), EXPLAIN, idx("status", "day"), EXPLAIN, { type: "dropIndex", name: "orders_day_idx" } as PlannerAction, EXPLAIN]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.match(model.step(s, idx("status")).error ?? "", /already exists/);
    assert.match(model.step(s, { type: "dropIndex", name: "orders_nope_idx" }).error ?? "", /no index/);
    assert.equal(model.describe(s).length, 3);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(PlannerScenarioSchema.safeParse({ query: "drop table" }).success, false);
    assert.equal(PlannerActionSchema.safeParse({ type: "createIndex", columns: ["password"] }).success, false);
    assert.equal(PlannerActionSchema.safeParse({ type: "createIndex", columns: ["day", "status", "customer_id"] }).success, false);
  });
});
