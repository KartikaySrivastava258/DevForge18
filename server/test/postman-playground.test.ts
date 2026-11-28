/**
 * The Postman request playground's allowlist (shared/simulations/postman/playground.ts) checked against the real
 * router and a real server: every allowed request reaches the route it was chosen for, no role-restricted or
 * unlisted route can be reached through it, and the "405" entries really have no handler.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ALLOWED, EXAMPLES, validateRequest, type Method } from "../../shared/simulations/postman/playground.ts";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

/** Real ids for each route parameter, so the live requests reach real content. */
const SAMPLE: Record<string, Record<string, string>> = {
  "/api/tracks/:slug": { slug: "postman" },
  "/api/tracks/:slug/quiz": { slug: "postman" },
  "/api/tracks/:slug/projects": { slug: "docker" },
  "/api/paths/:slug": { slug: "backend-foundations" },
  "/api/lessons/:id": { id: "postman-http-basics" },
  "/api/labs/:id": { id: "postman-status-codes-and-sessions" },
  "/api/simulations/:id": { id: "postman-request-builder" },
  "/api/projects/:id": { id: "docker-notes-api" },
  "/api/capstones/:id": { id: "capstone-a" },
  "/api/architectures/:id": { id: "web-app-with-cache" },
  "/api/integrations/:id": { id: "docker-to-nginx" },
  "/api/lessons/:id/check": { id: "postman-http-basics" },
  "/api/me/bookmarks/:type/:id": { type: "track", id: "postman" },
};
const concrete = (pattern: string, params = SAMPLE[pattern] ?? {}) => pattern.replace(/:(\w+)/g, (_, name: string) => params[name] ?? "sample-id");
const asRequest = (method: string, path: string) => ({ method: method as Method, path, headers: [], body: "" });

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

describe("request playground: allowlist against the route table", () => {
  it("every allowed request reaches the route it was chosen for, and never a role-restricted one", () => {
    for (const e of ALLOWED) {
      const path = concrete(e.pattern);
      assert.ok(validateRequest(asRequest(e.method, path)).ok, `${e.method} ${path} passes validation`);
      const m = server.app.router.match(e.method, path);
      if (e.kind === "unrouted") {
        assert.equal(m, "method_not_allowed", `${e.method} ${e.pattern} must have no handler (the playground uses it to show a 405)`);
        continue;
      }
      assert.ok(m && m !== "method_not_allowed", `${e.method} ${e.pattern} is a route`);
      assert.equal(m.route.pattern, e.pattern);
      assert.equal(m.route.method, e.kind === "read" ? "GET" : e.method);
      assert.ok(!Array.isArray(m.route.options.auth), `${e.pattern} is not limited to staff or admins`);
      assert.equal(m.route.options.auth === "user", Boolean(e.personal), `${e.pattern}: personal flag matches the route's sign-in requirement`);
    }
  });

  it("no other route can be reached through the playground", () => {
    const allowed = new Set(ALLOWED.map((e) => `${e.method} ${e.pattern}`));
    const reachable = server.app.router.list().filter((r) => validateRequest(asRequest(r.method, concrete(r.pattern))).ok);
    assert.ok(reachable.length >= 30);
    for (const r of reachable) assert.ok(allowed.has(`${r.method} ${r.pattern}`), `${r.method} ${r.pattern} is reachable but not on the allowlist`);
    // Every route limited to staff or admins is refused before sending, whatever the ids.
    for (const r of server.app.router.list().filter((x) => Array.isArray(x.options.auth))) {
      assert.equal(validateRequest(asRequest(r.method, concrete(r.pattern))).ok, false, `${r.method} ${r.pattern}`);
    }
    // The only writes are the self-check and bookmarking.
    assert.deepEqual(reachable.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.pattern}`).sort(), ["POST /api/lessons/:id/check", "PUT /api/me/bookmarks/:type/:id"]);
  });

  it("refuses destructive, administrative and credential endpoints with a reason", () => {
    for (const [method, path, reason] of [
      ["POST", "/api/me/delete", /Account deletion/],
      ["GET", "/api/me/export", /download/],
      ["GET", "/api/admin/users", /Administration/],
      ["PATCH", "/api/admin/users/1/role", /Administration/],
      ["GET", "/api/cms/files", /content editor/],
      ["POST", "/api/auth/login", /password/],
      ["POST", "/api/auth/logout", /signing out/],
      ["GET", "/api/cohorts", /other people/],
      ["GET", "/api/projects/docker-notes-api/solution", /not on the playground's list/],
      ["DELETE", "/api/me/bookmarks/track/postman", /not allowed in the playground/],
      ["PUT", "/api/me/portfolio", /not allowed in the playground/],
      ["POST", "/api/tracks/postman/quiz/grade", /not on the playground's list/],
    ] as const) {
      const v = validateRequest(asRequest(method, path));
      assert.equal(v.ok, false, `${method} ${path}`);
      if (!v.ok) assert.match(v.reason, reason, `${method} ${path}`);
    }
  });
});

describe("request playground: the allowed requests against a real server", () => {
  it("public reads answer 200; personal reads answer 401 signed out and 200 signed in", async () => {
    await server.createUser("playground@example.edu", STRONG_PASSWORD);
    const anonymous = new Client(server.url);
    const learner = new Client(server.url);
    assert.equal((await learner.post("/api/auth/login", { email: "playground@example.edu", password: STRONG_PASSWORD })).status, 200);
    for (const e of ALLOWED.filter((x) => x.kind === "read")) {
      const path = e.pattern === "/api/search" ? "/api/search?q=postman" : concrete(e.pattern);
      assert.equal((await anonymous.get(path)).status, e.personal ? 401 : 200, `signed out: GET ${path}`);
      assert.equal((await learner.get(path)).status, 200, `signed in: GET ${path}`);
    }
  });

  it("the examples give the answers their labels promise", async () => {
    const learner = new Client(server.url);
    await server.createUser("examples@example.edu", STRONG_PASSWORD);
    await learner.post("/api/auth/login", { email: "examples@example.edu", password: STRONG_PASSWORD });
    const expected: Record<string, number> = {
      "Health check (200)": 200,
      "Who am I?": 200,
      "My bookmarks (401 if signed out)": 200,
      "A track that does not exist (404)": 404,
      "Wrong method (405)": 405,
      "Self-check with a missing answer (400)": 400,
      "Bookmark the Postman track": 200,
    };
    for (const { label, request } of EXAMPLES) {
      const v = validateRequest(request);
      assert.ok(v.ok, label);
      if (!v.ok) continue;
      const headers = Object.fromEntries(v.headers.map(([n, val]) => [n.toLowerCase(), val]));
      const res = await learner.request(request.method, request.path, request.body || undefined, headers);
      assert.equal(res.status, expected[label], `${label}: ${res.text}`);
    }
    // The same write without the CSRF header is refused before the handler runs.
    const noCsrf = await learner.request("PUT", "/api/me/bookmarks/track/postman", undefined, { "x-devforge-csrf": "" });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error.code, "csrf_failed");
  });
});
