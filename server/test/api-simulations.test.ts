import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

const GIT = "/api/simulations/git-commit-graph";
const UNDO = `${GIT}/challenges/undo-pushed-commit/verify`;

let server: TestServer;
let student: Client;
let anonymous: Client;
before(async () => {
  server = await startTestServer();
  await server.createUser("sim@example.edu", STRONG_PASSWORD);
  student = new Client(server.url);
  anonymous = new Client(server.url);
  await student.post("/api/auth/login", { email: "sim@example.edu", password: STRONG_PASSWORD });
});
after(() => server.close());

describe("simulation content API", () => {
  it("returns the simulation without reference solutions", async () => {
    const res = await anonymous.get(GIT);
    assert.equal(res.status, 200);
    assert.equal(res.json.simulation.title, "Commit graph explorer");
    assert.equal(res.json.simulation.challenges.length, 3);
    assert.ok(res.json.simulation.simplifications.length > 0);
    assert.ok(!res.text.includes("solution"), "solutions never leave the server");
    assert.deepEqual(res.json.completed, []);
  });
  it("lists a track's simulations on the track", async () => {
    const res = await anonymous.get("/api/tracks/kubernetes");
    assert.deepEqual(res.json.simulations.map((s: { id: string }) => s.id), ["kubernetes-reconciliation"]);
    const none = await anonymous.get("/api/tracks/kafka");
    assert.deepEqual(none.json.simulations, []);
  });
  it("404s for unknown simulations and challenges", async () => {
    assert.equal((await anonymous.get("/api/simulations/nope")).status, 404);
    assert.equal((await anonymous.post(`${GIT}/challenges/nope/verify`, { actions: [{ type: "revert", commit: "HEAD" }] })).status, 404);
  });
});

describe("challenge verification", () => {
  it("replays the actions on the server: a correct run passes, but is not saved for anonymous visitors", async () => {
    const res = await anonymous.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }] });
    assert.equal(res.status, 200);
    assert.deepEqual({ passed: res.json.passed, saved: res.json.saved }, { passed: true, saved: false });
  });
  it("does not pass a run that does not meet the goal", async () => {
    const res = await student.post(UNDO, { actions: [{ type: "reset", to: "HEAD~1" }] });
    assert.deepEqual({ passed: res.json.passed, saved: res.json.saved }, { passed: false, saved: false });
    assert.deepEqual(res.json.completed, []);
  });
  it("records a verified challenge once for a signed-in learner", async () => {
    const first = await student.post(UNDO, { actions: [{ type: "reset", to: "HEAD~1" }, { type: "revert", commit: "HEAD" }] });
    assert.equal(first.json.passed, false, "after reset the pushed commit is gone, so a revert cannot fix it");
    const pass = await student.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }] });
    assert.deepEqual({ passed: pass.json.passed, saved: pass.json.saved, completed: pass.json.completed }, { passed: true, saved: true, completed: ["undo-pushed-commit"] });
    await student.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }] });
    const rows = server.db.prepare("SELECT count(*) AS n FROM simulation_progress").get() as { n: number };
    assert.equal(rows.n, 1, "repeating a challenge does not duplicate progress");
    const page = await student.get(GIT);
    assert.deepEqual(page.json.completed, ["undo-pushed-commit"]);
  });
  it("verifies time-based simulations too (Kubernetes)", async () => {
    const res = await student.post("/api/simulations/kubernetes-reconciliation/challenges/recover-broken-release/verify", { actions: [{ type: "undo" }, { type: "tick", count: 8 }] });
    assert.equal(res.json.passed, true);
    const stalled = await student.post("/api/simulations/kubernetes-reconciliation/challenges/recover-broken-release/verify", { actions: [{ type: "tick", count: 30 }] });
    assert.equal(stalled.json.passed, false, "waiting does not fix a broken image");
  });
  it("rejects actions the model does not accept, with the position of the bad one", async () => {
    const res = await student.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }, { type: "rm -rf /" }] });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "validation_failed");
    assert.equal(res.json.error.details[0].field, "actions.1");
    const extra = await student.post(UNDO, { actions: [{ type: "revert", commit: "HEAD", script: "alert(1)" }] });
    assert.equal(extra.status, 400, "unknown fields are rejected (strict schemas)");
  });
  it("limits how much work one verification may cost", async () => {
    const tooMany = await student.post(UNDO, { actions: Array.from({ length: 401 }, () => ({ type: "branch", name: "x" })) });
    assert.equal(tooMany.status, 400);
    const tooLong = await student.post("/api/simulations/kubernetes-reconciliation/challenges/self-heal/verify", { actions: Array.from({ length: 60 }, () => ({ type: "tick", count: 60 })) });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.json.error.message, /too long/);
    assert.equal((await student.post(UNDO, { actions: [] })).status, 400);
  });
  it("requires the CSRF header like every other write", async () => {
    const res = await student.request("POST", UNDO, { actions: [{ type: "revert", commit: "HEAD" }] }, { "x-devforge-csrf": "" });
    assert.equal(res.status, 403);
  });
});
