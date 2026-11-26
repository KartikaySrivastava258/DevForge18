import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { changeScope, isAffected, scopeFromEnv } from "./affected.ts";
import { loadRunnables, shardFilter } from "./runnables.ts";

describe("change scope", () => {
  it("ignores docs, UI, browser tests, figures and licences", () => {
    const scope = changeScope(["docs/a.md", "web/src/App.tsx", "e2e/x.test.ts", "content/media/git/x.svg", "README.md", "LICENSE-CONTENT"]);
    assert.notEqual(scope, "all");
    assert.ok(!isAffected(scope, ["content/lessons/git-github/git-first-repository.md"], true));
  });
  it("runs everything when the runner, server, schema, workflow or dependencies change", () => {
    for (const f of ["scripts/lib/lesson-runner.ts", "server/src/app.ts", "shared/content-schema.ts", ".github/workflows/ci.yml", "package-lock.json"]) {
      assert.equal(changeScope([f]), "all", f);
    }
  });
  it("selects a changed lesson and lessons whose prerequisite chain includes it", () => {
    const scope = changeScope(["content/lessons/docker/docker-images-vs-containers.md"]);
    assert.ok(isAffected(scope, ["content/lessons/kubernetes/k.md", "content/lessons/docker/docker-images-vs-containers.md"], false));
    assert.ok(!isAffected(scope, ["content/lessons/git-github/g.md"], false));
  });
  it("selects API-dependent lessons whenever content changes", () => {
    assert.ok(isAffected(changeScope(["content/tracks/git-github.yaml"]), ["content/lessons/postman/p.md"], true));
    assert.ok(!isAffected(changeScope(["content/tracks/git-github.yaml"]), ["content/lessons/git-github/g.md"], false));
  });
  it("treats an unset or 'all' variable as everything, and an empty one as nothing", () => {
    assert.equal(scopeFromEnv(undefined), "all");
    assert.equal(scopeFromEnv("all"), "all");
    assert.ok(!isAffected(scopeFromEnv(""), ["content/lessons/git-github/g.md"], true));
  });
});

describe("selection on the real content", () => {
  const { select, runnables, chainFor } = loadRunnables(join(import.meta.dirname, "..", "..", "content"));
  it("a lesson that starts fresh replays nothing, and a change to its prerequisites does not select it", () => {
    const fresh = runnables.find((r) => r.id === "kafka-producers-acks-and-retries");
    assert.ok(fresh && "starts_fresh" in fresh && fresh.starts_fresh);
    assert.deepEqual(chainFor(fresh), []);
    const ids = select(changeScope(["content/lessons/kafka/kafka-scaling-consumers.md"])).map((r) => r.id);
    assert.ok(ids.includes("kafka-scaling-consumers"));
    assert.ok(!ids.includes("kafka-producers-acks-and-retries"));
  });
  it("a change to Docker lesson 1 also runs Kubernetes lessons that replay it", () => {
    const ids = select(changeScope(["content/lessons/docker/docker-images-vs-containers.md"])).map((r) => r.id);
    assert.ok(ids.includes("docker-images-vs-containers"));
    assert.ok(ids.includes("kubernetes-deployments-and-self-healing"));
    assert.ok(!ids.includes("git-first-commits"));
  });
  it("everything is selected by default, and shards partition it", () => {
    const all = select("all");
    assert.equal(all.length, runnables.length);
    const counts = [1, 2, 3].map((i) => all.filter((_, n) => shardFilter(`${i}/3`)(n)).length);
    assert.equal(counts.reduce((a, b) => a + b, 0), all.length);
  });
});
