/**
 * Loads, validates and compiles all content under a content root directory.
 * Returns every problem found (not just the first) so authors can fix a
 * whole batch of issues in one pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { ZodError } from "zod/v4";
import {
  LessonMetaSchema,
  PathSchema,
  TrackSchema,
  type CompiledLesson,
  type ContentBundle,
  type LearningPath,
  type Track,
} from "../../shared/content-schema.ts";
import { extractRunBlocks } from "./lesson-runner.ts";
import { loadMedia, mediaResolver } from "./media.ts";
import { loadSimulations } from "./simulations.ts";
import { parseYaml } from "./yaml.ts";
import { renderMarkdown, splitFrontMatter } from "./markdown.ts";

export const EXPECTED_TRACK_COUNT = 18;

export interface LoadResult {
  bundle: ContentBundle;
  errors: string[];
  warnings: string[];
}

function formatZod(file: string, error: ZodError): string[] {
  return error.issues.map((issue) => `${file}: ${issue.path.join(".") || "(root)"} — ${issue.message}`);
}

function readYaml(file: string, errors: string[], root: string): unknown {
  try {
    return parseYaml(readFileSync(file, "utf8"), file);
  } catch (err) {
    errors.push(`${relative(root, file)}: invalid YAML — ${(err as Error).message.split("\n")[0]}`);
    return undefined;
  }
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .sort();
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext) && !name.startsWith("."))
    .sort();
}

export function loadContent(root: string, now: Date = new Date()): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const today = now.toISOString().slice(0, 10);

  // ---- Tracks -------------------------------------------------------------
  const tracks: Track[] = [];
  const tracksDir = join(root, "tracks");
  for (const dirName of listDirs(tracksDir)) {
    const file = join(tracksDir, dirName, "track.yaml");
    const rel = relative(root, file);
    if (!existsSync(file)) {
      errors.push(`${relative(root, join(tracksDir, dirName))}: missing track.yaml`);
      continue;
    }
    const raw = readYaml(file, errors, root);
    if (raw === undefined) continue;
    const parsed = TrackSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    if (parsed.data.slug !== dirName) errors.push(`${rel}: slug "${parsed.data.slug}" must match directory "${dirName}"`);
    if (parsed.data.last_reviewed > today) errors.push(`${rel}: last_reviewed is in the future`);
    tracks.push(parsed.data);
  }
  tracks.sort((a, b) => a.number - b.number);

  if (tracks.length !== EXPECTED_TRACK_COUNT) {
    errors.push(`expected exactly ${EXPECTED_TRACK_COUNT} tracks, found ${tracks.length}`);
  }
  const trackSlugs = new Set(tracks.map((t) => t.slug));
  const numbers = new Map<number, string>();
  for (const track of tracks) {
    const clash = numbers.get(track.number);
    if (clash) errors.push(`tracks "${clash}" and "${track.slug}" share number ${track.number}`);
    numbers.set(track.number, track.slug);
    for (const prereq of track.prerequisites) {
      if (!trackSlugs.has(prereq)) errors.push(`track ${track.slug}: unknown prerequisite "${prereq}"`);
      if (prereq === track.slug) errors.push(`track ${track.slug}: cannot be its own prerequisite`);
    }
    for (const rel of track.related) {
      if (!trackSlugs.has(rel.slug)) errors.push(`track ${track.slug}: unknown related track "${rel.slug}"`);
      if (rel.slug === track.slug) errors.push(`track ${track.slug}: cannot be related to itself`);
    }
    const urls = new Set<string>();
    for (const resource of track.resources) {
      if (urls.has(resource.url)) errors.push(`track ${track.slug}: duplicate resource ${resource.url}`);
      urls.add(resource.url);
    }
  }
  detectPrerequisiteCycles(tracks, errors);

  // ---- Learning paths -----------------------------------------------------
  const paths: LearningPath[] = [];
  const pathsDir = join(root, "paths");
  for (const fileName of listFiles(pathsDir, ".yaml")) {
    const file = join(pathsDir, fileName);
    const rel = relative(root, file);
    const raw = readYaml(file, errors, root);
    if (raw === undefined) continue;
    const parsed = PathSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    if (`${parsed.data.slug}.yaml` !== fileName) errors.push(`${rel}: slug must match file name`);
    const seen = new Set<string>();
    for (const module of parsed.data.modules) {
      if (!trackSlugs.has(module.track)) errors.push(`${rel}: unknown track "${module.track}"`);
      if (seen.has(module.track)) errors.push(`${rel}: track "${module.track}" appears twice`);
      seen.add(module.track);
    }
    paths.push(parsed.data);
  }
  paths.sort((a, b) => a.number - b.number);

  // ---- Figures and step-throughs -----------------------------------------
  const media = loadMedia(root, trackSlugs, errors);
  const usedMedia = new Set<string>();

  // ---- Simulations ----------------------------------------------------------
  const simulations = loadSimulations(root, trackSlugs, errors);
  const simulationsById = new Map(simulations.map((s) => [s.id, s]));

  // ---- Lessons ------------------------------------------------------------
  const lessons: CompiledLesson[] = [];
  const lessonsDir = join(root, "lessons");
  for (const trackDir of listDirs(lessonsDir)) {
    if (!trackSlugs.has(trackDir)) errors.push(`lessons/${trackDir}: no track with this slug`);
    for (const fileName of listFiles(join(lessonsDir, trackDir), ".md")) {
      const file = join(lessonsDir, trackDir, fileName);
      const rel = relative(root, file);
      const split = splitFrontMatter(readFileSync(file, "utf8"));
      if (!split) {
        errors.push(`${rel}: missing YAML front matter (--- ... ---)`);
        continue;
      }
      let raw: unknown;
      try {
        raw = parseYaml(split.frontMatter, file);
      } catch (err) {
        errors.push(`${rel}: invalid front matter — ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      const parsed = LessonMetaSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...formatZod(rel, parsed.error));
        continue;
      }
      const meta = parsed.data;
      if (`${meta.id}.md` !== basename(fileName)) errors.push(`${rel}: id must match file name`);
      if (meta.track !== trackDir) errors.push(`${rel}: track "${meta.track}" must match folder "${trackDir}"`);
      if (meta.last_reviewed > today) errors.push(`${rel}: last_reviewed is in the future`);
      if (split.body.trim().length < 400) errors.push(`${rel}: lesson body is too short to be meaningful`);
      const runBlocks = extractRunBlocks(split.body).length;
      if (meta.verification.method === "executed" && runBlocks === 0) errors.push(`${rel}: verification "executed" requires at least one \`\`\`bash run block`);
      if (meta.verification.method === "docs-checked" && runBlocks > 0) errors.push(`${rel}: has run blocks, so verification.method must be "executed" or "pending"`);
      if (meta.verification.method === "pending" && runBlocks === 0) errors.push(`${rel}: verification "pending" requires run blocks`);
      const rendered = renderMarkdown(split.body, { media: mediaResolver(media, usedMedia, simulationsById) });
      for (const problem of rendered.problems) errors.push(`${rel}: ${problem}`);
      // REMAINING_WORK.md §4.2: every explanation of how something works comes with a picture.
      if (rendered.toc.some((t) => t.text === "How it works") && rendered.figures === 0) {
        errors.push(`${rel}: the "How it works" section needs a figure (media:…) or a step-through (\`\`\`diagram steps=…)`);
      }
      if (rendered.toc.length < 2) warnings.push(`${rel}: fewer than two "##" sections — consider structuring the lesson`);
      lessons.push({ ...meta, html: rendered.html, toc: rendered.toc, word_count: rendered.wordCount });
    }
  }
  const lessonIds = new Set<string>();
  for (const lesson of lessons) {
    if (lessonIds.has(lesson.id)) errors.push(`duplicate lesson id "${lesson.id}"`);
    lessonIds.add(lesson.id);
  }
  const orders = new Set<string>();
  for (const lesson of lessons) {
    const key = `${lesson.track}#${lesson.order}`;
    if (orders.has(key)) errors.push(`lesson ${lesson.id}: order ${lesson.order} already used in track ${lesson.track}`);
    orders.add(key);
    for (const prereq of lesson.prerequisites) {
      if (!lessonIds.has(prereq)) errors.push(`lesson ${lesson.id}: unknown prerequisite lesson "${prereq}"`);
    }
  }
  lessons.sort((a, b) => (a.track === b.track ? a.order - b.order : a.track.localeCompare(b.track)));
  for (const key of media.figures.keys()) if (!usedMedia.has(`figure:${key}`)) warnings.push(`media/${key}.svg is not used by any lesson`);
  for (const key of media.diagrams.keys()) if (!usedMedia.has(`diagram:${key}`)) warnings.push(`media/${key}.steps.yaml is not used by any lesson`);

  return {
    bundle: { schema_version: 1, generated_at: now.toISOString(), tracks, paths, lessons, simulations },
    errors,
    warnings,
  };
}

function detectPrerequisiteCycles(tracks: Track[], errors: string[]): void {
  const graph = new Map(tracks.map((t) => [t.slug, t.prerequisites]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, trail: string[]): void => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "visiting") {
      errors.push(`prerequisite cycle: ${[...trail, node].join(" → ")}`);
      return;
    }
    state.set(node, "visiting");
    for (const next of graph.get(node) ?? []) visit(next, [...trail, node]);
    state.set(node, "done");
  };
  for (const t of tracks) visit(t.slug, []);
}
