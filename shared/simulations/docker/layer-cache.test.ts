import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { LayerActionSchema, LayerScenarioSchema } from "./schema.ts";
import { layerCache as model, type LayerAction, type LayerScenario, type StepId } from "./layer-cache.ts";

const BAD: LayerScenario = {
  lines: [{ id: "from", on: true }, { id: "copyAll", on: true }, { id: "install", on: true }, { id: "copyDeps", on: false }, { id: "copySrc", on: false }, { id: "cmd", on: true }],
  ignoreSecrets: false,
  prebuilt: true,
};
const a = (x: LayerAction) => x;
const run = (actions: LayerAction[], sc = BAD) => replay(model, sc, actions);
const cached = (r: ReturnType<typeof run>) => Object.fromEntries(r.state.last!.steps.map((x) => [x.id, x.cached])) as Partial<Record<StepId, boolean>>;
const REORDER: LayerAction[] = [a({ type: "moveUp", id: "copyDeps" }), a({ type: "toggle", id: "copyAll" }), a({ type: "toggle", id: "copyDeps" }), a({ type: "toggle", id: "copySrc" }), a({ type: "build" })];

describe("layer cache: rebuilding", () => {
  it("an unchanged rebuild reuses every step", () => {
    const r = run([a({ type: "build" })]);
    assert.ok(r.state.last!.steps.every((x) => x.cached));
    assert.equal(r.state.last!.seconds, 0);
  });
  it("copying everything first: a code change reruns the slow install", () => {
    const r = run([a({ type: "edit", file: "src" }), a({ type: "build" })]);
    assert.deepEqual(cached(r), { from: true, copyAll: false, install: false, cmd: false });
    assert.equal(r.state.last!.seconds, 46);
    assert.ok(r.state.last!.files.includes("secrets.env"));
  });
  it("dependencies first, code last: a code change only recopies the code", () => {
    const r = run([...REORDER, a({ type: "edit", file: "src" }), a({ type: "build" })]);
    assert.deepEqual(cached(r), { from: true, copyDeps: true, install: true, copySrc: false, cmd: false });
    assert.equal(r.state.last!.seconds, 1);
  });
  it("changing the dependency list still reinstalls — as it should", () => {
    const r = run([...REORDER, a({ type: "edit", file: "deps" }), a({ type: "build" })]);
    assert.equal(cached(r).install, false);
  });
  it("refuses impossible Dockerfiles with the reason", () => {
    const early = run([a({ type: "moveUp", id: "install" }), a({ type: "build" })]);
    assert.match(early.events.at(-1) ?? "", /requirements\.txt does not exist yet/);
    const noSrc = run([a({ type: "toggle", id: "copyAll" }), a({ type: "toggle", id: "copyDeps" }), a({ type: "moveUp", id: "copyDeps" }), a({ type: "moveUp", id: "copyDeps" }), a({ type: "build" })]);
    assert.match(noSrc.events.at(-1) ?? "", /no source code/);
    assert.match(model.step(run([]).state, a({ type: "toggle", id: "from" })).error ?? "", /FROM/);
  });
});

describe("layer cache: challenges, invariants and schemas", () => {
  it("fast-code-change needs the reorder, a code edit and a rebuild", () => {
    const check = (r: ReturnType<typeof run>) => model.checks["fast-code-change"]!(r.state, r.initial);
    assert.equal(check(run([a({ type: "edit", file: "src" }), a({ type: "build" })])), false);
    assert.equal(check(run([...REORDER])), false, "nothing was edited");
    assert.equal(check(run([...REORDER, a({ type: "edit", file: "src" }), a({ type: "build" })])), true);
  });
  it("no-secrets: .dockerignore or copying only what is needed", () => {
    const check = (r: ReturnType<typeof run>) => model.checks["no-secrets"]!(r.state, r.initial);
    assert.equal(check(run([a({ type: "build" })])), false);
    assert.equal(check(run([a({ type: "setIgnore", on: true }), a({ type: "build" })])), true);
    assert.equal(check(run(REORDER)), true);
  });
  it("keeps its invariants and describes the Dockerfile", () => {
    let s = model.init(BAD).state;
    for (const x of [...REORDER, a({ type: "edit", file: "deps" }), a({ type: "build" }), a({ type: "moveDown", id: "copySrc" }), a({ type: "build" })]) {
      s = model.step(s, x).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 1 + 6 + 2);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(LayerScenarioSchema.safeParse({ lines: [{ id: "from", on: true }, { id: "from", on: true }] }).success, false);
    assert.equal(LayerActionSchema.safeParse({ type: "toggle", id: "rm" }).success, false);
    assert.equal(LayerActionSchema.safeParse({ type: "edit", file: "secrets" }).success, false);
  });
});
