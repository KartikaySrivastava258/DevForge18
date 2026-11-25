import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { available, kubectlCommand, reconciliation as model, resolveStrategy, rolloutComplete, type K8sAction, type K8sScenario, type K8sState } from "./reconciliation.ts";

const scenario = (over: Partial<K8sScenario> = {}): K8sScenario => ({ nodes: 2, replicas: 3, image: "nginx:1.27-alpine", maxSurge: "25%", maxUnavailable: "25%", setup: [], ...over });
const tick = (count = 1): K8sAction => ({ type: "tick", count });

/** Step one tick at a time, checking invariants after every step; returns every state seen. */
function walk(state: K8sState, actions: K8sAction[]): K8sState[] {
  const seen = [state];
  for (const action of actions) {
    const singles = action.type === "tick" ? Array.from({ length: action.count ?? 1 }, () => tick()) : [action];
    for (const a of singles) {
      const r = model.step(seen.at(-1)!, a);
      assert.equal(r.error, undefined, `${kubectlCommand(a)}: ${r.error}`);
      assert.deepEqual(violations(model, r.state), [], `after ${kubectlCommand(a)} at tick ${r.state.time}`);
      seen.push(r.state);
    }
  }
  return seen;
}

describe("reconciliation model: starting state", () => {
  it("settles into the desired number of ready Pods, spread across nodes", () => {
    const { state, error } = model.init(scenario());
    assert.equal(error, undefined);
    assert.ok(rolloutComplete(state));
    assert.equal(available(state), 3);
    const perNode = state.nodes.map((n) => state.pods.filter((p) => p.node === n.name).length);
    assert.deepEqual(perNode.sort(), [1, 2]);
    assert.deepEqual(violations(model, state), []);
  });
  it("resolves maxSurge rounding up, maxUnavailable rounding down, and never both 0", () => {
    const d = (replicas: number, maxSurge: string, maxUnavailable: string) => resolveStrategy({ replicas, image: "x", maxSurge, maxUnavailable });
    assert.deepEqual(d(5, "25%", "25%"), { surge: 2, unavailable: 1 });
    assert.deepEqual(d(4, "25%", "25%"), { surge: 1, unavailable: 1 });
    assert.deepEqual(d(5, "50%", "50%"), { surge: 3, unavailable: 2 });
    assert.deepEqual(d(2, "0", "25%"), { surge: 0, unavailable: 1 }, "both resolve to 0, so one Pod may be unavailable");
  });
});

describe("reconciliation model: self-healing and capacity", () => {
  it("replaces a deleted Pod", () => {
    const start = model.init(scenario()).state;
    const victim = start.pods[0]!.name;
    const states = walk(start, [{ type: "deletePod", pod: victim }, tick(4)]);
    const end = states.at(-1)!;
    assert.ok(!end.pods.some((p) => p.name === victim));
    assert.equal(available(end), 3);
    assert.equal(model.checks["replace-deleted-pod"]!(end, start), true);
    assert.equal(model.checks["replace-deleted-pod"]!(start, start), false, "nothing was deleted yet");
  });
  it("drains a node: its Pods are recreated elsewhere, and new Pods avoid it until uncordoned", () => {
    const start = model.init(scenario({ replicas: 4 })).state;
    const end = walk(start, [{ type: "drainNode", node: "node-1" }, tick(4)]).at(-1)!;
    assert.equal(available(end), 4);
    assert.ok(end.pods.every((p) => p.node === "node-2"));
    const back = walk(end, [{ type: "uncordonNode", node: "node-1" }, { type: "scale", replicas: 6 }, tick(4)]).at(-1)!;
    assert.ok(back.pods.some((p) => p.node === "node-1"), "new Pods can use node-1 again");
  });
  it("keeps Pods Pending when no node can take them", () => {
    const start = model.init(scenario({ nodes: 1 })).state;
    const end = walk(start, [{ type: "drainNode", node: "node-1" }, tick(3)]).at(-1)!;
    assert.equal(available(end), 0);
    assert.ok(end.pods.length === 3 && end.pods.every((p) => p.node === null && p.phase === "Pending"));
  });
  it("scales up and down", () => {
    const start = model.init(scenario()).state;
    assert.equal(available(walk(start, [{ type: "scale", replicas: 6 }, tick(3)]).at(-1)!), 6);
    assert.equal(walk(start, [{ type: "scale", replicas: 1 }, tick(2)]).at(-1)!.pods.length, 1);
  });
  it("refuses impossible actions", () => {
    const s = model.init(scenario()).state;
    for (const a of [
      { type: "deletePod", pod: "nope" },
      { type: "drainNode", node: "node-9" },
      { type: "uncordonNode", node: "node-1" },
      { type: "scale", replicas: 3 },
      { type: "setImage", image: "nginx:1.27-alpine" },
      { type: "setStrategy", maxSurge: "0", maxUnavailable: "0" },
      { type: "undo" },
    ] as K8sAction[]) {
      const r = model.step(s, a);
      assert.ok(r.error, kubectlCommand(a));
      assert.equal(r.state, s);
    }
  });
});

