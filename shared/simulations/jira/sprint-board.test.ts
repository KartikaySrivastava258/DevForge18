import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { SprintActionSchema, SprintScenarioSchema } from "./schema.ts";
import { BACKLOG, committedPoints, focus, goalDone, sprintBoard as model, type SprintAction, type SprintScenario } from "./sprint-board.ts";

const ALL = BACKLOG.map((s) => s.id);
const sc = (over: Partial<SprintScenario> = {}): SprintScenario => ({ committed: ALL, wip: 8, ...over });
const play = (over: Partial<SprintScenario>, before: SprintAction[] = []) => replay(model, sc(over), [...before, { type: "tick", count: 10 } as SprintAction]);

describe("sprint board: the model", () => {
  it("full focus up to one story per developer, less beyond, never below half", () => {
    assert.deepEqual([1, 3, 4, 6, 9].map(focus), [1, 1, 0.9, 0.7, 0.5]);
  });
  it("starts stories only while In Progress is under the WIP limit", () => {
    const one = replay(model, sc({ wip: 2 }), [{ type: "tick" }]).state;
    assert.equal(one.cards.filter((c) => c.column === "progress").length, 2);
  });
  it("a blocked story does no work but keeps its place in progress", () => {
    const r = replay(model, sc({ committed: ["DEV-2"], wip: 1 }), [{ type: "tick", count: 3 }]);
    assert.match(r.events.join(" "), /blocked DEV-2 \(waiting for the email provider's API key\)/);
    assert.deepEqual(r.state.burndown.slice(0, 4), [5, 2, 2, 2]);
  });
  it("records a burndown and a cumulative flow for every day", () => {
    const s = play({}).state;
    assert.equal(s.burndown.length, 11);
    assert.equal(s.flow.length, 11);
    assert.ok(s.burndown.every((p, i) => i === 0 || p <= s.burndown[i - 1]!));
  });
});

describe("sprint board: challenges", () => {
  it("too much WIP misses the goal; a limit of 2 to 4 meets it, and 1 is too strict with blockers", () => {
    const met = (wip: number) => model.checks["goal-met"]!(play({ wip }).state, play({ wip }).initial);
    assert.deepEqual([1, 2, 3, 4, 5, 8].map(met), [true, true, true, true, false, false]);
    assert.ok(play({ wip: 1 }).state.burndown.at(-1)! > play({ wip: 3 }).state.burndown.at(-1)!, "WIP 1 leaves more undone than WIP 3");
  });
  it("over-committing leaves work unfinished; committing less finishes it all", () => {
    const all = (r: ReturnType<typeof play>) => model.checks["all-done"]!(r.state, r.initial);
    assert.equal(all(play({ wip: 3 })), false);
    assert.equal(all(play({ wip: 3 }, [{ type: "uncommit", id: "DEV-8" }, { type: "uncommit", id: "DEV-7" }])), true);
    assert.equal(committedPoints({ committed: ALL }), 34);
  });
  it("planning closes when the sprint starts, and the sprint ends after ten days", () => {
    const started = replay(model, sc(), [{ type: "tick" }]).state;
    assert.match(model.step(started, { type: "uncommit", id: "DEV-8" }).error ?? "", /planning is over/);
    assert.match(model.step(play({}).state, { type: "tick" }).error ?? "", /over/);
  });
});

describe("sprint board: invariants, text mode and schemas", () => {
  it("keeps its invariants every day", () => {
    let s = model.init(sc({ wip: 5 })).state;
    for (let d = 0; d < 10; d++) {
      s = model.step(s, { type: "tick" }).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 6);
    assert.equal(goalDone(s), false);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(SprintScenarioSchema.safeParse({ committed: ["DEV-99"] }).success, false);
    assert.equal(SprintActionSchema.safeParse({ type: "setWip", limit: 0 }).success, false);
    assert.equal(SprintActionSchema.safeParse({ type: "tick", count: 11 }).success, false);
  });
});
