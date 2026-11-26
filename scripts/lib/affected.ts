/**
 * Which executed lessons and labs a change can affect — so CI runs only those on pushes,
 * while the nightly and on-demand runs still execute everything.
 *
 * Rules (conservative: when unsure, run everything):
 *  - Documentation, the web UI, browser tests, figures (content/media) and licences cannot change what a
 *    lesson's commands print, so they select nothing.
 *  - A lesson or lab file selects itself and every runnable whose prerequisite chain includes it.
 *  - Lessons that call DevForge's own API ($API, e.g. Postman and Nginx) print content served by it, so any
 *    content change (other than figures) selects them.
 *  - Any other change — the runner, the server, the schema, workflows, dependencies — selects everything.
 */
export type ChangeScope = "all" | { lessonFiles: Set<string>; contentChanged: boolean };

const IRRELEVANT = [
  /^docs\//,
  /^web\//,
  /^e2e\//,
  /^content\/media\//,
  /^[^/]+\.md$/,
  /^LICENSE/,
  /^\.github\/workflows\/(link-check|record-lessons)\.yml$/,
];

export function changeScope(changed: string[] | "all"): ChangeScope {
  if (changed === "all") return "all";
  const lessonFiles = new Set<string>();
  let contentChanged = false;
  for (const file of changed.map((f) => f.trim()).filter(Boolean)) {
    if (IRRELEVANT.some((re) => re.test(file))) continue;
    if (/^content\/(lessons|labs)\/[^/]+\/[^/]+\.md$/.test(file)) {
      lessonFiles.add(file);
      contentChanged = true;
    } else if (file.startsWith("content/")) contentChanged = true;
    else return "all";
  }
  return { lessonFiles, contentChanged };
}

/** chainFiles: the runnable's own file and those of every prerequisite it replays (repository-relative). */
export function isAffected(scope: ChangeScope, chainFiles: string[], usesApi: boolean): boolean {
  if (scope === "all") return true;
  if (usesApi && scope.contentChanged) return true;
  return chainFiles.some((f) => scope.lessonFiles.has(f));
}

/** Reads DEVFORGE_CHANGED_FILES: unset or "all" means everything; otherwise one path per line. */
export function scopeFromEnv(value: string | undefined): ChangeScope {
  if (value === undefined || value.trim() === "all") return "all";
  return changeScope(value.split("\n"));
}
