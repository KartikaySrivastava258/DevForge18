import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer;
let client: Client;
before(async () => {
  server = await startTestServer();
  client = new Client(server.url);
});
after(() => server.close());

describe("system endpoints", () => {
  it("reports health and readiness", async () => {
    assert.deepEqual((await client.get("/api/health")).json, { status: "ok" });
    const ready = await client.get("/api/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.json.tracks, 18);
  });

  it("sends security headers on every response", async () => {
    for (const path of ["/api/health", "/", "/tracks/docker"]) {
      const res = await client.get(path);
      const csp = res.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'self'/, path);
      assert.match(csp, /frame-ancestors 'none'/, path);
      assert.ok(!csp.includes("unsafe-inline"), path);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
      assert.ok(res.headers.get("x-request-id"), path);
    }
  });

  it("marks API responses as non-cacheable", async () => {
    assert.equal((await client.get("/api/tracks")).headers.get("cache-control"), "no-store");
  });

  it("returns JSON errors for unknown endpoints and wrong methods", async () => {
    const missing = await client.get("/api/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, "not_found");
    assert.ok(missing.json.error.requestId);
    const wrong = await client.request("DELETE", "/api/tracks");
    assert.equal(wrong.status, 405);
  });
});

describe("content API", () => {
  it("lists all 18 tracks with categories", async () => {
    const res = await client.get("/api/tracks");
    assert.equal(res.status, 200);
    assert.equal(res.json.tracks.length, 18);
    assert.equal(res.json.categories.length, 7);
    const docker = res.json.tracks.find((t: { slug: string }) => t.slug === "docker");
    assert.equal(docker.lessonCount, 2);
    assert.deepEqual(docker.products, ["Docker Engine", "Docker Compose"]);
  });

  it("returns a full track with lessons, related tracks and paths", async () => {
    const res = await client.get("/api/tracks/docker");
    assert.equal(res.status, 200);
    assert.equal(res.json.track.slug, "docker");
    assert.equal(res.json.lessons[0].id, "docker-images-vs-containers");
    assert.ok(res.json.related.some((r: { track: { slug: string } }) => r.track.slug === "kubernetes"));
    assert.ok(res.json.paths.some((p: { slug: string }) => p.slug === "backend-foundations"));
  });

  it("returns 404 for unknown tracks and rejects path-like parameters", async () => {
    assert.equal((await client.get("/api/tracks/cobol")).status, 404);
    assert.equal((await client.get("/api/tracks/..%2F..%2Fetc")).status, 404);
    assert.equal((await client.get("/api/tracks/a%00b")).status, 404);
  });

  it("returns learning paths with computed time estimates", async () => {
    const list = await client.get("/api/paths");
    assert.equal(list.json.paths.length, 8);
    const one = await client.get("/api/paths/backend-foundations");
    assert.equal(one.json.modules.length, 6);
    assert.ok(one.json.estimatedHours.min > 0 && one.json.estimatedHours.max >= one.json.estimatedHours.min);
  });

  it("never sends self-check answers or explanations to the browser", async () => {
    const res = await client.get("/api/lessons/docker-images-vs-containers");
    assert.equal(res.status, 200);
    assert.ok(res.json.lesson.html.includes("<h2"));
    assert.ok(res.json.lesson.selfCheck.length >= 2);
    for (const q of res.json.lesson.selfCheck) {
      assert.equal(q.answer, undefined);
      assert.equal(q.explanation, undefined);
    }
    assert.ok(!res.text.includes('"answer"'));
  });

  it("searches with typo tolerance and validates parameters", async () => {
    const res = await client.get("/api/search?q=kuberntes");
    assert.equal(res.json.results[0].id, "kubernetes");
    const typed = await client.get("/api/search?q=docker&type=path,bogus&limit=2");
    assert.ok(typed.json.results.length <= 2);
    assert.ok(typed.json.results.every((r: { type: string }) => r.type === "path"));
    assert.deepEqual((await client.get("/api/search?q=")).json.results, []);
  });
});

describe("static frontend serving", () => {
  it("serves index.html for client-side routes (SPA fallback) with no-cache", async () => {
    const res = await client.get("/tracks/docker");
    assert.equal(res.status, 200);
    assert.match(res.text, /DevForge test shell/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await client.get("/assets/app-abc123.js");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  });

  it("does not serve files outside the web root", async () => {
    for (const path of ["/..%2f..%2f..%2fetc%2fpasswd", "/assets/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/etc/passwd"]) {
      const res = await client.get(path);
      assert.ok(!res.text.includes("root:"), path);
      assert.ok(!res.text.includes('"devforge18"'), path);
    }
    assert.equal((await client.get("/missing.js")).status, 404);
  });
});

describe("metrics", () => {
  it("exposes Prometheus metrics to local scrapers with route patterns, not raw URLs", async () => {
    await client.get("/api/tracks/docker");
    const res = await client.get("/metrics");
    assert.equal(res.status, 200);
    assert.match(res.text, /devforge_http_requests_total\{method="GET",route="\/api\/tracks\/:slug",status="200"\}/);
    assert.ok(!res.text.includes('route="/api/tracks/docker"'));
    assert.match(res.text, /devforge_http_request_duration_seconds_bucket/);
  });

  it("hides metrics from public clients behind a trusted proxy", async () => {
    const proxied = await startTestServer({ trustProxy: true });
    try {
      const pub = await new Client(proxied.url).get("/metrics", { "x-forwarded-for": "203.0.113.9" });
      assert.equal(pub.status, 404);
      const internal = await new Client(proxied.url).get("/metrics", { "x-forwarded-for": "203.0.113.9, 10.0.0.5" });
      assert.equal(internal.status, 200);
    } finally {
      await proxied.close();
    }
  });
});
