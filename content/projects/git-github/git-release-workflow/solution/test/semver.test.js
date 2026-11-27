import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, parse } from "../src/semver.js";

test("parses the three parts", () => {
  assert.deepEqual(Object.keys(parse("1.4.2")), ["major", "minor", "patch"]);
});

test("rejects versions that are not MAJOR.MINOR.PATCH", () => {
  assert.throws(() => parse("1.4"));
  assert.throws(() => parse("v1.4.2"));
});

test("parses the parts as numbers", () => {
  assert.deepEqual(parse("1.10.0"), { major: 1, minor: 10, patch: 0 });
});

test("compares multi-digit parts numerically (1.10.0 is after 1.9.0)", () => {
  assert.ok(compare("1.10.0", "1.9.0") > 0);
  assert.deepEqual(["1.10.0", "1.2.0", "1.9.3"].sort(compare), ["1.2.0", "1.9.3", "1.10.0"]);
});

test("orders versions", () => {
  assert.equal(compare("1.4.2", "1.4.2"), 0);
  assert.ok(compare("1.4.2", "1.5.0") < 0);
  assert.ok(compare("2.0.0", "1.9.9") > 0);
});
