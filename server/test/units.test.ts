import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPrivateAddress } from "../src/app.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../src/auth/password.ts";
import { loadConfig } from "../src/config.ts";
import { migrate, openDatabase } from "../src/db/database.ts";
import { parseCookies, serializeCookie } from "../src/http/cookies.ts";
import { FixedWindowLimiter } from "../src/http/rate-limit.ts";
import { Router } from "../src/http/router.ts";
import { createLogger } from "../src/observability/logger.ts";

describe("password hashing", () => {
  it("verifies correct passwords, rejects wrong ones and uses unique salts", async () => {
    const a = await hashPassword("a long passphrase", 14);
    const b = await hashPassword("a long passphrase", 14);
    assert.notEqual(a, b);
    assert.deepEqual(await verifyPassword("a long passphrase", a, 14), { ok: true, needsRehash: false });
    assert.equal((await verifyPassword("A long passphrase", a, 14)).ok, false);
    assert.equal((await verifyPassword("x", "garbage", 14)).ok, false);
    assert.equal((await verifyPassword("x", "scrypt$99$8$1$aa$bb", 14)).ok, false);
    assert.equal((await verifyPassword("a long passphrase", a, 16)).needsRehash, true);
  });
  it("applies the password policy", () => {
    assert.match(passwordProblem("short", "a@b.co") ?? "", /at least 10/);
    assert.match(passwordProblem("aaaaaaaaaaaa", "a@b.co") ?? "", /repetitive/);
    assert.equal(passwordProblem("correct horse battery staple", "a@b.co"), null);
  });
});

describe("migrations", () => {
  it("are idempotent and detect edited migrations", () => {
    const db = openDatabase(":memory:");
    const first = migrate(db);
    assert.deepEqual(first.applied, ["0001_initial.sql", "0002_simulation_progress.sql", "0003_lab_progress.sql", "0004_quiz_attempts.sql", "0005_architecture_decisions.sql"]);
    assert.equal(migrate(db).applied.length, 0);
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    try {
      writeFileSync(join(dir, "0001_initial.sql"), "-- edited\nSELECT 1;");
      assert.throws(() => migrate(db, dir), /was modified after being applied/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });
  it("enforces foreign keys and check constraints", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    assert.throws(() =>
      db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('x','missing','t','t','t')").run(),
    );
    assert.throws(() =>
      db.prepare("INSERT INTO users (id,email,display_name,password_hash,role,created_at,updated_at) VALUES ('1','a@b','a','h','superuser','t','t')").run(),
    );
    // Simulation progress belongs to a real user and records at least one action.
    assert.throws(() =>
      db.prepare("INSERT INTO simulation_progress (user_id,simulation_id,challenge_id,track_slug,actions,completed_at) VALUES ('missing','s','c','t',1,'t')").run(),
    );
    db.prepare("INSERT INTO users (id,email,display_name,password_hash,role,created_at,updated_at) VALUES ('u1','u@b','u','h','student','t','t')").run();
    assert.throws(() =>
      db.prepare("INSERT INTO simulation_progress (user_id,simulation_id,challenge_id,track_slug,actions,completed_at) VALUES ('u1','s','c','t',0,'t')").run(),
    );
    db.close();
  });
  it("rolls back a failing migration completely", () => {
    const db = openDatabase(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    try {
      writeFileSync(join(dir, "0001_bad.sql"), "CREATE TABLE half (a INTEGER) STRICT; INSERT INTO nope VALUES (1);");
      assert.throws(() => migrate(db, dir));
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get(), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  });
});

describe("configuration", () => {
  it("applies safe defaults", () => {
    const c = loadConfig({});
    assert.equal(c.port, 8080);
    assert.equal(c.cookieSecure, false);
    assert.equal(c.passwordHashLogN, 17);
    assert.strictEqual(c.trustProxy, false, "TRUST_PROXY must default to false (security)");
    assert.strictEqual(loadConfig({ TRUST_PROXY: "false" }).trustProxy, false);
    assert.strictEqual(loadConfig({ TRUST_PROXY: "true" }).trustProxy, true);
    assert.equal(loadConfig({ NODE_ENV: "production" }).cookieSecure, true);
  });
  it("rejects invalid or unsafe values", () => {
    assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
    assert.throws(() => loadConfig({ PASSWORD_HASH_LOG_N: "10" }), /PASSWORD_HASH_LOG_N/);
    assert.throws(
      () => loadConfig({ NODE_ENV: "production", PUBLIC_ORIGIN: "https://devforge.example.edu", COOKIE_SECURE: "false" }),
      /COOKIE_SECURE/,
    );
  });
});

describe("router", () => {
  const router = new Router();
  router.get("/api/tracks/:slug", () => ({ status: 200 }));
  it("matches params, falls through HEAD to GET and reports 405", () => {
    const m = router.match("GET", "/api/tracks/docker");
    assert.ok(m && m !== "method_not_allowed");
    assert.equal(m.params.slug, "docker");
    assert.ok(router.match("HEAD", "/api/tracks/docker"));
    assert.equal(router.match("POST", "/api/tracks/docker"), "method_not_allowed");
    assert.equal(router.match("GET", "/api/tracks"), undefined);
  });
  it("rejects unsafe parameter values", () => {
    for (const bad of ["..", "%2e%2e", "a%2Fb", "-x", "%ZZ", "a b"]) assert.equal(router.match("GET", `/api/tracks/${bad}`), undefined, bad);
  });
});

describe("small utilities", () => {
  it("parses and serialises cookies", () => {
    const m = parseCookies("a=1; b=hello%20world; a=2; bad");
    assert.equal(m.get("a"), "1");
    assert.equal(m.get("b"), "hello world");
    assert.equal(serializeCookie("s", "v", { maxAgeSeconds: 60, secure: true }), "s=v; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax");
  });
  it("fixed-window limiter allows, blocks and resets", () => {
    let now = 0;
    const l = new FixedWindowLimiter(2, 1000, () => now);
    assert.equal(l.hit("k").allowed, true);
    assert.equal(l.hit("k").allowed, true);
    const blocked = l.hit("k");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    now = 1000;
    assert.equal(l.hit("k").allowed, true);
  });
  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.1", "::ffff:10.0.0.1", "fd12:3456::1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["8.8.8.8", "172.32.0.1", "203.0.113.5", "2001:db8::1"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  it("logger redacts sensitive keys", () => {
    const lines: string[] = [];
    createLogger("debug", (l) => lines.push(l)).info("x", { password: "p", sessionToken: "t", route: "/api" });
    const entry = JSON.parse(lines[0] ?? "{}");
    assert.equal(entry.password, "[redacted]");
    assert.equal(entry.sessionToken, "[redacted]");
    assert.equal(entry.route, "/api");
  });
});
