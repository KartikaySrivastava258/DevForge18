import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALLOWED, ClientRateLimit, EXAMPLES, explain, MAX_BODY_BYTES, prettyBody, validateRequest, type HeaderRow, type Method } from "./playground.ts";

const req = (method: Method, path: string, headers: HeaderRow[] = [], body = "") => validateRequest({ method, path, headers, body });
const reason = (v: ReturnType<typeof validateRequest>) => (v.ok ? "" : v.reason);

describe("request playground: which requests may be sent", () => {
  it("allows the catalogue, the learner's own reads and the two harmless writes", () => {
    for (const path of ["/api/health", "/api/tracks", "/api/tracks/kafka", "/api/tracks/kafka/quiz", "/api/search?q=docker", "/api/auth/me", "/api/me/bookmarks", "/api/me/progress", "/api/lessons/postman-http-basics"]) {
      assert.ok(req("GET", path).ok, path);
    }
    assert.ok(req("POST", "/api/lessons/postman-http-basics/check", [], "{}").ok);
    assert.ok(req("PUT", "/api/me/bookmarks/track/kafka").ok);
    const v = req("GET", "/api/tracks/kafka");
    assert.ok(v.ok && v.endpoint.pattern === "/api/tracks/:slug" && v.pathname === "/api/tracks/kafka");
  });

  it("only sends to DevForge's own API on this origin", () => {
    for (const path of ["https://example.com/api/health", "//example.com/api/health", "/static/app.js", "/metrics", "api/health", "/apix/health", " /api/../metrics"]) {
      assert.equal(req("GET", path).ok, false, path);
    }
    assert.match(reason(req("GET", "http://localhost/api/health")), /must start with \/api\//);
  });

  it("refuses dots, empty segments, escapes, fragments and odd query strings (no path tricks)", () => {
    for (const path of ["/api/../admin/users", "/api/./health", "/api//health", "/api/health/", "/api/%2e%2e/admin/users", "/api/tracks/ka%66ka", "/api/tracks/kafka#top", "/api/search?q=<script>", "/api/tracks/k.afka"]) {
      assert.equal(req("GET", path).ok, false, path);
    }
    assert.match(reason(req("GET", "/api//health")), /no empty parts, dots or % escapes/);
    assert.match(reason(req("GET", `/api/search?q=${"a".repeat(300)}`)), /under 300 characters/);
  });

  it("never allows administration, the content editor, account deletion, export or credentials", () => {
    assert.match(reason(req("GET", "/api/admin/users")), /Administration/);
    assert.match(reason(req("GET", "/api/admin")), /Administration/);
    assert.match(reason(req("GET", "/api/cms/status")), /content editor/);
    assert.match(reason(req("POST", "/api/me/delete", [], '{"password":"x"}')), /Account deletion/);
    assert.match(reason(req("GET", "/api/me/export")), /download/);
    assert.match(reason(req("POST", "/api/auth/login", [], "{}")), /password/);
    assert.match(reason(req("POST", "/api/auth/register", [], "{}")), /password/);
    assert.match(reason(req("GET", "/api/cohorts/abc")), /other people/);
    assert.match(reason(req("GET", "/api/reviews")), /other people/);
    assert.match(reason(req("GET", "/api/projects/docker-notes-api/solution")), /not on the playground's list/);
    assert.match(reason(req("GET", "/api/portfolio/someone")), /not on the playground's list/);
  });

  it("allows each path only with its own methods, and says which", () => {
    assert.match(reason(req("DELETE", "/api/me/bookmarks/track/kafka")), /on this path you can send PUT/);
    assert.match(reason(req("PUT", "/api/me/portfolio")), /on this path you can send GET/);
    assert.match(reason(req("POST", "/api/tracks/kafka")), /GET or DELETE/);
    assert.ok(req("DELETE", "/api/tracks/kafka").ok, "405 demonstration: the server has no DELETE handler");
    assert.equal(ALLOWED.filter((e) => e.kind === "write").length, 2);
    assert.ok(ALLOWED.every((e) => e.kind !== "read" || e.method === "GET"));
  });

  it("checks headers: names, values, duplicates and headers only the browser may set", () => {
    const csrf = { name: "X-DevForge-CSRF", value: "1" };
    assert.ok(req("PUT", "/api/me/bookmarks/track/kafka", [csrf, { name: "Accept", value: "application/json" }, { name: "", value: "" }]).ok, "blank rows are ignored");
    const v = req("PUT", "/api/me/bookmarks/track/kafka", [csrf]);
    assert.ok(v.ok && v.headers.length === 1 && v.headers[0]![0] === "X-DevForge-CSRF");
    assert.match(reason(req("GET", "/api/health", [{ name: "Cookie", value: "session=x" }])), /Send my session cookie/);
    for (const name of ["Host", "Origin", "Referer", "Sec-Fetch-Site", "X-Forwarded-For", "Content-Length", "Proxy-Authorization"]) {
      assert.match(reason(req("GET", "/api/health", [{ name, value: "x" }])), /set by the browser/, name);
    }
    assert.match(reason(req("GET", "/api/health", [{ name: "Bad Name", value: "x" }])), /not a valid header name/);
    assert.match(reason(req("GET", "/api/health", [{ name: "X-A", value: "line\nbreak" }])), /printable text/);
    assert.match(reason(req("GET", "/api/health", [csrf, { name: "x-devforge-csrf", value: "1" }])), /appears twice/);
    assert.match(reason(req("GET", "/api/health", Array.from({ length: 11 }, (_, i) => ({ name: `X-H${i}`, value: "1" })))), /at most 10/);
  });

  it("checks the body: none on GET, and a size cap above the server's own limit", () => {
    assert.match(reason(req("GET", "/api/health", [], "{}")), /GET request has no body/);
    assert.ok(req("POST", "/api/lessons/x/check", [], "not json at all").ok, "invalid JSON is allowed: the server's 400 is the lesson");
    assert.ok(req("POST", "/api/lessons/x/check", [], "x".repeat(70_000)).ok, "over 64 KB is allowed, so the server's 413 can be seen");
    assert.match(reason(req("POST", "/api/lessons/x/check", [], "x".repeat(MAX_BODY_BYTES + 1))), /under 100 KB/);
  });

  it("every example passes validation", () => {
    for (const e of EXAMPLES) assert.ok(validateRequest(e.request).ok, e.label);
  });
});

describe("request playground: what went wrong", () => {
  it("explains every 4xx the playground can meet, and the rest by family", () => {
    for (const status of [400, 401, 403, 404, 405, 409, 413, 415, 422, 429]) {
      const e = explain(status);
      assert.match(e.title, new RegExp(`^${status} [A-Z]`), String(status));
      assert.ok(e.text.length > 40, `${status} has an explanation`);
    }
    assert.match(explain(404).text, /does not exist/);
    assert.match(explain(401).text, /does not know who you are/);
    assert.match(explain(503).text, /server, not in your request/);
    assert.match(explain(418).text, /rejected something/);
    assert.equal(explain(200).text, "It worked.");
    assert.match(explain(204).text, /nothing to send back/);
  });

  it("uses DevForge's error code when it says more than the status", () => {
    assert.match(explain(403, "csrf_failed").text, /X-DevForge-CSRF: 1/);
    assert.match(explain(403, "csrf_failed").title, /csrf_failed/);
    assert.match(explain(403, "forbidden").text, /your role/);
    assert.match(explain(400, "invalid_json").text, /double quotes/);
    assert.match(explain(400, "validation_failed").text, /details/);
    assert.match(explain(415, "unsupported_media_type").text, /Content-Type: application\/json/);
    assert.match(explain(413, "payload_too_large").text, /64 KB/);
    assert.match(explain(429, "rate_limited").text, /Retry-After/);
    assert.match(explain(401, "unauthenticated").text, /Send my session cookie/);
    assert.equal(explain(404, "not_found").title, "404 Not Found", "an unremarkable code falls back to the status");
  });
});

describe("request playground: client-side rate limit and body display", () => {
  it("allows 20 requests in any minute, then says how long to wait", () => {
    const limit = new ClientRateLimit(20, 60_000);
    for (let i = 0; i < 20; i++) assert.ok(limit.take(1_000 + i * 100).allowed, `request ${i + 1}`);
    const refused = limit.take(5_000);
    assert.equal(refused.allowed, false);
    assert.equal(refused.retryAfterSeconds, 56, "the first request leaves the window at 61 s");
    assert.equal(limit.remaining(5_000), 0);
    assert.ok(limit.take(61_000).allowed, "a minute after the first request, one slot frees up");
    assert.equal(limit.remaining(61_000), 0);
    assert.equal(limit.remaining(200_000), 20);
  });

  it("pretty-prints JSON, leaves other text alone and cuts very long bodies", () => {
    assert.deepEqual(prettyBody('{"a":1}'), { text: '{\n  "a": 1\n}', json: true, truncated: false, length: 12 });
    assert.equal(prettyBody("Not found").json, false);
    assert.equal(prettyBody("").text, "");
    const long = prettyBody("x".repeat(30), 10);
    assert.equal(long.truncated, true);
    assert.equal(long.text, `${"x".repeat(10)}\n…`);
  });
});
