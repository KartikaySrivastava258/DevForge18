import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadContent } from "../scripts/lib/content-loader.ts";
import { boundedEditDistance, buildSearchDocs, buildSearchIndex, search, tokenize } from "./search.ts";

const { bundle } = loadContent(join(import.meta.dirname, "..", "content"));
const index = buildSearchIndex(buildSearchDocs(bundle));
const topIds = (q: string, n = 3) => search(index, q).slice(0, n).map((h) => h.id);

describe("tokenize", () => {
  it("lower-cases, strips punctuation and stopwords", () => {
    assert.deepEqual(tokenize("What is the Docker Engine?"), ["docker", "engine"]);
  });
  it("folds accents", () => {
    assert.deepEqual(tokenize("café"), ["cafe"]);
  });
});

describe("boundedEditDistance", () => {
  it("handles insertions, deletions, substitutions and transpositions", () => {
    assert.equal(boundedEditDistance("kubernetes", "kubernetes", 2), 0);
    assert.equal(boundedEditDistance("kuberntes", "kubernetes", 2), 1);
    assert.equal(boundedEditDistance("dokcer", "docker", 1), 1);
    assert.equal(boundedEditDistance("redis", "radish", 1), 2); // exceeds bound → bound + 1
  });
});

describe("search", () => {
  it("finds every track by its short name as the top result", () => {
    for (const track of bundle.tracks) {
      const first = search(index, track.short_title)[0];
      assert.ok(first, `no result for ${track.short_title}`);
      assert.equal(first.id, track.slug, `"${track.short_title}" should rank its own track first`);
    }
  });
  it("tolerates typos", () => {
    assert.equal(topIds("kuberntes")[0], "kubernetes");
    assert.equal(topIds("postgress")[0], "postgresql");
    assert.equal(topIds("terrafrom")[0], "terraform");
  });
  it("expands common abbreviations", () => {
    assert.equal(topIds("k8s")[0], "kubernetes");
    assert.equal(topIds("otel")[0], "opentelemetry");
    assert.equal(topIds("pg")[0], "postgresql");
  });
  it("matches prefixes while typing", () => {
    assert.ok(topIds("promet").includes("prometheus-grafana"));
  });
  it("finds curriculum topics and lessons, not only tracks", () => {
    const hits = search(index, "merge conflicts");
    assert.ok(hits.some((h) => h.type === "topic" && h.id.startsWith("git-github")));
    assert.ok(search(index, "images vs containers").some((h) => h.id === "docker-images-vs-containers"));
  });
  it("filters by type and respects limits", () => {
    const hits = search(index, "docker", { types: ["path"], limit: 3 });
    assert.ok(hits.length > 0 && hits.length <= 3);
    assert.ok(hits.every((h) => h.type === "path"));
  });
  it("returns nothing for empty or stopword-only queries", () => {
    assert.deepEqual(search(index, "   "), []);
    assert.deepEqual(search(index, "the and of"), []);
  });
  it("falls back to partial matches when not every word matches", () => {
    assert.equal(topIds("docker zzzzqqq")[0], "docker");
  });
});
