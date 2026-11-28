/**
 * Loads, validates and compiles all content under a content root directory.
 * Returns every problem found (not just the first) so authors can fix a
 * whole batch of issues in one pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { ZodError } from "zod/v4";
import { overdueReview, reviewAgeWarning, type OverdueReview } from "./review-age.ts";
import {
  AlternativesFileSchema,
  CapstoneMetaSchema,
  IntegrationSchema,
  ArchitectureMetaSchema,
  CaseStudySchema,
  LabMetaSchema,
  LessonMetaSchema,
  PathSchema,
  ProjectMetaSchema,
  QuizSchema,
  TrackSchema,
  type CaseStudy,
  type CompiledCapstone,
  type Integration,
  type CompiledArchitecture,
  type CompiledLab,
  type CompiledLesson,
  type CompiledProject,
  type ProjectFile,
  type CompiledQuiz,
  type ContentBundle,
  type LearningPath,
  type Track,
} from "../../shared/content-schema.ts";
import { extractRunBlocks, pipesIntoQuietGrep } from "./lesson-runner.ts";
import { loadMedia, mediaResolver } from "./media.ts";
import { loadSimulations } from "./simulations.ts";
import { parseYaml } from "./yaml.ts";
import { renderMarkdown, splitFrontMatter } from "./markdown.ts";

export const EXPECTED_TRACK_COUNT = 18;

export interface LoadResult {
  bundle: ContentBundle;
  errors: string[];
  warnings: string[];
  /** Files whose last_reviewed is more than REVIEW_MAX_MONTHS before `now` (UTC); each is also a warning. */
  overdueReviews: OverdueReview[];
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

