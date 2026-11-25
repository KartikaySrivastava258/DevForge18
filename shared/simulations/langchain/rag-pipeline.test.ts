import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, violations } from "../types.ts";
import { chunk, cosine, DOCS, promptWords, ragPipeline as model, ranked, retrieved, supportFound, withinBudget, type RagAction, type RagScenario } from "./rag-pipeline.ts";
import { RagActionSchema, RagScenarioSchema } from "./schema.ts";

const TTL: RagScenario = { question: { text: "What happens to a cache entry when its TTL runs out?", vec: [0, 0, 2, 0], support: "o3" }, chunkSize: 4, k: 1, budget: 70 };
const WHY: RagScenario = { question: { text: "Why add a cache in front of a database?", vec: [0, 1, 1, 0], support: "p3" }, chunkSize: 1, k: 1, budget: 45 };
const run = (sc: RagScenario, actions: RagAction[]) => replay(model, sc, actions);
const size = (n: number): RagAction => ({ type: "setChunkSize", size: n });
const k = (n: number): RagAction => ({ type: "setK", k: n });

describe("RAG pipeline: chunking and similarity", () => {
  it("cosine compares direction, not length", () => {
    assert.equal(cosine([0, 0, 1, 0], [0, 0, 5, 0]), 1);
    assert.equal(cosine([0, 1, 0, 0], [0, 0, 1, 0]), 0);
    assert.equal(cosine([0, 0, 0, 0], [0, 0, 1, 0]), 0, "a zero vector is similar to nothing");
  });
  it("splits each document into chunks of whole sentences and keeps the file", () => {
    assert.equal(chunk(1).length, 12);
    assert.equal(chunk(4).length, 3);
    assert.deepEqual(chunk(3).map((c) => c.id), ["redis.md#1", "redis.md#2", "operations.md#1", "operations.md#2", "postgresql.md#1", "postgresql.md#2"]);
  });
  it("big chunks dilute a sentence that sits among other topics", () => {
    const top = (n: number) => ranked({ question: TTL.question, chunkSize: n })[0]!.chunk.file;
    assert.equal(top(4), "redis.md", "the operations chunk mixes Kafka and Docker, so it ranks low");
    const small = ranked({ question: TTL.question, chunkSize: 1 });
    assert.ok(small.findIndex((h) => h.chunk.sentences[0]!.id === "o3") === 2, "one sentence per chunk: third");
  });
});

describe("RAG pipeline: challenges", () => {
  it("TTL question: only one-sentence chunks with k=3 fit the 70-word budget", () => {
    const ok: string[] = [];
    for (const n of [1, 2, 3, 4]) for (const kk of [1, 2, 3, 4, 5, 6]) if (model.checks["support-within-budget"]!(run(TTL, [size(n), k(kk)]).state, run(TTL, []).initial)) ok.push(`${n}/${kk}`);
    assert.deepEqual(ok, ["1/3"]);
    assert.equal(model.checks["support-within-budget"]!(run(TTL, []).state, run(TTL, []).initial), false);
  });
  it("why-cache question: two-sentence chunks give the answer context, within 45 words", () => {
    const ok: string[] = [];
    for (const n of [1, 2, 3, 4]) for (const kk of [1, 2, 3, 4, 5, 6]) if (model.checks["support-within-budget"]!(run(WHY, [size(n), k(kk)]).state, run(WHY, []).initial)) ok.push(`${n}/${kk}`);
    assert.deepEqual(ok, ["2/1"]);
  });
  it("explains each change in the event log", () => {
    const r = run(TTL, [size(1), k(3)]);
    assert.match(r.events.at(-1) ?? "", /answer's sentence is in the prompt; the prompt has 65 words \(budget 70\)/);
    const big = run(TTL, [k(3)]);
    assert.match(big.events.at(-1) ?? "", /too long/);
    assert.ok(supportFound(big.state) && !withinBudget(big.state));
    assert.match(model.step(run(TTL, []).state, size(9)).error ?? "", /1 to 4/);
  });
});

describe("RAG pipeline: invariants, text mode and schemas", () => {
  it("keeps its invariants for every setting", () => {
    for (const n of [1, 2, 3, 4]) for (const kk of [1, 6]) assert.deepEqual(violations(model, run(TTL, [size(n), k(kk)]).state), []);
  });
  it("describes every chunk and the prompt", () => {
    const s = run(TTL, [size(2)]).state;
    assert.equal(model.describe(s).length, 2 + chunk(2).length + 1);
    assert.equal(retrieved(s).length, 1);
    assert.ok(promptWords(s) > 20);
    assert.equal(DOCS.length, 3);
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(RagScenarioSchema.safeParse({ ...TTL, question: { ...TTL.question, support: "zz" } }).success, false);
    assert.equal(RagScenarioSchema.safeParse({ ...TTL, question: { ...TTL.question, vec: [0, 0, 9, 0] } }).success, false);
    assert.equal(RagActionSchema.safeParse({ type: "setK", k: 7 }).success, false);
    assert.equal(RagActionSchema.safeParse({ type: "setChunkSize", size: 2, overlap: 1 }).success, false);
  });
});
