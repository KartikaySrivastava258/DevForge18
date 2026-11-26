import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { locationMatcher as model, match, type MatcherAction } from "./location-matcher.ts";
import { MatcherActionSchema, MatcherScenarioSchema } from "./schema.ts";

// The lesson's configuration, in file order (A to G).
const LESSON = ["exact-root", "root", "api", "api-v1", "static-stop", "png", "api-json"];
const LETTER: Record<string, string> = { "exact-root": "A", root: "B", api: "C", "api-v1": "D", "static-stop": "E", png: "F", "api-json": "G", json: "F2" };

describe("location matcher: agrees with real Nginx 1.24", () => {
  // Recorded from nginx 1.24.0 in the lesson "Location matching rules in depth".
  const REAL: [string, string][] = [
    ["/", "A"], ["/about", "B"], ["/api/", "C"], ["/api/users", "C"], ["/api/v1/users", "D"],
    ["/api/v1/users.json", "G"], ["/static/logo.png", "E"], ["/img/logo.png", "F"], ["/api/v1/logo.png", "F"],
  ];
  for (const [path, letter] of REAL) it(`${path} → ${letter}`, () => assert.equal(LETTER[match(LESSON, path).location!], letter));
  it("with a .json regex before G, the first regex wins (F2)", () => {
    const swapped = LESSON.map((l) => (l === "png" ? "json" : l));
    assert.equal(LETTER[match(swapped, "/api/v1/users.json").location!], "F2");
  });
  it("prefix order in the file does not matter", () => {
    assert.equal(match(["api-v1", "api", "root"], "/api/v1/x").location, "api-v1");
    assert.equal(match(["root", "api", "api-v1"], "/api/v1/x").location, "api-v1");
  });
});

describe("location matcher: rules, challenges and safety", () => {
  it("refuses a duplicate prefix (as nginx -t does) but allows = next to a prefix", () => {
    const s = model.init({ locations: ["api-docs"] }).state;
    assert.match(model.step(s, { type: "add", id: "api-docs-stop" }).error ?? "", /duplicate location/);
    assert.equal(model.step(model.init({ locations: ["root"] }).state, { type: "add", id: "exact-root" }).error, undefined);
  });
  it("docs-static needs ^~, because a regex would otherwise win", () => {
    const sc = { locations: ["root", "api", "html"] };
    const ok = (actions: MatcherAction[]) => { const r = replay(model, sc, actions); return model.checks["docs-static"]!(r.state, r.initial); };
    assert.equal(ok([]), false);
    assert.equal(ok([{ type: "add", id: "api-docs" }]), false, "a plain prefix loses to the .html regex");
    assert.equal(ok([{ type: "add", id: "api-docs-stop" }]), true);
  });
  it("health-exact: an exact location answers /health only", () => {
    const r = replay(model, { locations: ["root", "api"] }, [{ type: "add", id: "health" }]);
    assert.equal(model.checks["health-exact"]!(r.state, r.initial), true);
  });
  it("keeps its invariants, explains requests, and rejects unsafe input", () => {
    let s = model.init({ locations: LESSON }).state;
    for (const a of [{ type: "request", path: "/api/v1/users.json" }, { type: "moveUp", id: "api-json" }, { type: "request", path: "/api/v1/users.json" }, { type: "remove", id: "png" }] as MatcherAction[]) {
      s = model.step(s, a).state;
      assert.deepEqual(violations(model, s), []);
    }
    assert.equal(model.describe(s).length, 2 + s.locations.length + s.requests.length);
    assert.match(model.step(s, { type: "request", path: "/api/v1/users.json" }).events[0] ?? "", /First matching regular expression/);
    assert.equal(MatcherActionSchema.safeParse({ type: "request", path: "/a/(.*)+$" }).success, false);
    assert.equal(MatcherActionSchema.safeParse({ type: "add", id: "my-regex" }).success, false);
    assert.equal(MatcherScenarioSchema.safeParse({ locations: ["nope"] }).success, false);
  });
});
