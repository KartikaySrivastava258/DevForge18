/**
 * Re-record expected output in executable lessons from real runs, like
 * updating test snapshots. Needs the lesson's tools available (Git; for SQL
 * lessons a PostgreSQL server reachable through PG* environment variables).
 *
 *   npm run lessons:record -- <lesson-id> [<lesson-id> ...]
 *   npm run lessons:record -- --all
 *
 * It rewrites only ```text output fences that follow run blocks, keeps an
 * output fence unchanged when it already matches (so "…" wildcards survive),
 * and never changes verification.method: review the diff, then set
 * `method: executed` yourself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent } from "./lib/content-loader.ts";
import { dockerTestingEnabled, extractRunBlocks, lessonNeeds, outputMatches, redisTestingEnabled, usesDocker, runLesson, type RunBlock } from "./lib/lesson-runner.ts";
import { splitFrontMatter } from "./lib/markdown.ts";
import { loadRunnables } from "./lib/runnables.ts";
import { startPracticeServer } from "./lib/practice-server.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = join(root, "content");
const { bundle } = loadContent(contentRoot);
const { chainFor } = loadRunnables(contentRoot);
const args = process.argv.slice(2);
// Labs are recorded like lessons; a lab needs what its latest prerequisite lesson in its track needs.
const items = [
  ...bundle.lessons.map((l) => ({ ...l, file: join(contentRoot, "lessons", l.track, `${l.id}.md`) })),
  ...bundle.labs.map((l) => ({
    ...l,
    order: Math.max(1, ...l.prerequisites.map((id) => bundle.lessons.find((x) => x.id === id && x.track === l.track)?.order ?? 1)),
    file: join(contentRoot, "labs", l.track, `${l.id}.md`),
  })),
];
const targets = args.includes("--all") ? items.filter((l) => l.verification.method !== "docs-checked") : items.filter((l) => args.includes(l.id));
if (targets.length === 0) {
  console.error("Usage: npm run lessons:record -- <lesson-or-lab-id> ... | --all");
  process.exit(2);
}
const fileOf = (id: string) => {
  const l = items.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lesson or lab ${id}`);
  return l.file;
};
const blocksOf = (id: string): RunBlock[] => extractRunBlocks(splitFrontMatter(readFileSync(fileOf(id), "utf8"))?.body ?? "");

for (const lesson of targets) {
  // The same replay rule as the tests (prerequisites first, none for lessons that start fresh).
  const setup = chainFor(lesson).flatMap(blocksOf);
  const own = blocksOf(lesson.id);
  const needs = lessonNeeds(lesson.track, lesson.order);
  const api = needs.api ? await startPracticeServer(contentRoot, needs.apiPort) : undefined;
  if (lesson.track === "redis" && !redisTestingEnabled()) {
    console.error(`${lesson.id}: skipped. Recording empties the current Redis database (FLUSHDB); use a throwaway Redis and set DEVFORGE_REDIS_TEST=1.`);
    process.exitCode = 1;
    await api?.close();
    continue;
  }
  if ((lesson.track === "docker" || lesson.track === "kubernetes" || usesDocker([...setup, ...own])) && !dockerTestingEnabled()) {
    console.error(`${lesson.id}: skipped. Docker lessons force-remove containers and volumes with fixed names; run them only on a disposable Docker engine with DEVFORGE_DOCKER_TEST=1.`);
    process.exitCode = 1;
    await api?.close();
    continue;
  }
  const run = runLesson([...setup, ...own].map((b, index) => ({ ...b, index })), {
    ...(api ? { env: { API: api.url } } : {}),
    allowRedisFlush: lesson.track === "redis",
    timeoutMs: needs.timeoutMs,
  });
  await api?.close();
  if (run.failure) {
    console.error(`${lesson.id}: stopped early — fix the commands first:\n${run.failure}`);
    process.exitCode = 1;
    continue;
  }
  const actual = run.results.slice(setup.length);

  // Rewrite output fences in order. Fences are paired exactly as extractRunBlocks pairs them.
  const file = fileOf(lesson.id);
  const lines = readFileSync(file, "utf8").split("\n");
  const fences: { start: number; end: number; info: string }[] = [];
  for (let i = 0, open = -1, info = ""; i < lines.length; i++) {
    const m = /^\s*```(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    if (open === -1) {
      open = i;
      info = (m[1] ?? "").trim();
    } else {
      fences.push({ start: open, end: i, info });
      open = -1;
    }
  }
  let blockNo = 0;
  let changed = 0;
  const edits: { start: number; end: number; text: string[] }[] = [];
  fences.forEach((f, i) => {
    if (!f.info.split(/\s+/).includes("run")) return;
    const result = actual[blockNo++];
    const next = fences[i + 1];
    if (!result || !next || !next.info.split(/\s+/).includes("output")) return;
    const current = lines.slice(next.start + 1, next.end).join("\n");
    if (outputMatches(current, result.output)) return;
    const indent = /^(\s*)/.exec(lines[next.start] ?? "")?.[1] ?? "";
    const text = result.output.replace(/\s+$/, "").split("\n").map((l) => (l ? indent + l.replace(/\s+$/, "") : l));
    edits.push({ start: next.start + 1, end: next.end, text });
    changed++;
  });
  for (const e of edits.reverse()) lines.splice(e.start, e.end - e.start, ...e.text);
  if (changed) writeFileSync(file, lines.join("\n"));
  console.log(`${lesson.id}: ${changed} output block(s) updated${changed ? " — review with git diff" : ""}.`);
}
