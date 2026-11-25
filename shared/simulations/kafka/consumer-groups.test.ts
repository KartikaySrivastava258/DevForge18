import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { assignment, consumerGroups as model, KEYS, lagOf, partitionFor, totalLag, type KafkaAction, type KafkaScenario } from "./consumer-groups.ts";

const scenario = (over: Partial<KafkaScenario> = {}): KafkaScenario => ({ partitions: 3, consumers: 1, capacity: 3, incoming: ["asha", "ravi", "meera", "nikhil"], warmup: 10, ...over });
const tick = (count: number): KafkaAction => ({ type: "tick", count });
const run = (over: Partial<KafkaScenario>, actions: KafkaAction[]) => replay(model, scenario(over), actions);

describe("consumer groups: the topic", () => {
  it("sends every event with a key to the same partition, in order", () => {
    const { state } = run({}, [{ type: "burst", key: "asha", count: 5 }]);
    const p = partitionFor("asha", 3);
    const ashas = state.partitions.flatMap((log, i) => log.filter((e) => e.key === "asha").map((e) => ({ i, seq: e.seq })));
    assert.ok(ashas.every((x) => x.i === p));
    assert.deepEqual(ashas.map((x) => x.seq), [...ashas.map((x) => x.seq)].sort((a, b) => a - b));
  });
  it("moves keys when partitions are added (for some keys), and says so", () => {
    const moved = KEYS.filter((k) => partitionFor(k, 3) !== partitionFor(k, 4));
    assert.ok(moved.length > 0);
    const r = model.step(run({}, []).state, { type: "addPartitions", count: 1 });
    assert.match(r.events[0] ?? "", /will now go to a different partition/);
  });
});

describe("consumer groups: the group", () => {
  it("gives each partition to exactly one member; extra members are idle", () => {
    const s = run({ partitions: 3, consumers: 4 }, []).state;
    const sizes = [...assignment(s).values()].map((p) => p.length).sort();
    assert.deepEqual(sizes, [0, 1, 1, 1]);
  });
  it("lag grows when the group is too small, and drains with enough members", () => {
    assert.equal(totalLag(run({}, []).state), 10, "one member: 3 per tick against 4 arriving");
    // Keys hash unevenly: two members are not enough, because one of them owns both busy partitions.
    const two = run({}, [{ type: "addConsumer" }, tick(10)]).state;
    assert.ok(totalLag(two) > 10);
    const three = run({}, [{ type: "addConsumer" }, { type: "addConsumer" }, tick(20)]).state;
    assert.equal(totalLag(three), 0);
  });
  it("a crash moves the partitions to the remaining members", () => {
    const s = run({ consumers: 3, warmup: 5 }, [{ type: "crashConsumer", name: "consumer-2" }]).state;
    const parts = [...assignment(s).values()].flat().sort();
    assert.deepEqual(parts, [0, 1, 2]);
  });
  it("refuses an offset reset while the group has members, and allows it when empty", () => {
    const s = run({}, []).state;
    assert.match(model.step(s, { type: "resetOffsets" }).error ?? "", /no active members/);
    const empty = model.step(s, { type: "crashConsumer", name: "consumer-1" }).state;
    const reset = model.step(empty, { type: "resetOffsets" }).state;
    assert.equal(lagOf(reset, 0) + lagOf(reset, 1) + lagOf(reset, 2), reset.produced);
  });
  it("keeps its invariants and is deterministic", () => {
    const actions: KafkaAction[] = [tick(3), { type: "addConsumer" }, { type: "burst", key: "zoya", count: 12 }, tick(4), { type: "addPartitions", count: 2 }, { type: "crashConsumer", name: "consumer-1" }, tick(6), { type: "addConsumer" }, { type: "addConsumer" }, tick(5)];
    let s = model.init(scenario()).state;
    for (const a of actions) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), [], JSON.stringify(a));
    }
    assert.deepEqual(run({}, actions).state, run({}, actions).state);
  });
});

describe("consumer groups: challenges", () => {
  it("lag-to-zero needs three members, not two", () => {
    const check = model.checks["lag-to-zero"]!;
    const { initial } = run({}, []);
    assert.equal(check(run({}, [{ type: "addConsumer" }, tick(20)]).state, initial), false);
    assert.equal(check(run({}, [{ type: "addConsumer" }, { type: "addConsumer" }, tick(20)]).state, initial), true);
  });
  it("idle-member and recover-from-crash", () => {
    const idle = model.checks["idle-member"]!;
    const p = { partitions: 4, consumers: 4 } as const;
    assert.equal(idle(run(p, []).state, run(p, []).initial), false);
    assert.equal(idle(run(p, [{ type: "addConsumer" }]).state, run(p, []).initial), true);
    const recover = model.checks["recover-from-crash"]!;
    const c = { consumers: 3, warmup: 5 } as const;
    const init = run(c, []).initial;
    assert.equal(recover(run(c, [{ type: "crashConsumer", name: "consumer-2" }, tick(10)]).state, init), false, "two members cannot keep up");
    assert.equal(recover(run(c, [{ type: "crashConsumer", name: "consumer-2" }, tick(5), { type: "addConsumer" }, tick(20)]).state, init), true);
  });
});