/** Every file under dir (recursively), sorted, for project starter and solution folders. */
function walkAll(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walkAll(full) : [full];
    });
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
  const overdueReviews: OverdueReview[] = [];
  /** A review date may not be in the future (an error) and should not be more than 12 months old (a warning). */
  const checkReviewed = (rel: string, lastReviewed: string) => {
    if (lastReviewed > today) {
      errors.push(`${rel}: last_reviewed is in the future`);
      return;
    }
    const overdue = overdueReview(rel, lastReviewed, now);
    if (overdue) {
      overdueReviews.push(overdue);
      warnings.push(reviewAgeWarning(overdue));
    }
  };

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
    checkReviewed(rel, parsed.data.last_reviewed);
    const track: Track = parsed.data;
    const altFile = join(tracksDir, dirName, "alternatives.yaml");
    if (existsSync(altFile)) {
      const altRel = relative(root, altFile);
      const altRaw = readYaml(altFile, errors, root);
      const alt = altRaw === undefined ? undefined : AlternativesFileSchema.safeParse(altRaw);
      if (alt && !alt.success) errors.push(...formatZod(altRel, alt.error));
      else if (alt) {
        if (alt.data.checked_on > today) errors.push(`${altRel}: checked_on is in the future`);
        const names = new Set<string>();
        for (const a of [...alt.data.alternatives, ...(alt.data.complements?.items ?? [])]) {
          if (names.has(a.name)) errors.push(`${altRel}: "${a.name}" is listed twice`);
          names.add(a.name);
        }
        track.alternatives = alt.data.alternatives;
        track.alternatives_checked_on = alt.data.checked_on;
        if (alt.data.complements) track.complements = alt.data.complements;
      }
    }
    tracks.push(track);
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
    checkReviewed(rel, parsed.data.last_reviewed);
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
  for (const s of simulations) checkReviewed(`simulations/${s.track}/${s.id}.yaml`, s.last_reviewed);

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
      checkReviewed(rel, meta.last_reviewed);
      if (split.body.trim().length < 400) errors.push(`${rel}: lesson body is too short to be meaningful`);
      const lessonBlocks = extractRunBlocks(split.body);
      const runBlocks = lessonBlocks.length;
      if (lessonBlocks.some((b) => pipesIntoQuietGrep(b.code))) errors.push(`${rel}: a run block pipes into grep -q, which races with set -o pipefail; use \`| grep … > /dev/null\``);
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

  // ---- Labs (REMAINING_WORK.md §4.4) ----------------------------------------
  const labs: CompiledLab[] = [];
  const labsDir = join(root, "labs");
  for (const trackDir of listDirs(labsDir)) {
    if (!trackSlugs.has(trackDir)) errors.push(`labs/${trackDir}: no track with this slug`);
    for (const fileName of listFiles(join(labsDir, trackDir), ".md")) {
      const file = join(labsDir, trackDir, fileName);
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
      const parsed = LabMetaSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...formatZod(rel, parsed.error));
        continue;
      }
      const meta = parsed.data;
      if (`${meta.id}.md` !== basename(fileName)) errors.push(`${rel}: id must match file name`);
      if (meta.track !== trackDir) errors.push(`${rel}: track "${meta.track}" must match folder "${trackDir}"`);
      checkReviewed(rel, meta.last_reviewed);
      if (lessonIds.has(meta.id)) errors.push(`${rel}: id "${meta.id}" is already a lesson id`);
      for (const prereq of meta.prerequisites) if (!lessonIds.has(prereq)) errors.push(`${rel}: unknown prerequisite lesson "${prereq}"`);
      const blocks = extractRunBlocks(split.body);
      const checks = blocks.filter((b) => b.check).length;
      if (blocks.some((b) => pipesIntoQuietGrep(b.code))) errors.push(`${rel}: a run block pipes into grep -q, which races with set -o pipefail; use \`| grep … > /dev/null\``);
      if (meta.mode === "local") {
        if (meta.verification.method === "docs-checked") errors.push(`${rel}: a local lab's steps must be executed by the tests (verification "executed" or "pending")`);
        if (blocks.length === 0) errors.push(`${rel}: a local lab needs \`\`\`bash run steps`);
        if (checks !== 1) errors.push(`${rel}: a local lab needs exactly one check script (\`\`\`bash run check), found ${checks}`);
      } else if (checks > 0) errors.push(`${rel}: only local labs have a check script`);
      if (meta.verification.method === "executed" && blocks.length === 0) errors.push(`${rel}: verification "executed" requires run blocks`);
      if (meta.verification.method === "docs-checked" && blocks.length > 0) errors.push(`${rel}: has run blocks, so verification.method must be "executed" or "pending"`);
      if (meta.simulation) {
        const sim = simulationsById.get(meta.simulation.id);
        if (!sim) errors.push(`${rel}: unknown simulation "${meta.simulation.id}"`);
        else
          for (const c of meta.simulation.challenges)
            if (!sim.challenges.some((x) => x.id === c)) errors.push(`${rel}: simulation "${sim.id}" has no challenge "${c}"`);
      }
      const rendered = renderMarkdown(split.body, { media: mediaResolver(media, usedMedia, simulationsById) });
      for (const problem of rendered.problems) errors.push(`${rel}: ${problem}`);
      for (const heading of ["Goal", "Reset"]) if (!rendered.toc.some((t) => t.text === heading)) errors.push(`${rel}: a lab needs a "## ${heading}" section`);
      labs.push({ ...meta, html: rendered.html, toc: rendered.toc });
    }
  }
  labs.sort((a, b) => (a.track === b.track ? a.id.localeCompare(b.id) : a.track.localeCompare(b.track)));
  const labsById = new Map<string, CompiledLab>();
  for (const lab of labs) {
    if (labsById.has(lab.id)) errors.push(`duplicate lab id "${lab.id}"`);
    labsById.set(lab.id, lab);
  }
  const linkedLabs = new Set<string>();
  for (const track of tracks) {
    for (const item of track.labs) {
      if (item.status === "covered") continue; // checked after the projects, below
      if (!item.lab) {
        if (item.status === "available") errors.push(`track ${track.slug}: lab "${item.title}" is marked available but names no lab page`);
        continue;
      }
      const lab = labsById.get(item.lab);
      if (!lab) errors.push(`track ${track.slug}: unknown lab "${item.lab}"`);
      else {
        if (lab.track !== track.slug) errors.push(`track ${track.slug}: lab "${item.lab}" belongs to track ${lab.track}`);
        if (item.status !== "available") errors.push(`track ${track.slug}: lab "${item.lab}" is published, so its status must be "available"`);
        if (lab.level !== item.level || (item.mode && lab.mode !== item.mode)) errors.push(`track ${track.slug}: level or mode of "${item.lab}" differs from the lab page`);
      }
      linkedLabs.add(item.lab);
    }
    for (const item of track.projects) if (item.lab) errors.push(`track ${track.slug}: projects cannot name a lab`);
    for (const item of track.labs) if (item.project && item.status !== "covered") errors.push(`track ${track.slug}: labs cannot name a project`);
  }
  for (const lab of labs) if (!linkedLabs.has(lab.id)) errors.push(`lab ${lab.id}: not listed in its track's labs`);

  // ---- Quizzes (one YAML per track quiz) ---------------------------------------
  const quizzes: CompiledQuiz[] = [];
  const quizDir = join(root, "quizzes");
  for (const trackDir of existsSync(quizDir) ? readdirSync(quizDir).sort() : []) {
    if (!trackSlugs.has(trackDir)) errors.push(`quizzes/${trackDir}: unknown track folder`);
    for (const fileName of listFiles(join(quizDir, trackDir), ".yaml")) {
      const file = join(quizDir, trackDir, fileName);
      const rel = relative(root, file);
      const raw = readYaml(file, errors, root);
      if (raw === undefined) continue;
      const parsed = QuizSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...formatZod(rel, parsed.error));
        continue;
      }
      const quiz = parsed.data;
      if (`${quiz.id}.yaml` !== fileName) errors.push(`${rel}: id must match file name`);
      if (quiz.track !== trackDir) errors.push(`${rel}: track "${quiz.track}" must match folder "${trackDir}"`);
      checkReviewed(rel, quiz.last_reviewed);
      const figures: Record<string, string> = {};
      const quizMedia = mediaResolver(media, usedMedia, simulationsById);
      for (const q of quiz.questions) {
        const lesson = lessons.find((l) => l.id === q.lesson);
        if (!lesson) errors.push(`${rel}: question ${q.id} names unknown lesson "${q.lesson}"`);
        else if (lesson.track !== quiz.track) errors.push(`${rel}: question ${q.id} names lesson "${q.lesson}" from another track`);
        if (q.type === "diagram") {
          const key = q.media.replace(/^media:/, "").replace(/\.svg$/, "");
          if (!media.figures.has(key)) errors.push(`${rel}: question ${q.id} uses unknown figure ${q.media}`);
          else {
            try {
              figures[q.id] = quizMedia.figure(q.media.replace(/^media:/, ""), "", "");
            } catch (err) {
              errors.push(`${rel}: question ${q.id}: ${(err as Error).message}`);
            }
          }
        }
      }
      quizzes.push({ ...quiz, figures });
    }
  }
  quizzes.sort((a, b) => a.track.localeCompare(b.track));
  for (const track of tracks) if (quizzes.filter((q) => q.track === track.slug).length > 1) errors.push(`track ${track.slug}: more than one quiz`);

  // ---- Mini-projects: content/projects/<track>/<id>.md + <id>/starter and <id>/solution ----
  const projects: CompiledProject[] = [];
  const projectDir = join(root, "projects");
  const readFolder = (dir: string): ProjectFile[] =>
    (existsSync(dir) ? walkAll(dir) : []).map((f) => ({ path: relative(dir, f), content: readFileSync(f, "utf8") }));
  for (const trackDir of existsSync(projectDir) ? readdirSync(projectDir).sort() : []) {
    if (!trackSlugs.has(trackDir)) errors.push(`projects/${trackDir}: unknown track folder`);
    for (const fileName of listFiles(join(projectDir, trackDir), ".md")) {
      const file = join(projectDir, trackDir, fileName);
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
      const parsed = ProjectMetaSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...formatZod(rel, parsed.error));
        continue;
      }
      const meta = parsed.data;
      if (`${meta.id}.md` !== fileName) errors.push(`${rel}: id must match file name`);
      if (meta.track !== trackDir) errors.push(`${rel}: track "${meta.track}" must match folder "${trackDir}"`);
      checkReviewed(rel, meta.last_reviewed);
      for (const prereq of meta.prerequisites) if (!lessonIds.has(prereq)) errors.push(`${rel}: unknown prerequisite lesson "${prereq}"`);
      for (const t of meta.related_tracks) if (!trackSlugs.has(t)) errors.push(`${rel}: unknown related track "${t}"`);
      const starter = readFolder(join(projectDir, trackDir, meta.id, "starter"));
      const solution = readFolder(join(projectDir, trackDir, meta.id, "solution"));
      if (starter.length === 0) errors.push(`${rel}: the starter folder projects/${trackDir}/${meta.id}/starter is missing or empty`);
      if (solution.length === 0) errors.push(`${rel}: the solution folder projects/${trackDir}/${meta.id}/solution is missing or empty`);
      const rendered = renderMarkdown(split.body, { media: mediaResolver(media, usedMedia, simulationsById) });
      for (const problem of rendered.problems) errors.push(`${rel}: ${problem}`);
      for (const heading of ["Brief", "Getting started"]) if (!rendered.toc.some((t) => t.text === heading)) errors.push(`${rel}: a project needs a "## ${heading}" section`);
      const checkFile = join(projectDir, trackDir, meta.id, "check.sh");
      const checkScript = existsSync(checkFile) ? readFileSync(checkFile, "utf8") : null;
      if (meta.check_needs && !checkScript) errors.push(`${rel}: check_needs is set but projects/${trackDir}/${meta.id}/check.sh is missing`);
      if (checkScript && /pipefail/.test(checkScript) && pipesIntoQuietGrep(checkScript)) errors.push(`projects/${trackDir}/${meta.id}/check.sh pipes into grep -q, which races with set -o pipefail; use grep_quiet (grep … > /dev/null)`);
      projects.push({ ...meta, html: rendered.html, toc: rendered.toc, starter_files: starter, solution_files: solution, check_script: checkScript });
    }
  }
  projects.sort((a, b) => (a.track === b.track ? a.id.localeCompare(b.id) : a.track.localeCompare(b.track)));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const linkedProjects = new Set<string>();
  for (const track of tracks) {
    for (const item of track.projects) {
      if (!item.project) {
        if (item.status === "available") errors.push(`track ${track.slug}: project "${item.title}" is marked available but names no project page`);
        continue;
      }
      const project = projectsById.get(item.project);
      if (!project) errors.push(`track ${track.slug}: unknown project "${item.project}"`);
      else {
        if (project.track !== track.slug) errors.push(`track ${track.slug}: project "${item.project}" belongs to track ${project.track}`);
        if (item.status !== "available") errors.push(`track ${track.slug}: project "${item.project}" is published, so its status must be "available"`);
        if (project.level !== item.level || project.title !== item.title) errors.push(`track ${track.slug}: title or level of "${item.project}" differs from the project page`);
      }
      linkedProjects.add(item.project);
    }
  }
  for (const project of projects) if (!linkedProjects.has(project.id)) errors.push(`project ${project.id}: not listed in its track's projects`);

  // A planned lab whose task an executed lesson or a checked mini-project already does links there instead.
  for (const track of tracks) {
    const titles = new Set<string>();
    for (const item of track.labs) {
      const where = `track ${track.slug}: lab "${item.title}"`;
      if (titles.has(item.title)) errors.push(`${where} is listed twice`);
      titles.add(item.title);
      if (item.status !== "covered") {
        if (item.lesson || item.in_track || item.why) errors.push(`${where} names a lesson, in_track or why, which only covered labs have`);
        continue;
      }
      if (item.lab || item.mode) errors.push(`${where} is covered by a lesson or project, so it names no lab page and no mode`);
      if (!item.lesson === !item.project) {
        errors.push(`${where} is covered, so it names exactly one lesson or project`);
        continue;
      }
      const owner = item.in_track ?? track.slug;
      if (item.in_track === track.slug) errors.push(`${where}: in_track is only for a lesson or project in another track`);
      if (item.in_track && !trackSlugs.has(item.in_track)) errors.push(`${where}: unknown track "${item.in_track}"`);
      if (item.in_track && !item.why) errors.push(`${where} is covered from another track, so it must say why`);
      const kind = item.lesson ? "lesson" : "project";
      const target = item.lesson ? lessons.find((l) => l.id === item.lesson) : projectsById.get(item.project ?? "");
      if (!target) {
        errors.push(`${where} is covered by unknown ${kind} "${item.lesson ?? item.project}"`);
        continue;
      }
      if (target.track !== owner) errors.push(`${where} is covered by ${kind} "${target.id}" from track ${target.track}${item.in_track ? "" : " (set in_track and why to link across tracks)"}`);
      if (target.level !== item.level) errors.push(`${where}: level must be the ${kind}'s level (${target.level})`);
      if ("verification" in target && target.verification.method !== "executed") errors.push(`${where}: lesson "${target.id}" is not executed by the tests, so it cannot stand in for a lab`);
      if ("check_script" in target && !target.check_script) errors.push(`${where}: project "${target.id}" has no acceptance check, so it cannot stand in for a lab`);
    }
    for (const item of track.projects)
      if (item.status === "covered" || item.lesson || item.in_track || item.why) errors.push(`track ${track.slug}: project "${item.title}" cannot be covered by another item (only labs can)`);
  }

  // ---- Capstones A–G: content/capstones/<id>.md ----------------------------------
  const capstones: CompiledCapstone[] = [];
  const capstoneDir = join(root, "capstones");
  const projectIds = new Set(projects.map((p) => p.id));
  const reuseExists = (r: { kind: string; id: string }) =>
    r.kind === "lesson" ? lessonIds.has(r.id) : r.kind === "lab" ? labsById.has(r.id) : projectIds.has(r.id);
  for (const fileName of listFiles(capstoneDir, ".md")) {
    const file = join(capstoneDir, fileName);
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
    const parsed = CapstoneMetaSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    const meta = parsed.data;
    if (`${meta.id}.md` !== fileName) errors.push(`${rel}: id must match file name`);
    checkReviewed(rel, meta.last_reviewed);
    for (const t of meta.tracks) if (!trackSlugs.has(t)) errors.push(`${rel}: unknown track "${t}"`);
    const milestoneIds = new Set<string>();
    for (const m of meta.milestones) {
      if (milestoneIds.has(m.id)) errors.push(`${rel}: duplicate milestone id "${m.id}"`);
      milestoneIds.add(m.id);
      for (const r of m.reuses) if (!reuseExists(r)) errors.push(`${rel}: milestone "${m.id}" reuses an unknown ${r.kind} "${r.id}"`);
    }
    if (capstones.some((c) => c.letter === meta.letter)) errors.push(`${rel}: another capstone already uses the letter ${meta.letter}`);
    const resolve = mediaResolver(media, usedMedia, simulationsById);
    const key = meta.architecture.replace(/^media:/, "").replace(/\.svg$/, "");
    if (!media.figures.has(key)) errors.push(`${rel}: architecture figure ${meta.architecture} not found`);
    const architectureHtml = media.figures.has(key) ? resolve.figure(meta.architecture.replace(/^media:/, ""), "", "") : "";
    const rendered = renderMarkdown(split.body, { media: resolve });
    for (const problem of rendered.problems) errors.push(`${rel}: ${problem}`);
    for (const heading of ["Brief", "Architecture", "Getting started"]) if (!rendered.toc.some((t) => t.text === heading)) errors.push(`${rel}: a capstone needs a "## ${heading}" section`);
    capstones.push({ ...meta, html: rendered.html, toc: rendered.toc, architecture_html: architectureHtml, paths: [] });
  }
  capstones.sort((a, b) => a.letter.localeCompare(b.letter));
  const capstonesById = new Map(capstones.map((c) => [c.id, c]));
  for (const path of paths) {
    const ref = path.capstone.capstone;
    if (!ref) {
      if (path.capstone.status === "available") errors.push(`path ${path.slug}: the capstone is marked available but names no capstone page`);
      continue;
    }
    const capstone = capstonesById.get(ref);
    if (!capstone) errors.push(`path ${path.slug}: unknown capstone "${ref}"`);
    else {
      if (path.capstone.status !== "available") errors.push(`path ${path.slug}: capstone "${ref}" is published, so its status must be "available"`);
      capstone.paths.push(path.slug);
    }
  }

  // ---- Integrations: content/integrations/<id>.yaml — one per pair of related tracks ------------
  const integrations: Integration[] = [];
  const relatedPairs = new Set(tracks.flatMap((t) => t.related.map((r) => [t.slug, r.slug].sort().join(" "))));
  const integrationDir = join(root, "integrations");
  const seenPairs = new Set<string>();
  for (const fileName of listFiles(integrationDir, ".yaml")) {
    const file = join(integrationDir, fileName);
    const rel = relative(root, file);
    const raw = readYaml(file, errors, root);
    if (raw === undefined) continue;
    const parsed = IntegrationSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    const it = parsed.data;
    if (`${it.id}.yaml` !== fileName) errors.push(`${rel}: id must match file name`);
    checkReviewed(rel, it.last_reviewed);
    const pair = [it.from, it.to].sort().join(" ");
    if (!relatedPairs.has(pair)) errors.push(`${rel}: ${it.from} and ${it.to} are not related tracks (add the relation to a track.yaml first)`);
    if (seenPairs.has(pair)) errors.push(`${rel}: another integration already covers ${it.from} and ${it.to}`);
    seenPairs.add(pair);
    for (const r of it.practise) {
      if (!reuseExists(r)) errors.push(`${rel}: unknown ${r.kind} "${r.id}"`);
      const owner = r.kind === "lesson" ? lessons.find((l) => l.id === r.id)?.track : r.kind === "lab" ? labsById.get(r.id)?.track : projects.find((p) => p.id === r.id)?.track;
      if (owner && owner !== it.from && owner !== it.to) errors.push(`${rel}: ${r.kind} "${r.id}" belongs to ${owner}, not to ${it.from} or ${it.to}`);
    }
    integrations.push(it);
  }
  integrations.sort((a, b) => a.id.localeCompare(b.id));

  // ---- Architecture studio: content/architectures/<id>.md ---------------------------------------
  const architectures: CompiledArchitecture[] = [];
  const archDir = join(root, "architectures");
  for (const fileName of listFiles(archDir, ".md")) {
    const file = join(archDir, fileName);
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
    const parsed = ArchitectureMetaSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    const meta = parsed.data;
    if (`${meta.id}.md` !== fileName) errors.push(`${rel}: id must match file name`);
    checkReviewed(rel, meta.last_reviewed);
    for (const t of meta.tracks) if (!trackSlugs.has(t)) errors.push(`${rel}: unknown track "${t}"`);
    for (const c of meta.components) if (c.track && !meta.tracks.includes(c.track)) errors.push(`${rel}: component "${c.name}" uses track ${c.track}, which is not in tracks`);
    for (const r of meta.learn_more) if (!reuseExists(r)) errors.push(`${rel}: unknown ${r.kind} "${r.id}"`);
    for (const c of meta.capstones) if (!capstonesById.has(c)) errors.push(`${rel}: unknown capstone "${c}"`);
    const resolve = mediaResolver(media, usedMedia, simulationsById);
    const key = meta.diagram.replace(/^media:/, "").replace(/\.svg$/, "");
    if (!media.figures.has(key)) errors.push(`${rel}: diagram ${meta.diagram} not found`);
    const diagramHtml = media.figures.has(key) ? resolve.figure(meta.diagram.replace(/^media:/, ""), "", "") : "";
    const rendered = renderMarkdown(split.body, { media: resolve });
    for (const problem of rendered.problems) errors.push(`${rel}: ${problem}`);
    for (const heading of ["When to use it", "How it works"]) if (!rendered.toc.some((t) => t.text === heading)) errors.push(`${rel}: an architecture needs a "## ${heading}" section`);
    architectures.push({ ...meta, html: rendered.html, toc: rendered.toc, diagram_html: diagramHtml });
  }
  architectures.sort((a, b) => a.id.localeCompare(b.id));

  for (const key of media.figures.keys()) if (!usedMedia.has(`figure:${key}`)) warnings.push(`media/${key}.svg is not used by any lesson, quiz, project, capstone or architecture`);
  for (const key of media.diagrams.keys()) if (!usedMedia.has(`diagram:${key}`)) warnings.push(`media/${key}.steps.yaml is not used by any lesson, quiz or project`);

  // ---- Case studies -------------------------------------------------------
  const caseStudies: CaseStudy[] = [];
  const csDir = join(root, "case-studies");
  for (const fileName of listFiles(csDir, ".yaml")) {
    const file = join(csDir, fileName);
    const rel = relative(root, file);
    const raw = readYaml(file, errors, root);
    if (raw === undefined) continue;
    const parsed = CaseStudySchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(...formatZod(rel, parsed.error));
      continue;
    }
    const cs = parsed.data;
    if (`${cs.id}.yaml` !== fileName) errors.push(`${rel}: id must match file name`);
    checkReviewed(rel, cs.last_reviewed);
    for (const t of cs.tracks) if (!trackSlugs.has(t)) errors.push(`${rel}: unknown track "${t}"`);
    for (const claim of cs.claims) {
      if (claim.checked_on > today) errors.push(`${rel}: a claim's checked_on is in the future`);
      if (claim.published !== "not stated" && claim.published > claim.checked_on) errors.push(`${rel}: a claim was published after it was checked`);
    }
    caseStudies.push(cs);
  }
  caseStudies.sort((a, b) => a.id.localeCompare(b.id));

  // Files made by `npm run new:lesson` (and friends) carry TODO(scaffold) markers until they are written.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(md|ya?ml)$/.test(name) ? [full] : [];
    });
  for (const file of existsSync(root) ? walk(root) : []) {
    if (readFileSync(file, "utf8").includes("TODO(scaffold)")) errors.push(`${relative(root, file)}: still contains TODO(scaffold) placeholders`);
  }

  return {
    bundle: { schema_version: 1, generated_at: now.toISOString(), tracks, paths, lessons, simulations, case_studies: caseStudies, labs, quizzes, projects, capstones, integrations, architectures },
    errors,
    warnings,
    overdueReviews,
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
