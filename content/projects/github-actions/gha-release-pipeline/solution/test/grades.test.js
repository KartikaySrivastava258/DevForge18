import assert from "node:assert/strict";
import { test } from "node:test";
import { letterGrade, weightedAverage } from "../src/grades.js";

test("letterGrade uses the band boundaries", () => {
  assert.equal(letterGrade(100), "A");
  assert.equal(letterGrade(90), "A");
  assert.equal(letterGrade(89.9), "B");
  assert.equal(letterGrade(60), "D");
  assert.equal(letterGrade(59.9), "F");
  assert.equal(letterGrade(0), "F");
});

test("letterGrade rejects scores outside 0-100", () => {
  for (const bad of [-1, 101, Number.NaN, "90"]) assert.throws(() => letterGrade(bad), RangeError);
});

test("weightedAverage weights the scores and rounds to one decimal", () => {
  assert.equal(weightedAverage([{ score: 80, weight: 0.4 }, { score: 90, weight: 0.6 }]), 86);
  assert.equal(weightedAverage([{ score: 70, weight: 1 }, { score: 75, weight: 2 }]), 73.3);
});

test("weightedAverage rejects empty input and non-positive weights", () => {
  assert.throws(() => weightedAverage([]), TypeError);
  assert.throws(() => weightedAverage([{ score: 50, weight: 0 }]), RangeError);
});
