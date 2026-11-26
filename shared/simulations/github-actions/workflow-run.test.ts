import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { WorkflowRunActionSchema, WorkflowRunScenarioSchema } from "./schema.ts";
import { REQUIRED, simulate, workflowRun as model, type JobId, type WorkflowRunAction, type WorkflowRunScenario } from "./workflow-run.ts";

const CHAIN: WorkflowRunScenario = { needs: { lint: [], build: ["lint"], unit: ["build"], e2e: ["unit"], docs: ["e2e"], deploy: ["docs"] }, unitMode: "matrix", failing: [] };
const NEEDED: WorkflowRunScenario = { needs: { ...REQUIRED }, unitMode: "sequential", failing: [] };
const RUN: WorkflowRunAction = { type: "run" };
const t = (job: JobId, on: JobId): WorkflowRunAction => ({ type: "toggleNeed", job, on });
const run = (sc: WorkflowRunScenario, actions: WorkflowRunAction[]) => replay(model, sc, [...actions, RUN]);
const UNCHAIN = [t("build", "lint"), t("e2e", "unit"), t("e2e", "build"), t("docs", "e2e"), t("deploy", "docs"), t("deploy", "unit"), t("deploy", "e2e")];

describe("workflow run: timing", () => {
  it("a chain of needs runs every job one after another", () => {
    assert.equal(run(CHAIN, []).state.last!.total, 22);
  });
  it("only the real dependencies: lint and docs run beside the build, and the run takes 12 minutes", () => {
    const r = run(CHAIN, UNCHAIN).state.last!;
    assert.equal(r.total, 12);
    const at = (n: string) => r.jobs.find((j) => j.name === n)!;
    assert.deepEqual([at("lint").start, at("docs").start, at("build").start, at("e2e").start, at("deploy").start], [0, 0, 0, 4, 10]);
  });
  it("three Node versions one after another take 15 minutes; a matrix runs them side by side", () => {
    assert.equal(simulate(NEEDED).total, 21);
    const m = simulate({ ...NEEDED, unitMode: "matrix" });
    assert.equal(m.total, 12);
    assert.equal(m.jobs.filter((j) => j.job === "unit").length, 3);
  });
  it("a failing job skips everything that needs it", () => {
    const r = simulate({ ...NEEDED, unitMode: "matrix", failing: ["e2e"] });
    assert.equal(r.jobs.find((j) => j.name === "e2e")?.result, "failure");
    assert.equal(r.jobs.find((j) => j.name === "deploy")?.result, "skipped");
    assert.equal(r.jobs.find((j) => j.name === "docs")?.result, "success");
  });
});

describe("workflow run: challenges, refusals, invariants and schemas", () => {
  it("fast-and-correct needs the real dependencies kept", () => {
    const ok = (r: ReturnType<typeof run>) => model.checks["fast-and-correct"]!(r.state, r.initial);
    assert.equal(ok(run(CHAIN, [])), false);
    assert.equal(ok(run(CHAIN, UNCHAIN)), true);
    const reckless = run(CHAIN, [...UNCHAIN, t("e2e", "build")]);
    assert.equal(reckless.state.last!.total <= 12, true);
    assert.equal(ok(reckless), false, "e2e no longer waits for the build");
  });
  it("three-versions-fast needs the matrix", () => {
    const ok = (r: ReturnType<typeof run>) => model.checks["three-versions-fast"]!(r.state, r.initial);
    assert.equal(ok(run(NEEDED, [])), false);
    assert.equal(ok(run(NEEDED, [{ type: "setUnitMode", mode: "matrix" }])), true);
  });
  it("refuses cycles and keeps its invariants", () => {
    assert.match(model.step(model.init(CHAIN).state, t("lint", "deploy")).error ?? "", /cycle/);
    let s = model.init(CHAIN).state;
    for (const a of [...UNCHAIN, RUN, { type: "setFailing", job: "build", failing: true } as WorkflowRunAction, RUN]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.ok(s.last!.jobs.filter((j) => j.result === "skipped").length >= 3);
    assert.equal(model.describe(s).length, 6 + s.last!.jobs.length + 1);
  });
  it("schemas reject bad input", () => {
    assert.equal(WorkflowRunActionSchema.safeParse({ type: "toggleNeed", job: "lint", on: "rm" }).success, false);
    assert.equal(WorkflowRunScenarioSchema.safeParse({ needs: { lint: [] } }).success, false);
  });
});
