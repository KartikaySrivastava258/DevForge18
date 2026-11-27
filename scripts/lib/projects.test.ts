/**
 * Every mini-project with a check script is executed: the check must FAIL on the starter (there is work to do)
 * and PASS on the reference solution (the criteria are achievable and the solution meets them).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import type { CompiledProject, ProjectFile } from "../../shared/content-schema.ts";
import { changeScope } from "./affected.ts";
import { loadContent } from "./content-loader.ts";
import { dockerTestingEnabled, hasCommand } from "./lesson-runner.ts";
import { shardFilter } from "./runnables.ts";

const contentRoot = join(import.meta.dirname, "..", "..", "content");
const { bundle } = loadContent(contentRoot);

function writeFiles(dir: string, files: ProjectFile[]): void {
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
}

/**
 * Copy the files into a fresh folder and run check.sh on it. A top-level prepare.sh is not copied in: it runs
 * first, inside the folder, with STARTER_DIR pointing at a pristine copy of the starter, so a reference solution
 * can replay the Git history a learner would have made (starting from the starter) — history cannot be stored
 * as plain files.
 */
function runCheck(project: CompiledProject, files: ProjectFile[]): { status: number | null; output: string } {
  const base = mkdtempSync(join(tmpdir(), "devforge-project-"));
  const work = join(base, "work");
  const home = join(base, "home");
  const starterDir = join(base, "starter");
  mkdirSync(home);
  try {
    writeFiles(work, files.filter((f) => f.path !== "prepare.sh"));
    writeFiles(starterDir, project.starter_files);
    const prepare = files.find((f) => f.path === "prepare.sh");
    if (prepare) writeFileSync(join(base, "prepare.sh"), prepare.content);
    writeFileSync(join(base, "check.sh"), project.check_script ?? "");
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      GIT_AUTHOR_DATE: "2026-01-15T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-15T10:00:00Z",
      GIT_CONFIG_NOSYSTEM: "1",
      STARTER_DIR: starterDir,
    };
    let output = "";
    if (prepare) {
      const prep = spawnSync("bash", [join(base, "prepare.sh")], { cwd: work, env, encoding: "utf8", timeout: 120_000 });
      output += prep.stdout + prep.stderr;
      if (prep.status !== 0) return { status: -1, output: `prepare.sh failed:\n${output}` };
    }
    const run = spawnSync("bash", [join(base, "check.sh"), work], { cwd: base, env, encoding: "utf8", timeout: 300_000 });
    return { status: run.status, output: output + run.stdout + run.stderr };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Where each check runs in CI. The verify job (DEVFORGE_LESSON_SHARD=off) runs the checks that need no Docker;
 * the lesson shard jobs ("i/n", Docker allowed) run every n-th Docker check — on pushes only for projects whose
 * files changed (or everything when the runner, server or schema changed). Local runs (unset) run everything
 * the machine has tools for.
 */
const shardSetting = process.env.DEVFORGE_LESSON_SHARD ?? "";
const withCheck = bundle.projects.filter((p) => p.check_script);
const usesDocker = (p: CompiledProject) => (p.check_needs ?? []).includes("docker");
function selectedForThisJob(): { project: CompiledProject; skip: string | false }[] {
  if (shardSetting === "off") return withCheck.map((project) => ({ project, skip: usesDocker(project) ? "runs in the lesson shard jobs (needs Docker)" : false }));
  if (!shardSetting) return withCheck.map((project) => ({ project, skip: false }));
  const changed = process.env.DEVFORGE_CHANGED_FILES;
  const lines = changed === undefined || changed.trim() === "all" ? "all" : changed.split("\n").map((l) => l.trim()).filter(Boolean);
  const everything = lines === "all" || changeScope(lines) === "all";
  const inShard = shardFilter(shardSetting);
  return withCheck
    .filter(usesDocker)
    .filter((_, index) => inShard(index))
    .filter((p) => everything || (lines as string[]).some((f) => f.startsWith(`content/projects/${p.track}/${p.id}.md`) || f.startsWith(`content/projects/${p.track}/${p.id}/`)))
    .map((project) => ({ project, skip: false }));
}

describe("mini-project checks", () => {
  for (const { project, skip } of selectedForThisJob()) {
    const needs = project.check_needs ?? [];
    const missing = needs.filter((tool) => (tool === "docker" ? !dockerTestingEnabled() : !hasCommand(tool)));
    it(`${project.id}: the check fails on the starter and passes on the reference solution`, { skip: skip || (missing.length ? `needs ${missing.join(", ")}` : false) }, () => {
      const starter = runCheck(project, project.starter_files);
      assert.notEqual(starter.status, 0, `the check should fail on the starter:\n${starter.output}`);
      assert.match(starter.output, /FAIL/, "the check should say which criterion fails");
      const solution = runCheck(project, project.solution_files);
      assert.equal(solution.status, 0, `the check should pass on the reference solution:\n${solution.output}`);
      assert.doesNotMatch(solution.output, /FAIL/);
    });
  }
  it("only reference solutions replay history: no starter ships a prepare.sh", () => {
    assert.deepEqual(bundle.projects.filter((p) => p.starter_files.some((f) => f.path === "prepare.sh")).map((p) => p.id), []);
  });
});
