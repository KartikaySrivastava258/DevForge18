import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { WorkflowActionSchema, WorkflowScenarioSchema } from "./schema.ts";
import { isValid, SUBMISSIONS, workflowExecutor as model, type WorkflowAction, type WorkflowScenario } from "./workflow-executor.ts";

const ALL = ["nameRequired", "emailHasAt", "knownTrack"] as WorkflowScenario["rules"];
const sc = (over: Partial<WorkflowScenario> = {}): WorkflowScenario => ({ rules: ALL, falseBranch: "none", onError: "stop", retries: 0, flaky: [], ...over });
const RUN: WorkflowAction = { type: "run" };
const run = (over: Partial<WorkflowScenario>, actions: WorkflowAction[]) => replay(model, sc(over), [...actions, RUN]);
const check = (r: ReturnType<typeof run>) => model.checks["valid-saved-invalid-reported"]!(r.state, r.initial);

describe("workflow executor: items and branches", () => {
  it("the batch has two valid submissions and three invalid ones, one per rule", () => {
    assert.deepEqual(SUBMISSIONS.filter(isValid).map((x) => x.id), [1, 5]);
  });
  it("an unconnected false output drops invalid items silently", () => {
    const r = run({}, []).state.last!;
    assert.deepEqual({ saved: r.saved, dropped: r.dropped, err: r.toErrorWorkflow }, { saved: [1, 5], dropped: [2, 3, 4], err: [] });
  });
  it("a missing rule lets invalid items through to Save", () => {
    const r = run({ rules: ["nameRequired"], falseBranch: "errorWorkflow" }, []);
    assert.deepEqual(r.state.last!.saved, [1, 3, 4, 5]);
    assert.match(r.events.at(-1) ?? "", /Invalid submissions were saved: #3, #4/);
  });
});

describe("workflow executor: errors and retries", () => {
  it("a failing node with On Error = Stop fails the execution and saves nothing", () => {
    const r = run({ falseBranch: "errorWorkflow", flaky: [5] }, []).state.last!;
    assert.equal(r.status, "error");
    assert.deepEqual(r.saved, []);
    assert.deepEqual(r.notRun, [5], "the failing node never finished item 5; item 1 passed it but Save never ran");
  });
  it("the error output keeps the execution going, but a temporary failure is then reported, not saved", () => {
    const r = run({ falseBranch: "errorWorkflow", flaky: [5] }, [{ type: "setOnError", mode: "errorOutput" }]);
    assert.equal(r.state.last!.status, "success");
    assert.deepEqual(r.state.last!.toErrorWorkflow, [2, 3, 4, 5]);
    assert.equal(check(r), false);
  });
  it("a retry rescues the temporary failure", () => {
    const r = run({ falseBranch: "errorWorkflow", flaky: [5] }, [{ type: "setRetries", retries: 1 }]);
    assert.deepEqual(r.state.last!.saved, [1, 5]);
    assert.equal(r.state.last!.attempts, 3);
    assert.equal(check(r), true);
  });
});

describe("workflow executor: challenges, invariants and schemas", () => {
  it("each challenge starts unsolved and has a fix", () => {
    assert.equal(check(run({}, [])), false);
    assert.equal(check(run({}, [{ type: "setFalseBranch", to: "errorWorkflow" }])), true);
    assert.equal(check(run({ rules: ["nameRequired"], falseBranch: "errorWorkflow" }, [{ type: "toggleRule", rule: "emailHasAt" }, { type: "toggleRule", rule: "knownTrack" }])), true);
  });
  it("keeps its invariants and describes the run", () => {
    let s = model.init(sc({ flaky: [1, 5] })).state;
    for (const a of [{ type: "run" }, { type: "setOnError", mode: "errorOutput" }, { type: "run" }, { type: "setRetries", retries: 2 }, { type: "setFalseBranch", to: "errorWorkflow" }, { type: "run" }] as WorkflowAction[]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 4 + s.last!.trace.length);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(WorkflowScenarioSchema.safeParse({ flaky: [9] }).success, false);
    assert.equal(WorkflowScenarioSchema.safeParse({ rules: ["isAdmin"] }).success, false);
    assert.equal(WorkflowActionSchema.safeParse({ type: "setRetries", retries: 5 }).success, false);
    assert.equal(WorkflowActionSchema.safeParse({ type: "run", now: true }).success, false);
  });
});
