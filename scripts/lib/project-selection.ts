/**
 * Which mini-project checks a test job runs (see scripts/lib/projects.test.ts and the CI workflow).
 */
import type { CompiledProject } from "../../shared/content-schema.ts";
import { changeScope } from "./affected.ts";
import { shardFilter } from "./runnables.ts";

/**
 * Where each check runs in CI. The verify job (DEVFORGE_LESSON_SHARD=off) runs the checks that need no Docker;
 * the project shard jobs (DEVFORGE_PROJECT_SHARD="i/n", Docker allowed) run every n-th Docker check — on pushes only for projects whose
 * files changed (or everything when the runner, server or schema changed). Local runs (unset) run everything
 * the machine has tools for.
 */
export const usesDocker = (p: CompiledProject) => (p.check_needs ?? []).includes("docker");
export function selectProjectChecks(projects: CompiledProject[], shardSetting = process.env.DEVFORGE_PROJECT_SHARD ?? process.env.DEVFORGE_LESSON_SHARD ?? "", changed = process.env.DEVFORGE_CHANGED_FILES): { project: CompiledProject; skip: string | false }[] {
  const withCheck = projects.filter((p) => p.check_script);
  if (shardSetting === "off") return withCheck.map((project) => ({ project, skip: usesDocker(project) ? "runs in the lesson shard jobs (needs Docker)" : false }));
  if (!shardSetting) return withCheck.map((project) => ({ project, skip: false }));
  const lines = changed === undefined || changed.trim() === "all" ? "all" : changed.split("\n").map((l) => l.trim()).filter(Boolean);
  const everything = lines === "all" || changeScope(lines) === "all";
  const inShard = shardFilter(shardSetting);
  return withCheck
    .filter(usesDocker)
    .filter((_, index) => inShard(index))
    .filter((p) => everything || (lines as string[]).some((f) => f.startsWith(`content/projects/${p.track}/${p.id}.md`) || f.startsWith(`content/projects/${p.track}/${p.id}/`)))
    .map((project) => ({ project, skip: false }));
}

