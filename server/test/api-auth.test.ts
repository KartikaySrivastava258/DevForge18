import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { FixedWindowLimiter } from "../src/http/rate-limit.ts";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const register = (c: Client, email: string, password = STRONG_PASSWORD, displayName = "Asha") =>
  c.post("/api/auth/register", { email, password, displayName });

describe("registration", () => {
  it("creates a student account and signs the user in with a hardened cookie", async () => {
    const c = new Client(server.url);
    const res = await register(c, "Asha@Example.edu");
    assert.equal(res.status, 201);
    assert.equal(res.json.user.email, "asha@example.edu", "email is normalised");
    assert.equal(res.json.user.role, "student", "self-registration can never grant faculty/admin");
    assert.equal(res.json.user.password_hash, undefined);
    assert.ok(!res.text.includes("scrypt$"));
    const cookie = res.setCookie[0] ?? "";
    assert.match(cookie, /^df_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const me = await c.get("/api/auth/me");
    assert.equal(me.json.user.email, "asha@example.edu");
  });

  it("ignores attempts to self-assign a role", async () => {
    const c = new Client(server.url);
    const res = await c.post("/api/auth/register", { email: "sneaky@example.edu", password: STRONG_PASSWORD, displayName: "S", role: "admin" });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.role, "student");
  });

  it("stores only a scrypt hash and a hashed session id", async () => {
    const row = server.db.prepare("SELECT password_hash FROM users WHERE email = ?").get("asha@example.edu") as { password_hash: string };
    assert.match(row.password_hash, /^scrypt\$14\$8\$1\$/);
    const c = new Client(server.url);
    await register(c, "token-check@example.edu");
    const token = decodeURIComponent(c.cookie.split("=")[1] ?? "");
    const sessions = server.db.prepare("SELECT id FROM sessions").all() as { id: string }[];
    assert.ok(sessions.length > 0);
    assert.ok(sessions.every((s) => s.id !== token && /^[0-9a-f]{64}$/.test(s.id)));
  });

  it("rejects weak passwords, bad emails and duplicate accounts with field details", async () => {
    const c = new Client(server.url);
    const weak = await register(c, "weak@example.edu", "short");
    assert.equal(weak.status, 400);
    assert.equal(weak.json.error.details[0].field, "password");
    assert.equal((await register(c, "common@example.edu", "password123")).status, 400);
    assert.equal((await register(c, "ravi@example.edu", "ravi-is-great-2026")).status, 400, "password containing email name");
    const badEmail = await register(c, "not-an-email");
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.json.error.details[0].field, "email");
    const dup = await register(c, "ASHA@example.edu");
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error.code, "email_taken");
  });

  it("rejects HTML/control characters in display names", async () => {
    const c = new Client(server.url);
    assert.equal((await register(c, "xss@example.edu", STRONG_PASSWORD, "<script>alert(1)</script>")).status, 400);
  });

  it("enforces content type, JSON validity and body size", async () => {
    const c = new Client(server.url);
    assert.equal((await c.post("/api/auth/register", "email=a", { "content-type": "application/x-www-form-urlencoded" })).status, 415);
    assert.equal((await c.post("/api/auth/register", "{not json")).status, 400);
    const huge = { email: "big@example.edu", password: STRONG_PASSWORD, displayName: "x".repeat(70 * 1024) };
    assert.equal((await c.post("/api/auth/register", huge)).status, 413);
  });
});

describe("CSRF protection", () => {
  it("blocks state-changing requests without the CSRF header", async () => {
    const c = new Client(server.url);
    const res = await c.post("/api/auth/login", { email: "a@b.co", password: "x" }, { "x-devforge-csrf": "0" });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "csrf_failed");
  });
  it("blocks cross-origin and cross-site requests even with the header", async () => {
    const c = new Client(server.url);
    assert.equal((await c.post("/api/auth/logout", undefined, { origin: "https://evil.example" })).status, 403);
    assert.equal((await c.post("/api/auth/logout", undefined, { "sec-fetch-site": "cross-site" })).status, 403);
  });
  it("allows same-origin requests", async () => {
    const c = new Client(server.url);
    const res = await c.post("/api/auth/logout", undefined, { origin: "http://localhost:8080", "sec-fetch-site": "same-origin" });
    assert.equal(res.status, 204);
  });
});

