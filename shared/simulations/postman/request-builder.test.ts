import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { ENDPOINTS, requestBuilder as model, type BuilderAction, type Body } from "./request-builder.ts";
import { BuilderActionSchema, BuilderScenarioSchema } from "./schema.ts";

const at = (path: string, method?: string) => ENDPOINTS.findIndex((e) => e.path === path && (!method || e.method === method));
const send = (path: string, opts: { csrf?: boolean; cookie?: boolean; body?: Body; method?: string } = {}): BuilderAction => ({
  type: "send",
  request: { endpoint: at(path, opts.method), csrf: opts.csrf ?? false, cookie: opts.cookie ?? false, body: opts.body ?? "none" },
});
const statuses = (actions: BuilderAction[], signedIn = false) => replay(model, { signedIn }, actions).state.history.map((h) => h.response.status);

describe("request builder: matches DevForge's API", () => {
  it("public reads work without anything; unknown tracks are 404", () => {
    assert.deepEqual(statuses([send("/api/health"), send("/api/tracks/kafka"), send("/api/tracks/no-such-track")]), [200, 200, 404]);
  });
  it("writes need the CSRF header (403), then valid JSON (400), then the right password (401)", () => {
    assert.deepEqual(statuses([send("/api/auth/login", { body: "valid login" }), send("/api/auth/login", { csrf: true, body: "not JSON" }), send("/api/auth/login", { csrf: true, body: "wrong password" }), send("/api/auth/login", { csrf: true, body: "valid login" })]), [403, 400, 401, 200]);
  });
  it("personal endpoints need the session cookie from signing in", () => {
    assert.deepEqual(statuses([send("/api/me/bookmarks"), send("/api/auth/login", { csrf: true, body: "valid login" }), send("/api/me/bookmarks"), send("/api/me/bookmarks", { cookie: true })]), [401, 200, 401, 200]);
  });
  it("after signing out, the old cookie no longer works", () => {
    assert.deepEqual(statuses([send("/api/auth/logout", { csrf: true, cookie: true }), send("/api/me/bookmarks", { cookie: true })], true), [204, 401]);
  });
});

describe("request builder: challenges, invariants and schemas", () => {
  const FLOW = [send("/api/auth/login", { csrf: true, body: "valid login" }), send("/api/me/bookmarks/track/kafka", { csrf: true, cookie: true }), send("/api/me/bookmarks", { cookie: true })];
  it("bookmark-saved needs sign-in, CSRF and the cookie", () => {
    const ok = (a: BuilderAction[]) => { const r = replay(model, { signedIn: false }, a); return model.checks["bookmark-saved"]!(r.state, r.initial); };
    assert.equal(ok([send("/api/me/bookmarks/track/kafka", { cookie: true })]), false);
    assert.equal(ok(FLOW), true);
  });
  it("four-codes", () => {
    const r = replay(model, { signedIn: false }, [send("/api/me/bookmarks"), send("/api/auth/login"), send("/api/tracks/no-such-track"), ...FLOW]);
    assert.equal(model.checks["four-codes"]!(r.state, r.initial), true);
  });
  it("keeps its invariant and rejects bad input", () => {
    let s = model.init({ signedIn: false }).state;
    for (const a of [...FLOW, send("/api/auth/logout", { csrf: true, cookie: true }), send("/api/me/bookmarks/track/kafka", { csrf: true, cookie: true })]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 1 + s.history.length);
    assert.equal(BuilderActionSchema.safeParse({ type: "send", request: { endpoint: 99, csrf: false, cookie: false, body: "none" } }).success, false);
    assert.equal(BuilderScenarioSchema.safeParse({ signedIn: "yes" }).success, false);
  });
});
