import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createApp } from "../src/app.js";

let server;
let base;
// A fresh server per test keeps the tests independent: notes created in one test never leak into another.
beforeEach(async () => {
  server?.close();
  server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const post = (body) => fetch(`${base}/api/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("GET /health answers ok", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("GET /api/notes starts empty", async () => {
  const res = await fetch(`${base}/api/notes`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("POST /api/notes creates a note: 201, a Location header and the stored note", async () => {
  const res = await post({ title: "  Week 3: HTTP  ", body: "Status codes" });
  assert.equal(res.status, 201);
  const note = await res.json();
  assert.deepEqual(note, { id: 1, title: "Week 3: HTTP", body: "Status codes" });
  assert.equal(res.headers.get("location"), "/api/notes/1");
  assert.deepEqual(await (await fetch(`${base}/api/notes`)).json(), [note]);
});

test("POST /api/notes rejects a missing, blank or whitespace-only title with 400", async () => {
  for (const body of [{}, { title: "" }, { title: "   " }, { title: "\t\n" }, { title: 42 }]) {
    const res = await post(body);
    assert.equal(res.status, 400, `title ${JSON.stringify(body.title)} should be rejected`);
    assert.ok((await res.json()).error);
  }
  assert.deepEqual(await (await fetch(`${base}/api/notes`)).json(), [], "nothing was stored");
});

test("POST /api/notes accepts 120 characters and rejects 121", async () => {
  assert.equal((await post({ title: "x".repeat(120) })).status, 201);
  assert.equal((await post({ title: "x".repeat(121) })).status, 400);
});

test("POST /api/notes rejects invalid JSON with 400", async () => {
  assert.equal((await post("{not json")).status, 400);
});

test("GET /api/notes/:id returns the note, or 404 for an unknown id", async () => {
  const created = await (await post({ title: "Exam dates" })).json();
  const found = await fetch(`${base}/api/notes/${created.id}`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), created);
  assert.equal((await fetch(`${base}/api/notes/999`)).status, 404);
});

test("DELETE /api/notes/:id removes the note (204), then answers 404", async () => {
  const created = await (await post({ title: "Old note" })).json();
  assert.equal((await fetch(`${base}/api/notes/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/api/notes/${created.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/notes/${created.id}`, { method: "DELETE" })).status, 404);
});
