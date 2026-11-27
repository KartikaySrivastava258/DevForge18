import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCursor, encodeCursor, highlight } from "../src/index.js";

test("highlight marks every match, ignoring case", () => {
  assert.equal(highlight("Data science and big data", "data"), "<mark>Data</mark> science and big <mark>data</mark>");
});

test("highlight treats regular-expression characters literally", () => {
  assert.equal(highlight("C++ and C#", "C++"), "<mark>C++</mark> and C#");
  assert.equal(highlight("Node.js, Nodejs", "Node.js"), "<mark>Node.js</mark>, Nodejs");
  assert.equal(highlight("f(x) = (a)", "("), "f<mark>(</mark>x) = <mark>(</mark>a)");
});

test("highlight without a term returns the text unchanged", () => {
  assert.equal(highlight("Physics", ""), "Physics");
});

test("cursors are URL-safe and round-trip, including non-ASCII text", () => {
  const position = { page: 3, q: "Müller über ÿ?" };
  const cursor = encodeCursor(position);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(cursor), position);
});

test("decodeCursor rejects text that is not a cursor", () => {
  assert.throws(() => decodeCursor("not a cursor!"), TypeError);
  assert.throws(() => decodeCursor(42), TypeError);
});
