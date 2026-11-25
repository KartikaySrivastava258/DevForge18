import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer, testContent } from "./helpers.ts";

const LESSON = "docker-images-vs-containers";
const ALL_RIGHT = { "shared-writes": "b", "stop-vs-remove": "a", "rebuild-running": "b", "latest-tag": "b" };
const ONE_WRONG = { ...ALL_RIGHT, "latest-tag": "a" };

let server: TestServer;
let student: Client;
before(async () => {
  server = await startTestServer();
  await server.createUser("stu@example.edu", STRONG_PASSWORD);
  await server.createUser("other@example.edu", STRONG_PASSWORD);
  student = new Client(server.url);
  await student.post("/api/auth/login", { email: "stu@example.edu", password: STRONG_PASSWORD });
});
after(() => server.close());

describe("lesson self-check", () => {
  it("requires every question to be answered", async () => {
    const res = await student.post(`/api/lessons/${LESSON}/check`, { answers: { "shared-writes": "b" } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.details.length, 3);
  });

  it("does not reveal explanations for wrong answers", async () => {
    const res = await student.post(`/api/lessons/${LESSON}/check`, { answers: ONE_WRONG });
    assert.equal(res.status, 200);
    assert.equal(res.json.passed, false);
    assert.equal(res.json.correct, 3);
    const wrong = res.json.results.find((r: { id: string }) => r.id === "latest-tag");
    assert.equal(wrong.correct, false);
    assert.equal(wrong.explanation, undefined);
    assert.ok(res.json.results.filter((r: { correct: boolean }) => r.correct).every((r: { explanation?: string }) => r.explanation));
    assert.equal(res.json.progress.status, "in_progress");
  });

  it("completes the lesson only when every answer is right, and keeps it completed", async () => {
    const pass = await student.post(`/api/lessons/${LESSON}/check`, { answers: ALL_RIGHT });
    assert.equal(pass.json.passed, true);
    assert.equal(pass.json.saved, true);
    assert.equal(pass.json.progress.status, "completed");
    assert.equal(pass.json.progress.bestScore, 1);
    assert.ok(pass.json.progress.completedAt);
    const completedAt = pass.json.progress.completedAt;

    const later = await student.post(`/api/lessons/${LESSON}/check`, { answers: ONE_WRONG });
    assert.equal(later.json.progress.status, "completed", "a later failed retry never un-completes");
    assert.equal(later.json.progress.bestScore, 1);
    assert.equal(later.json.progress.completedAt, completedAt);
    assert.equal(later.json.progress.attempts, 3);
  });

  it("lets anonymous visitors practise without saving progress", async () => {
    const res = await new Client(server.url).post(`/api/lessons/${LESSON}/check`, { answers: ALL_RIGHT });
    assert.equal(res.status, 200);
    assert.equal(res.json.passed, true);
    assert.equal(res.json.saved, false);
  });

  it("rejects malformed answers and unknown lessons", async () => {
    assert.equal((await student.post(`/api/lessons/${LESSON}/check`, { answers: { "shared-writes": "<b>" } })).status, 400);
    assert.equal((await student.post("/api/lessons/nope/check", { answers: {} })).status, 404);
  });
});

describe("progress", () => {
  it("requires sign-in to record a started lesson", async () => {
    assert.equal((await new Client(server.url).post(`/api/lessons/${LESSON}/start`)).status, 401);
  });

  it("records 'in progress' without counting it as completion", async () => {
    const other = new Client(server.url);
    await other.post("/api/auth/login", { email: "other@example.edu", password: STRONG_PASSWORD });
    const start = await other.post(`/api/lessons/${LESSON}/start`);
    assert.equal(start.json.progress.status, "in_progress");
    const progress = await other.get("/api/me/progress");
    assert.equal(progress.json.totals.lessonsCompleted, 0);
    assert.equal(progress.json.totals.lessonsInProgress, 1);
  });

  it("summarises completion per track for the signed-in user only", async () => {
    const res = await student.get("/api/me/progress");
    assert.equal(res.status, 200);
    assert.equal(res.json.totals.lessonsCompleted, 1);
    const docker = res.json.tracks.find((t: { slug: string }) => t.slug === "docker");
    assert.deepEqual([docker.completed, docker.total], [1, testContent().lessonsFor("docker").length]);
    assert.equal(res.json.recent[0].title, "Images vs Containers");
    assert.equal((await new Client(server.url).get("/api/me/progress")).status, 401);
  });
});

describe("bookmarks", () => {
  it("adds idempotently, lists with titles and removes", async () => {
    assert.equal((await student.request("PUT", "/api/me/bookmarks/track/kafka")).status, 200);
    assert.equal((await student.request("PUT", "/api/me/bookmarks/track/kafka")).status, 200);
    assert.equal((await student.request("PUT", `/api/me/bookmarks/lesson/${LESSON}`)).status, 200);
    const list = await student.get("/api/me/bookmarks");
    assert.equal(list.json.bookmarks.length, 2);
    assert.ok(list.json.bookmarks.some((b: { url: string }) => b.url === "/tracks/kafka"));
    assert.equal((await student.request("DELETE", "/api/me/bookmarks/track/kafka")).status, 204);
    assert.equal((await student.get("/api/me/bookmarks")).json.bookmarks.length, 1);
  });

  it("validates type and existence, and isolates users", async () => {
    assert.equal((await student.request("PUT", "/api/me/bookmarks/video/x")).status, 400);
    assert.equal((await student.request("PUT", "/api/me/bookmarks/track/cobol")).status, 404);
    const other = new Client(server.url);
    await other.post("/api/auth/login", { email: "other@example.edu", password: STRONG_PASSWORD });
    assert.equal((await other.get("/api/me/bookmarks")).json.bookmarks.length, 0);
  });
});
