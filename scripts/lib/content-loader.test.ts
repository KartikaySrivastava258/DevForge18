import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { EXPECTED_TRACK_COUNT, loadContent } from "./content-loader.ts";

const contentRoot = join(import.meta.dirname, "..", "..", "content");
const temps: string[] = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function copyContent(): string {
  const dir = mkdtempSync(join(tmpdir(), "devforge-content-"));
  temps.push(dir);
  cpSync(contentRoot, dir, { recursive: true });
  return dir;
}

describe("repository content", () => {
  const { bundle, errors } = loadContent(contentRoot);

  it("validates without errors", () => {
    assert.deepEqual(errors, []);
  });
  it("contains exactly the 18 blueprint tracks, numbered 1–18", () => {
    assert.equal(bundle.tracks.length, EXPECTED_TRACK_COUNT);
    assert.deepEqual(
      bundle.tracks.map((t) => t.number),
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    const expected = [
      "git-github", "docker", "kubernetes", "postgresql", "terraform", "github-actions",
      "prometheus-grafana", "langchain-llamaindex", "redis", "kafka", "jenkins", "jira",
      "postman", "nginx", "opentelemetry", "airflow", "n8n", "mlflow",
    ];
    assert.deepEqual(bundle.tracks.map((t) => t.slug), expected);
  });
  it("lists each product of the combined tracks individually", () => {
    const products = (slug: string) => bundle.tracks.find((t) => t.slug === slug)?.products.map((p) => p.name);
    assert.deepEqual(products("git-github"), ["Git", "GitHub"]);
    assert.deepEqual(products("prometheus-grafana"), ["Prometheus", "Grafana"]);
    assert.deepEqual(products("langchain-llamaindex"), ["LangChain", "LlamaIndex"]);
  });
  it("includes the 8 blueprint learning paths in order", () => {
    assert.equal(bundle.paths.length, 8);
    assert.deepEqual(
      bundle.paths.find((p) => p.slug === "backend-foundations")?.modules.map((m) => m.track),
      ["git-github", "postgresql", "postman", "redis", "nginx", "docker"],
    );
  });
  it("gives every track at least three labs and three mini-projects across levels", () => {
    for (const track of bundle.tracks) {
      assert.ok(track.labs.length >= 3, track.slug);
      const levels = new Set(track.projects.map((p) => p.level));
      assert.ok(levels.has("beginner") && levels.has("intermediate") && levels.has("advanced"), track.slug);
    }
  });
  it("never marks an unchecked link as verified", () => {
    for (const track of bundle.tracks) {
      for (const r of track.resources) {
        if (r.verification.status !== "unverified") assert.ok(r.verification.checked_on, r.url);
      }
    }
  });
});

describe("validation catches authoring mistakes", () => {
  it("reports a missing track", () => {
    const dir = copyContent();
    rmSync(join(dir, "tracks", "mlflow"), { recursive: true });
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("expected exactly 18 tracks")));
    assert.ok(errors.some((e) => e.includes('unknown related track "mlflow"')));
  });
  it("reports schema violations with file and field", () => {
    const dir = copyContent();
    const file = join(dir, "tracks", "redis", "track.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("entry_level: beginner", "entry_level: expert"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith("tracks/redis/track.yaml: entry_level")));
  });
  it("rejects non-https resource links", () => {
    const dir = copyContent();
    const file = join(dir, "tracks", "nginx", "track.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("https://nginx.org/en/docs/beginners_guide.html", "http://nginx.org/en/docs/beginners_guide.html"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("https://")));
  });
  it("rejects a lesson whose self-check answer is not an option", () => {
    const dir = copyContent();
    const file = join(dir, "lessons", "docker", "docker-images-vs-containers.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("    answer: b\n", "    answer: z\n"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("answer must match an option id")));
  });
  it("rejects review dates in the future", () => {
    const { errors } = loadContent(contentRoot, new Date("2026-01-01T00:00:00Z"));
    assert.ok(errors.some((e) => e.includes("last_reviewed is in the future")));
  });
  it("detects prerequisite cycles", () => {
    const dir = copyContent();
    const file = join(dir, "tracks", "docker", "track.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("prerequisites: []", "prerequisites: [kubernetes]"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith("prerequisite cycle")));
  });
});
