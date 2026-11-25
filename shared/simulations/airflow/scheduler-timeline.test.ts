import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { AirflowActionSchema, AirflowScenarioSchema } from "./schema.ts";
import { dayLabel, expectedRows, partialRows, schedulerTimeline as model, wrongDays, type AirflowAction, type AirflowScenario } from "./scheduler-timeline.ts";

const scenario = (over: Partial<AirflowScenario> = {}): AirflowScenario => ({ start: 0, deployed: 0, now: 0, catchup: false, retries: 0, write: "replace", flaky: [], ...over });
const run = (over: Partial<AirflowScenario>, actions: AirflowAction[]) => replay(model, scenario(over), actions);
const tick = (count: number): AirflowAction => ({ type: "tick", count });
const states = (s: ReturnType<typeof run>["state"]) => s.runs.map((r) => `${r.day}:${r.state}`);

describe("scheduler timeline: schedules and catchup", () => {
  it("labels days from 1 January 2026", () => {
    assert.deepEqual([0, 30, 31, 59].map(dayLabel), ["1 Jan", "31 Jan", "1 Feb", "1 Mar"]);
  });
  it("with catchup, creates a run for every missed date since start_date", () => {
    const { state } = run({ deployed: 4, now: 4, catchup: true }, []);
    assert.deepEqual(states(state), ["0:success", "1:success", "2:success", "3:success", "4:success"]);
    assert.ok(state.runs.every((r) => r.kind === "scheduled"));
  });
  it("without catchup, runs only the most recent date, then one a day", () => {
    assert.deepEqual(states(run({ deployed: 4, now: 4 }, []).state), ["4:success"]);
    assert.deepEqual(states(run({ deployed: 4, now: 4 }, [tick(2)]).state), ["4:success", "5:success", "6:success"]);
  });
  it("does not go past the last day", () => {
    const r = model.step(run({ deployed: 58, now: 58 }, []).state, tick(2));
    assert.match(r.error ?? "", /ends on 1 Mar/);
  });
});

describe("scheduler timeline: retries and failures", () => {
  it("fails a run when the source is down and there are no retries", () => {
    const { state } = run({ flaky: [2] }, [tick(3)]);
    assert.equal(state.runs.find((r) => r.day === 2)?.state, "failed");
    assert.equal(state.rows[2], 0, "replace mode rolls the failed attempt back");
  });
  it("a retry rescues a temporary outage", () => {
    const { state } = run({ flaky: [2], retries: 1 }, [tick(3)]);
    const r = state.runs.find((x) => x.day === 2);
    assert.deepEqual({ state: r?.state, tries: r?.tries }, { state: "success", tries: 2 });
    assert.equal(state.rows[2], expectedRows(2));
  });
  it("in append mode a failed attempt leaves half-written rows, and the retry duplicates them", () => {
    const { state } = run({ flaky: [2], retries: 1, write: "append" }, [tick(3)]);
    assert.equal(state.runs.find((x) => x.day === 2)?.state, "success");
    assert.equal(state.rows[2], partialRows(2) + expectedRows(2));
    assert.deepEqual(wrongDays(state), [2], "the run succeeded, but the data is wrong");
  });
  it("clearing a run runs the same date again", () => {
    const failed = run({ flaky: [1] }, [tick(2)]).state;
    const r = model.step(failed, { type: "clear", day: 1 });
    assert.equal(r.state.runs.find((x) => x.day === 1)?.state, "success");
    assert.equal(r.state.runs.find((x) => x.day === 1)?.runCount, 2);
    assert.match(model.step(failed, { type: "clear", day: 9 }).error ?? "", /no run/);
  });
});

