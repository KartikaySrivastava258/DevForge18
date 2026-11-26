import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { buildQueue as model, maxWait, type QueueAction, type QueueScenario } from "./build-queue.ts";
import { QueueActionSchema, QueueScenarioSchema } from "./schema.ts";

const LINUX: QueueScenario = { agents: [{ name: "linux-1", label: "linux", executors: 1 }] };
const HALF = { agents: [...LINUX.agents, { name: "docker-1", label: "docker" as const, executors: 1 }] };
const ALL: QueueAction = { type: "tick", count: 30 };
const run = (sc: QueueScenario, a: QueueAction[]) => replay(model, sc, [...a, ALL]);
const ok = (r: ReturnType<typeof run>) => model.checks["short-queue"]!(r.state, r.initial);

describe("build queue", () => {
  it("builds wait forever without an agent that has their label", () => {
    const s = run(LINUX, []).state;
    assert.equal(s.runs.filter((r) => r.start === null).length, 8);
    assert.equal(maxWait(s), 30);
  });
  it("more agents with the wrong label do not help", () => {
    assert.equal(ok(run(LINUX, [{ type: "addAgent", label: "linux", executors: 2 }])), false);
  });
  it("one docker executor is not enough; two keep the queue short", () => {
    assert.equal(maxWait(run(LINUX, [{ type: "addAgent", label: "docker", executors: 1 }]).state), 12);
    assert.equal(ok(run(LINUX, [{ type: "addAgent", label: "docker", executors: 2 }])), true);
    assert.equal(ok(run(HALF, [{ type: "addAgent", label: "docker", executors: 1 }])), true);
  });
  it("keeps its invariants, refuses late changes, rejects bad input", () => {
    let s = model.init(HALF).state;
    for (let t = 0; t < 30; t++) {
      s = model.step(s, { type: "tick" }).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 1 + 12 + 1);
    assert.match(model.step(s, { type: "addAgent", label: "docker", executors: 1 }).error ?? "", /before the builds start/);
    assert.equal(QueueActionSchema.safeParse({ type: "addAgent", label: "windows", executors: 1 }).success, false);
    assert.equal(QueueScenarioSchema.safeParse({ agents: [{ name: "x", label: "linux", executors: 1 }] }).success, false);
  });
});