describe("reconciliation model: rolling updates", () => {
  it("never drops below replicas − maxUnavailable, never exceeds replicas + maxSurge, and completes (all strategies, 1–8 replicas)", () => {
    const values = ["0", "1", "2", "25%", "50%"] as const;
    for (const replicas of [1, 2, 3, 4, 5, 8]) {
      for (const maxSurge of values) {
        for (const maxUnavailable of values) {
          if (maxSurge === "0" && maxUnavailable === "0") continue;
          const start = model.init(scenario({ nodes: 3, replicas, maxSurge, maxUnavailable })).state;
          const { surge, unavailable } = resolveStrategy(start.deployment);
          const states = walk(start, [{ type: "setImage", image: "nginx:1.28-alpine" }, tick(30)]);
          const label = `${replicas} replicas, maxSurge ${maxSurge}, maxUnavailable ${maxUnavailable}`;
          for (const s of states) {
            assert.ok(available(s) >= Math.max(0, replicas - unavailable), `${label}: ${available(s)} available at tick ${s.time}`);
            assert.ok(s.pods.filter((p) => p.phase !== "Terminating").length <= replicas + surge, `${label}: too many Pods at tick ${s.time}`);
          }
          const end = states.at(-1)!;
          assert.ok(rolloutComplete(end) && end.deployment.image === "nginx:1.28-alpine", `${label}: did not complete`);
        }
      }
    }
  });
  it("matches the real cluster in the lesson: a broken image with 5 replicas stalls with 4 Pods still available", () => {
    // CI ran this on kind (Kubernetes 1.36.1) for kubernetes-services-and-rollouts: "old pods still serving: 4 available".
    const start = model.init(scenario({ replicas: 5, image: "nginx:1.28-alpine" })).state;
    const end = walk(start, [{ type: "setImage", image: "nginx:does-not-exist" }, tick(20)]).at(-1)!;
    assert.equal(available(end), 4);
    assert.ok(end.pods.filter((p) => p.image === "nginx:does-not-exist").every((p) => p.phase === "ImagePullBackOff"));
    assert.equal(rolloutComplete(end), false);
    const recovered = walk(end, [{ type: "undo" }, tick(10)]).at(-1)!;
    assert.equal(recovered.deployment.image, "nginx:1.28-alpine");
    assert.ok(rolloutComplete(recovered));
    assert.equal(model.checks["recover-from-broken-image"]!(recovered, start), true);
    assert.equal(model.checks["recover-from-broken-image"]!(end, start), false);
  });
  it("rollback reuses the previous ReplicaSet and gives it a new revision number", () => {
    const start = model.init(scenario()).state;
    const updated = walk(start, [{ type: "setImage", image: "nginx:1.28-alpine" }, tick(10)]).at(-1)!;
    const back = walk(updated, [{ type: "undo" }, tick(10)]).at(-1)!;
    assert.equal(back.replicaSets.length, 2);
    const original = back.replicaSets.find((r) => r.image === "nginx:1.27-alpine");
    assert.equal(original?.revision, 3);
  });
  it("challenge: with maxUnavailable 50% the update drops to 3 available; with 1 it keeps 4", () => {
    const check = model.checks["update-keeping-four-available"]!;
    const start = model.init(scenario({ replicas: 5, maxUnavailable: "50%" })).state;
    const carelessActions: K8sAction[] = [{ type: "setImage", image: "nginx:1.28-alpine" }, tick(15)];
    const careless = replay(model, scenario({ replicas: 5, maxUnavailable: "50%" }), carelessActions);
    assert.ok(rolloutComplete(careless.state));
    assert.equal(careless.state.rollout?.minAvailable, 3);
    assert.equal(check(careless.state, start), false);
    const carefulActions: K8sAction[] = [{ type: "setStrategy", maxSurge: "25%", maxUnavailable: "1" }, { type: "setImage", image: "nginx:1.28-alpine" }, tick(15)];
    const careful = replay(model, scenario({ replicas: 5, maxUnavailable: "50%" }), carefulActions);
    assert.equal(check(careful.state, start), true);
  });
  it("is deterministic", () => {
    const actions: K8sAction[] = [{ type: "setImage", image: "nginx:1.28-alpine" }, tick(3), { type: "deletePod", pod: "x" }, tick(5)];
    assert.deepEqual(replay(model, scenario(), actions).state, replay(model, scenario(), actions).state);
  });
  it("describes the state in text", () => {
    const lines = model.describe(model.init(scenario()).state);
    assert.match(lines.join("\n"), /Deployment web wants 3 replica\(s\) of nginx:1\.27-alpine; 3 Pod\(s\) are available/);
    assert.ok(lines.some((l) => l.startsWith("Node node-1:")));
  });
});