describe("login and logout", () => {
  before(() => server.createUser("lena@example.edu", STRONG_PASSWORD));

  it("uses one generic message for wrong password and unknown account", async () => {
    const c = new Client(server.url);
    const wrong = await c.post("/api/auth/login", { email: "lena@example.edu", password: "wrong password here" });
    const unknown = await c.post("/api/auth/login", { email: "nobody@example.edu", password: "wrong password here" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error.message, unknown.json.error.message);
  });

  it("issues a new session on login (no session fixation) and revokes it on logout", async () => {
    const c = new Client(server.url);
    await c.post("/api/auth/login", { email: "lena@example.edu", password: STRONG_PASSWORD });
    const first = c.cookie;
    await c.post("/api/auth/login", { email: "LENA@example.edu", password: STRONG_PASSWORD });
    const second = c.cookie;
    assert.notEqual(first, second);
    const stale = new Client(server.url);
    stale.cookie = first;
    assert.equal((await stale.get("/api/auth/me")).json.user, null, "old session was destroyed");

    const keep = c.cookie;
    const out = await c.post("/api/auth/logout");
    assert.equal(out.status, 204);
    assert.match(out.setCookie[0] ?? "", /Max-Age=0/);
    const replay = new Client(server.url);
    replay.cookie = keep;
    assert.equal((await replay.get("/api/auth/me")).json.user, null, "logged-out token cannot be replayed");
  });

  it("treats tampered or garbage session cookies as signed out", async () => {
    const c = new Client(server.url);
    for (const cookie of ["df_session=abc", "df_session=" + "A".repeat(43), "df_session=%E0%A4%A"]) {
      c.cookie = cookie;
      const res = await c.get("/api/auth/me");
      assert.equal(res.status, 200);
      assert.equal(res.json.user, null);
    }
  });

  it("rejects expired sessions", async () => {
    const c = new Client(server.url);
    await c.post("/api/auth/login", { email: "lena@example.edu", password: STRONG_PASSWORD });
    server.db.prepare("UPDATE sessions SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
    assert.equal((await c.get("/api/auth/me")).json.user, null);
  });

  it("refuses disabled accounts", async () => {
    await server.createUser("gone@example.edu", STRONG_PASSWORD);
    server.db.prepare("UPDATE users SET disabled_at = ? WHERE email = ?").run(new Date().toISOString(), "gone@example.edu");
    const res = await new Client(server.url).post("/api/auth/login", { email: "gone@example.edu", password: STRONG_PASSWORD });
    assert.equal(res.status, 401);
  });

  it("upgrades weaker password hashes after a successful login", async () => {
    const stronger = await startTestServer({ passwordHashLogN: 15 });
    try {
      await stronger.createUser("old@example.edu", STRONG_PASSWORD); // created at logN 14
      const res = await new Client(stronger.url).post("/api/auth/login", { email: "old@example.edu", password: STRONG_PASSWORD });
      assert.equal(res.status, 200);
      const row = stronger.db.prepare("SELECT password_hash FROM users WHERE email = ?").get("old@example.edu") as { password_hash: string };
      assert.match(row.password_hash, /^scrypt\$15\$/);
    } finally {
      await stronger.close();
    }
  });
});

describe("brute-force protection", () => {
  it("locks an account after repeated failures without blocking other accounts on the same IP", async () => {
    const limited = await startTestServer({}, {
      register: new FixedWindowLimiter(100, 60_000),
      loginByIp: new FixedWindowLimiter(100, 60_000),
      loginFailuresByEmail: new FixedWindowLimiter(3, 60_000),
      api: new FixedWindowLimiter(1000, 60_000),
    });
    try {
      await limited.createUser("target@example.edu", STRONG_PASSWORD);
      await limited.createUser("classmate@example.edu", STRONG_PASSWORD);
      const c = new Client(limited.url);
      for (let i = 0; i < 3; i++) {
        assert.equal((await c.post("/api/auth/login", { email: "target@example.edu", password: "guess " + i + " wrong" })).status, 401);
      }
      const locked = await c.post("/api/auth/login", { email: "target@example.edu", password: "another wrong guess" });
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("retry-after")) > 0);
      const classmate = await c.post("/api/auth/login", { email: "classmate@example.edu", password: STRONG_PASSWORD });
      assert.equal(classmate.status, 200, "a classmate behind the same NAT address can still sign in");
    } finally {
      await limited.close();
    }
  });

  it("rate-limits registrations per IP", async () => {
    const limited = await startTestServer({}, {
      register: new FixedWindowLimiter(2, 60_000),
      loginByIp: new FixedWindowLimiter(100, 60_000),
      loginFailuresByEmail: new FixedWindowLimiter(10, 60_000),
      api: new FixedWindowLimiter(1000, 60_000),
    });
    try {
      const c = new Client(limited.url);
      assert.equal((await register(c, "r1@example.edu")).status, 201);
      assert.equal((await register(c, "r2@example.edu")).status, 201);
      assert.equal((await register(c, "r3@example.edu")).status, 429);
    } finally {
      await limited.close();
    }
  });
});
