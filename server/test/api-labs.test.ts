import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, testContent, type TestServer } from "./helpers.ts";

const LOCAL = "git-resolve-a-merge-conflict";
const SIM = "kubernetes-self-healing-and-rollouts";

let server: TestServer;
let student: Client;
let anonymous: Client;
before(async () => {
  server = await startTestServer();
  await server.createUser("lab@example.edu", STRONG_PASSWORD);
  student = new Client(server.url);
  anonymous = new Client(server.url);
  await student.post("/api/auth/login", { email: "lab@example.edu", password: STRONG_PASSWORD });
});
after(() => server.close());

describe("lab content API", () => {
  it("returns a lab with its checkpoints and prerequisites", async () => {
    const res = await anonymous.get(`/api/labs/${LOCAL}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.lab.mode, "local");
    assert.ok(res.json.lab.checkpoints.length >= 1);
    assert.equal(res.json.lab.prerequisites[0].id, "git-first-commits");
    assert.match(res.json.lab.html, /All checks passed/);
    assert.equal(res.json.progress, null);
  });
  it("lists published labs on the track", async () => {
    const res = await anonymous.get("/api/tracks/git-github");
    assert.ok(res.json.labs.some((l: { id: string }) => l.id === LOCAL));
    assert.ok(res.json.track.labs.some((l: { lab?: string; status: string }) => l.lab === LOCAL && l.status === "available"));
  });
  it("never sends read-through answers to the browser", async () => {
    const content = testContent();
    for (const track of content.listTracks())
      for (const lab of content.labsFor(track.slug).filter((l) => l.mode === "read-through")) {
        const res = await anonymous.get(`/api/labs/${lab.id}`);
        assert.ok(!/"answer"|"explanation"/.test(res.text), lab.id);
      }
  });
  it("404s for unknown labs", async () => {
    assert.equal((await anonymous.get("/api/labs/nope")).status, 404);
    assert.equal((await student.post("/api/labs/nope/complete", {})).status, 404);
  });
});

describe("completing labs", () => {
  it("requires an account", async () => {
    assert.equal((await anonymous.post(`/api/labs/${LOCAL}/complete`, { checkpoints: [] })).status, 401);
  });
  it("records a local lab as self-reported only when every checkpoint is ticked", async () => {
    const lab = testContent().getLab(LOCAL);
    assert.ok(lab);
    const some = await student.post(`/api/labs/${LOCAL}/complete`, { checkpoints: [lab.checkpoints[0]?.id] });
    assert.equal(some.status, 400);
    const all = await student.post(`/api/labs/${LOCAL}/complete`, { checkpoints: lab.checkpoints.map((c) => c.id) });
    assert.equal(all.status, 200);
    assert.equal(all.json.progress.evidence, "self-reported");
    assert.equal((await student.get(`/api/labs/${LOCAL}`)).json.progress.evidence, "self-reported");
    assert.ok((await student.get("/api/me/labs")).json.labs.some((l: { labId: string }) => l.labId === LOCAL));
  });
  it("completes a simulation lab only after the server has verified its challenges", async () => {
    const content = testContent();
    const lab = content.getLab(SIM);
    assert.ok(lab?.simulation);
    const early = await student.post(`/api/labs/${SIM}/complete`, {});
    assert.equal(early.status, 409);
    const sim = content.getSimulation(lab.simulation.id);
    assert.ok(sim);
    for (const id of lab.simulation.challenges) {
      const challenge: { solution: unknown[] } | undefined = sim.challenges.find((c) => c.id === id);
      assert.ok(challenge, id);
      const v = await student.post(`/api/simulations/${sim.id}/challenges/${id}/verify`, { actions: challenge.solution });
      assert.equal(v.json.passed, true, id);
    }
    assert.deepEqual((await student.get(`/api/labs/${SIM}`)).json.challengesDone.sort(), [...lab.simulation.challenges].sort());
    const done = await student.post(`/api/labs/${SIM}/complete`, {});
    assert.equal(done.status, 200);
    assert.equal(done.json.progress.evidence, "verified");
  });
});
