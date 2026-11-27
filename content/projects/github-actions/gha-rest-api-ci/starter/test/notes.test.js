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

// TODO: test creating, reading and deleting notes, and the validation rules in README.md.
