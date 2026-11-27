import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { EXPECTED_TRACK_COUNT, loadContent } from "./content-loader.ts";
import { MODELS } from "../../shared/simulations/index.ts";

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
  it("gives every track at least two sourced case studies and two alternatives", () => {
    for (const track of bundle.tracks) {
      const studies = bundle.case_studies.filter((c) => c.tracks.includes(track.slug));
      assert.ok(studies.length >= 2, `${track.slug}: ${studies.length} case studies`);
      assert.ok((track.alternatives ?? []).length >= 2, `${track.slug}: alternatives`);
    }
  });
  it("quotes a primary source, with a check date, for every case-study claim", () => {
    for (const c of bundle.case_studies)
      for (const claim of c.claims) {
        assert.ok(claim.quote.length >= 10 && claim.source_url.startsWith("https://"), c.id);
        assert.match(claim.checked_on, /^\d{4}-\d{2}-\d{2}$/, c.id);
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
  it("rejects a case study for an unknown track, a future check date and a missing quote", () => {
    const dir = copyContent();
    const file = join(dir, "case-studies", "kafka-linkedin.yaml");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, original.replace("- kafka\n", "- cobol\n").replace("checked_on: '2026-11-26'", "checked_on: '2099-01-01'"));
    let { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes('kafka-linkedin.yaml: unknown track "cobol"')), errors.join("\n"));
    assert.ok(errors.some((e) => e.includes("kafka-linkedin.yaml: a claim's checked_on is in the future")), errors.join("\n"));
    writeFileSync(file, original.replace(/  quote: [^\n]*\n/, ""));
    ({ errors } = loadContent(dir));
    assert.ok(errors.some((e) => e.includes("kafka-linkedin.yaml") && e.includes("quote")), errors.join("\n"));
  });

  it("rejects an alternative with a non-https link or the same name twice", () => {
    const dir = copyContent();
    const file = join(dir, "tracks", "redis", "alternatives.yaml");
    const original = readFileSync(file, "utf8");
    writeFileSync(file, original.replace("url: https://valkey.io/", "url: http://valkey.io/"));
    let { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("tracks/redis/alternatives.yaml") && e.includes("https")), errors.join("\n"));
    writeFileSync(file, original.replace("- name: Memcached", "- name: Valkey"));
    ({ errors } = loadContent(dir));
    assert.ok(errors.some((e) => e.includes('"Valkey" is listed twice')), errors.join("\n"));
  });

  it("detects prerequisite cycles", () => {
    const dir = copyContent();
    const file = join(dir, "tracks", "docker", "track.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("prerequisites: []", "prerequisites: [kubernetes]"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith("prerequisite cycle")));
  });
});