describe("scheduler timeline: backfills", () => {
  const broken = { deployed: 0, now: 7, write: "append" as const, flaky: [3, 4] };
  it("'none' only fills dates that have no run", () => {
    const { state, events } = run({ deployed: 7, now: 7 }, [{ type: "backfill", from: 0, to: 6, reprocess: "none" }]);
    assert.equal(state.runs.length, 8);
    assert.ok(state.runs.filter((r) => r.day < 7).every((r) => r.kind === "backfill"));
    assert.ok(events.some((e) => /Backfill 1 Jan to 7 Jan/.test(e)));
    const again = model.step(state, { type: "backfill", from: 0, to: 6, reprocess: "none" });
    assert.match(again.events.at(-1) ?? "", /nothing to do/);
  });
  it("'failed' re-runs failed dates; in append mode that duplicates the half-written rows", () => {
    const { state } = run(broken, [{ type: "backfill", from: 0, to: 6, reprocess: "failed" }]);
    assert.deepEqual(state.runs.filter((r) => r.kind === "backfill").map((r) => r.day), [3, 4]);
    assert.deepEqual(wrongDays(state), [3, 4]);
  });
  it("'completed' in append mode duplicates every day", () => {
    const { state } = run(broken, [{ type: "backfill", from: 0, to: 6, reprocess: "completed" }]);
    assert.equal(wrongDays(state).length, 7);
  });
  it("replace mode makes any re-run safe", () => {
    const { state } = run(broken, [{ type: "setWrite", mode: "replace" }, { type: "backfill", from: 0, to: 7, reprocess: "completed" }]);
    assert.deepEqual(wrongDays(state), []);
  });
  it("refuses ranges in the future, before start_date or backwards", () => {
    const s = run({ start: 2, deployed: 5, now: 5 }, []).state;
    assert.match(model.step(s, { type: "backfill", from: 3, to: 6, reprocess: "none" }).error ?? "", /past dates/);
    assert.match(model.step(s, { type: "backfill", from: 1, to: 3, reprocess: "none" }).error ?? "", /start_date/);
    assert.match(model.step(s, { type: "backfill", from: 4, to: 3, reprocess: "none" }).error ?? "", /must not be after/);
  });
});

describe("scheduler timeline: challenges, invariants and schemas", () => {
  const checks = model.checks;
  it("week-all-success: retries get a flaky week through", () => {
    const sc = { flaky: [2, 5] };
    assert.equal(checks["week-all-success"]!(run(sc, [tick(6)]).state, run(sc, []).state), false);
    const r = run(sc, [{ type: "setRetries", retries: 1 }, tick(6)]);
    assert.equal(checks["week-all-success"]!(r.state, r.initial), true);
  });
  it("week-correct needs both successful runs and the right rows", () => {
    const broken = { deployed: 0, now: 7, write: "append" as const, flaky: [3, 4] };
    const naive = run(broken, [{ type: "backfill", from: 0, to: 6, reprocess: "failed" }]);
    assert.equal(checks["week-correct"]!(naive.state, naive.initial), false, "all runs succeed, but two days are duplicated");
    const good = run(broken, [{ type: "setWrite", mode: "replace" }, { type: "backfill", from: 0, to: 6, reprocess: "failed" }]);
    assert.equal(checks["week-correct"]!(good.state, good.initial), true);
  });
  it("keeps its invariants through a long mixed session", () => {
    const actions: AirflowAction[] = [tick(5), { type: "setWrite", mode: "append" }, { type: "setRetries", retries: 2 }, tick(10), { type: "clear", day: 3 }, { type: "backfill", from: 0, to: 15, reprocess: "completed" }, tick(20)];
    let state = model.init(scenario({ deployed: 2, now: 2, catchup: true, flaky: [1, 4, 9, 12] })).state;
    for (const a of actions) {
      state = model.step(state, a).state;
      assert.deepEqual(violations(model, state), []);
    }
    assert.equal(model.describe(state).length, state.now - state.start + 3);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(AirflowScenarioSchema.safeParse({ start: 3, deployed: 1, now: 5 }).success, false);
    assert.equal(AirflowScenarioSchema.safeParse({ start: 0, deployed: 0, now: 0, extra: 1 }).success, false);
    assert.equal(AirflowActionSchema.safeParse({ type: "setRetries", retries: 9 }).success, false);
    assert.equal(AirflowActionSchema.safeParse({ type: "backfill", from: 0, to: 99, reprocess: "none" }).success, false);
    assert.equal(AirflowActionSchema.safeParse({ type: "backfill", from: 0, to: 6, reprocess: "all" }).success, false);
  });
});
