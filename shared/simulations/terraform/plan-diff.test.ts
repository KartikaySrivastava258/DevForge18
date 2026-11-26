import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { planDiff as model, plan, summary, type PlanAction, type PlanScenario } from "./plan-diff.ts";
import { PlanActionSchema, PlanScenarioSchema } from "./schema.ts";

const TWO: PlanScenario = { servers: [{ address: "server.web", name: "web", size: "small" }, { address: "server.db", name: "db", size: "medium" }], drift: [] };
const run = (actions: PlanAction[], sc = TWO) => replay(model, sc, actions);
const RENAME: PlanAction = { type: "rename", from: "server.web", to: "server.frontend" };
const MOVED: PlanAction = { type: "addMoved", from: "server.web", to: "server.frontend" };
const APPLY: PlanAction = { type: "apply" };

describe("plan diff: symbols", () => {
  it("an applied configuration plans no changes", () => {
    assert.deepEqual(plan(run([]).state), []);
  });
  it("size is an in-place update; name forces a replacement", () => {
    const up = plan(run([{ type: "setSize", address: "server.db", size: "large" }]).state);
    assert.deepEqual(summary(up), { add: 0, change: 1, destroy: 0 });
    const rep = plan(run([{ type: "setName", address: "server.db", name: "db2" }]).state);
    assert.deepEqual(summary(rep), { add: 1, change: 0, destroy: 1 });
    assert.equal(rep[0]?.action, "replace");
  });
  it("renaming an address without a moved block is destroy and create", () => {
    const c = plan(run([RENAME]).state);
    assert.deepEqual(c.map((x) => `${x.action} ${x.address}`), ["create server.frontend", "destroy server.web"]);
  });
  it("a moved block turns the rename into a move", () => {
    const c = plan(run([RENAME, MOVED]).state);
    assert.deepEqual(c.map((x) => x.action), ["move"]);
    assert.deepEqual(summary(c), { add: 0, change: 0, destroy: 0 });
  });
});

describe("plan diff: drift and apply", () => {
  it("a change made outside Terraform shows as drift, and a normal plan reverts it", () => {
    const s = run([{ type: "outsideResize", address: "server.web", size: "large" }]).state;
    assert.deepEqual(plan(s).map((x) => x.action), ["drift", "update"]);
    const after = model.step(s, APPLY).state;
    assert.deepEqual(plan(after), []);
    assert.equal(after.real["srv-1"]?.size, "small");
  });
  it("a deleted object is re-created", () => {
    const s = run([{ type: "outsideDelete", address: "server.db" }]).state;
    assert.deepEqual(plan(s).map((x) => x.action), ["drift", "create"]);
    assert.equal(model.step(s, APPLY).state.state.find((x) => x.address === "server.db")?.id, "srv-3");
  });
  it("applying a rename without moved destroys the real object", () => {
    const s = run([RENAME, APPLY]).state;
    assert.equal(s.destroyed, 1);
    assert.equal(s.state.find((x) => x.address === "server.frontend")?.id, "srv-3");
  });
});

describe("plan diff: challenges, invariants and schemas", () => {
  it("rename-no-destroy needs the moved block", () => {
    const ok = (r: ReturnType<typeof run>) => model.checks["rename-no-destroy"]!(r.state, r.initial);
    assert.equal(ok(run([RENAME, APPLY])), false);
    assert.equal(ok(run([RENAME, MOVED, APPLY])), true);
  });
  it("drift-fixed: apply reverts, or the configuration accepts the change", () => {
    const sc: PlanScenario = { ...TWO, drift: [{ address: "server.db", size: "large" }] };
    const ok = (r: ReturnType<typeof run>) => model.checks["drift-fixed"]!(r.state, r.initial);
    assert.equal(ok(run([], sc)), false);
    assert.equal(ok(run([APPLY], sc)), true);
    assert.equal(ok(run([{ type: "setSize", address: "server.db", size: "large" }, APPLY], sc)), true);
  });
  it("keeps its invariants", () => {
    let s = model.init(TWO).state;
    for (const a of [RENAME, MOVED, APPLY, { type: "outsideResize", address: "server.db", size: "small" }, APPLY, { type: "removeMoved", from: "server.web" }, APPLY] as PlanAction[]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 4);
  });
  it("refuses bad edits and schemas reject bad input", () => {
    assert.match(model.step(run([]).state, { type: "rename", from: "server.web", to: "server.db" }).error ?? "", /already exists/);
    assert.equal(PlanActionSchema.safeParse({ type: "rename", from: "server.web", to: "aws_instance.x" }).success, false);
    assert.equal(PlanScenarioSchema.safeParse({ servers: [] }).success, false);
  });
});
