/**
 * The executed lessons and local labs, how each replays its prerequisites, and which of them a change
 * affects. Shared by the lesson tests and scripts/affected-lessons.ts (used by CI to skip idle shards).
 */
import { join } from "node:path";
import { loadContent } from "./content-loader.ts";
import { type ChangeScope, isAffected } from "./affected.ts";
import { lessonNeeds } from "./lesson-runner.ts";

export function loadRunnables(contentRoot: string) {
  const { bundle } = loadContent(contentRoot);
  // Lessons and local labs run the same way; a lab continues from its prerequisite lessons.
  const runnables = [
    ...bundle.lessons.map((l) => ({ ...l, kind: "lesson" as const, file: join(contentRoot, "lessons", l.track, `${l.id}.md`) })),
    ...bundle.labs.map((l) => ({
      ...l,
      kind: "lab" as const,
      // The lab needs what its latest prerequisite lesson in the same track needs (ports, API, time).
      order: Math.max(1, ...l.prerequisites.map((id) => bundle.lessons.find((x) => x.id === id && x.track === l.track)?.order ?? 1)),
      file: join(contentRoot, "labs", l.track, `${l.id}.md`),
    })),
  ].filter((r) => r.verification.method !== "docs-checked");

  /**
   * Students continue from earlier lessons, so executed prerequisites are replayed first, in order. A lesson
   * marked starts_fresh sets up its own state, so the replay stops there: it is replayed, its prerequisites are not.
   */
  function chainOf(prerequisites: string[]): string[] {
    const chain: string[] = [];
    const visit = (id: string) => {
      const l = bundle.lessons.find((x) => x.id === id);
      if (!l || chain.includes(id)) return;
      if (!l.starts_fresh) l.prerequisites.forEach(visit);
      if (l.verification.method !== "docs-checked") chain.push(id);
    };
    prerequisites.forEach(visit);
    return chain;
  }

  /** What the tests replay before a lesson or lab: nothing for a lesson that starts fresh. */
  function chainFor(r: { prerequisites: string[]; starts_fresh?: boolean }): string[] {
    return r.starts_fresh ? [] : chainOf(r.prerequisites);
  }

  function select(scope: ChangeScope) {
    return runnables.filter((r) => {
      const chainFiles = chainFor(r).map((id) => `content/lessons/${bundle.lessons.find((x) => x.id === id)?.track}/${id}.md`);
      const own = `content/${r.kind === "lab" ? "labs" : "lessons"}/${r.track}/${r.id}.md`;
      return isAffected(scope, [own, ...chainFiles], lessonNeeds(r.track, r.order, r.id).api);
    });
  }

  return { bundle, runnables, chainOf, chainFor, select };
}

/** DEVFORGE_LESSON_SHARD: "i/n" keeps every n-th item starting at the i-th; "off" keeps none; unset keeps all. */
export function shardFilter(setting: string | undefined): (index: number) => boolean {
  const value = setting ?? "";
  if (value === "") return () => true;
  if (value === "off") return () => false;
  const m = /^(\d+)\/(\d+)$/.exec(value);
  if (!m) throw new Error(`DEVFORGE_LESSON_SHARD must be "i/n" or "off", not "${value}"`);
  return (index) => index % Number(m[2]) === Number(m[1]) - 1;
}