describe("figures and step-throughs", () => {
  const svgFile = (dir: string) => join(dir, "media", "git-github", "commit-cycle.svg");
  it("are rendered into lessons as inline SVG with a text alternative", () => {
    const { bundle } = loadContent(contentRoot);
    const html = bundle.lessons.find((l) => l.id === "git-first-commits")?.html ?? "";
    assert.match(html, /<figure class="figure step-diagram" id="steps-git-github-commit-cycle" data-step-diagram data-steps="5">/);
    assert.match(html, /<svg [^>]*role="img" aria-labelledby="git-github-commit-cycle-title"><title id="git-github-commit-cycle-title">How a change becomes a commit\. Four boxes/);
    assert.match(html, /<details class="step-diagram__all"><summary>All 5 steps as text<\/summary><ol><li>You create README\.md\./);
  });
  it("reject an unsafe SVG with the file and reason", () => {
    const dir = copyContent();
    writeFileSync(svgFile(dir), readFileSync(svgFile(dir), "utf8").replace("<g>", '<g onclick="alert(1)">'));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith("media/git-github/commit-cycle.svg: svg > g: attribute onclick is not allowed")), errors.join("\n"));
  });
  it("reject a figure without its sidecar, and a lesson that references it", () => {
    const dir = copyContent();
    rmSync(join(dir, "media", "git-github", "commit-cycle.yaml"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("missing sidecar commit-cycle.yaml")));
    assert.ok(errors.some((e) => e.includes("step-through") || e.includes("figure \"commit-cycle.svg\" not found")));
  });
  it("reject step definitions that do not match the figure", () => {
    const dir = copyContent();
    const steps = join(dir, "media", "git-github", "commit-cycle.steps.yaml");
    // Dropping the last step leaves elements marked data-step="5" with nowhere to appear.
    writeFileSync(steps, readFileSync(steps, "utf8").replace(/\n  - caption: git add stages the new version[^\n]*\n/, "\n"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes('uses data-step="5" but there are only 4 steps')), errors.join("\n"));
  });
  it("reject an unknown media reference in a lesson", () => {
    const dir = copyContent();
    const file = join(dir, "lessons", "git-github", "git-first-commits.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("steps=git-github/commit-cycle", "steps=git-github/no-such-diagram"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith("lessons/git-github/git-first-commits.md: unknown step-through")), errors.join("\n"));
  });
  it("are required in every lesson that explains how something works", () => {
    const dir = copyContent();
    const file = join(dir, "lessons", "docker", "docker-volumes-and-bind-mounts.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("![](media:docker/mounts.svg)", "(diagram removed)"));
    const { errors, warnings } = loadContent(dir);
    assert.ok(errors.some((e) => e.startsWith('lessons/docker/docker-volumes-and-bind-mounts.md: the "How it works" section needs a figure')), errors.join("\n"));
    assert.ok(warnings.includes("media/docker/mounts.svg is not used by any lesson, quiz, project, capstone or architecture"));
  });
  it("reject third-party media without a source", () => {
    const dir = copyContent();
    const file = join(dir, "media", "git-github", "commit-cycle.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("licence: project-content", "licence: CC-BY-4.0"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("third-party media need source_url")));
  });
});

describe("simulations", () => {
  const gitSim = (dir: string) => join(dir, "simulations", "git-github", "git-commit-graph.yaml");
  const edit = (file: string, from: string | RegExp, to: string | ((match: string) => string)) => {
    const before = readFileSync(file, "utf8");
    const after = typeof to === "string" ? before.replace(from, to) : before.replace(from, to);
    assert.notEqual(after, before, `edit did not apply: ${String(from)}`);
    writeFileSync(file, after);
  };
  it("load with normalised scenario params, and every challenge's solution is proven", () => {
    const { bundle, errors } = loadContent(contentRoot);
    assert.deepEqual(errors, []);
    // Every registered model has content, and every content file has a model.
    assert.deepEqual(bundle.simulations.map((s) => s.id).sort(), Object.keys(MODELS).sort());
    assert.ok(bundle.simulations.length >= 3);
    const k8s = bundle.simulations.find((s) => s.id === "kubernetes-reconciliation");
    assert.deepEqual(k8s?.scenarios[0]?.params, { nodes: 2, replicas: 3, image: "nginx:1.27-alpine", maxSurge: "25%", maxUnavailable: "25%", setup: [] });
  });
  it("reject a simulation with no model", () => {
    const dir = copyContent();
    const file = gitSim(dir);
    edit(file, "id: git-commit-graph", "id: git-time-machine");
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes('no simulation model with id "git-time-machine"')), errors.join("\n"));
  });
  it("reject scenario params the model does not accept", () => {
    const dir = copyContent();
    edit(join(dir, "simulations", "kubernetes", "kubernetes-reconciliation.yaml"), "params: { nodes: 2, replicas: 3 }", "params: { nodes: 9, replicas: 3 }");
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("scenario steady: params.nodes")), errors.join("\n"));
  });
  it("reject a reference solution that does not solve the challenge", () => {
    const dir = copyContent();
    edit(gitSim(dir), /  - id: undo-pushed-commit[\s\S]*?solution:\n      - \{ type: revert, commit: HEAD \}/, (m) => m.replace("{ type: revert, commit: HEAD }", "{ type: reset, to: HEAD~1 }"));
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes('challenge undo-pushed-commit: the reference solution does not pass the check "undo-pushed-commit-safely"')), errors.join("\n"));
  });
  it("reject an unknown check, an invalid solution step and a missing simplifications list", () => {
    const dir = copyContent();
    edit(gitSim(dir), "check: branch-with-own-commit", "check: does-not-exist");
    edit(gitSim(dir), "{ type: switch, branch: feature }\n      - { type: commit, message: Start feature }", "{ type: teleport }\n      - { type: commit, message: Start feature }");
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes('challenge first-branch: the model has no check "does-not-exist"')), errors.join("\n"));
    const dir2 = copyContent();
    edit(gitSim(dir2), /simplifications:\n(  - .*\n)+/, "simplifications: []\n");
    assert.ok(loadContent(dir2).errors.some((e) => e.includes("every simulation must say what it simplifies")));
  });
  it("reject a challenge that is already solved at the start", () => {
    const dir = copyContent();
    edit(join(dir, "simulations", "kubernetes", "kubernetes-reconciliation.yaml"), "    scenario: broken-release\n    check: recover-from-broken-image", "    scenario: steady\n    check: recover-from-broken-image");
    const { errors } = loadContent(dir);
    assert.ok(errors.some((e) => e.includes("challenge recover-broken-release: the check already passes before the learner does anything")), errors.join("\n"));
  });
});
