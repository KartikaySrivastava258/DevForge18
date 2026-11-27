/**
 * Which content files the editor may change, and the per-file validation it
 * runs before a pull request is opened (ADR 0011).
 *
 * Only files whose location has a schema are editable, so every submission is
 * checked against the same zod schema and YAML parser the build uses
 * (shared/content-schema.ts, scripts/lib/yaml.ts). Checks that need other
 * files — links between lessons, tracks and paths, media, prerequisites — are
 * left to CI on the pull request.
 */
import type { ZodType } from "zod/v4";
import { splitFrontMatter } from "../../../scripts/lib/front-matter.ts";
import { parseYaml } from "../../../scripts/lib/yaml.ts";
import {
  AlternativesFileSchema,
  ArchitectureMetaSchema,
  CapstoneMetaSchema,
  CaseStudySchema,
  IntegrationSchema,
  LabMetaSchema,
  LessonMetaSchema,
  PathSchema,
  ProjectMetaSchema,
  QuizSchema,
  SimulationSchema,
  TrackSchema,
} from "../../../shared/content-schema.ts";

/** Largest file the editor accepts (UTF-8 bytes): about 3× the largest lesson today. */
export const MAX_CONTENT_BYTES = 64 * 1024;
export const MAX_PATH_LENGTH = 200;

type Fields = Record<string, unknown>;

interface Rule {
  kind: string;
  label: string;
  /** Matches the whole path; named groups: `folder` (track folder) and `id` (file name without extension). */
  pattern: RegExp;
  format: "markdown" | "yaml";
  schema: ZodType<unknown>;
  /** Field that must equal the file name without extension. */
  idField?: "id" | "slug";
  /** Field that must equal the folder name. */
  folderField?: "track" | "slug";
}

const F = "(?<folder>[a-z0-9][a-z0-9-]*)";
const S = "(?<id>[a-z0-9][a-z0-9-]*)";
const RULES: Rule[] = [
  { kind: "lesson", label: "Lesson", pattern: new RegExp(`^content/lessons/${F}/${S}\\.md$`), format: "markdown", schema: LessonMetaSchema, idField: "id", folderField: "track" },
  { kind: "lab", label: "Lab", pattern: new RegExp(`^content/labs/${F}/${S}\\.md$`), format: "markdown", schema: LabMetaSchema, idField: "id", folderField: "track" },
  { kind: "quiz", label: "Quiz", pattern: new RegExp(`^content/quizzes/${F}/${S}\\.yaml$`), format: "yaml", schema: QuizSchema, idField: "id", folderField: "track" },
  { kind: "project", label: "Project", pattern: new RegExp(`^content/projects/${F}/${S}\\.md$`), format: "markdown", schema: ProjectMetaSchema, idField: "id", folderField: "track" },
  { kind: "simulation", label: "Simulation", pattern: new RegExp(`^content/simulations/${F}/${S}\\.yaml$`), format: "yaml", schema: SimulationSchema, idField: "id", folderField: "track" },
  { kind: "case-study", label: "Case study", pattern: new RegExp(`^content/case-studies/${S}\\.yaml$`), format: "yaml", schema: CaseStudySchema, idField: "id" },
  { kind: "capstone", label: "Capstone", pattern: new RegExp(`^content/capstones/${S}\\.md$`), format: "markdown", schema: CapstoneMetaSchema, idField: "id" },
  { kind: "architecture", label: "Reference architecture", pattern: new RegExp(`^content/architectures/${S}\\.md$`), format: "markdown", schema: ArchitectureMetaSchema, idField: "id" },
  { kind: "integration", label: "Integration", pattern: new RegExp(`^content/integrations/${S}\\.yaml$`), format: "yaml", schema: IntegrationSchema, idField: "id" },
  { kind: "path", label: "Learning path", pattern: new RegExp(`^content/paths/${S}\\.yaml$`), format: "yaml", schema: PathSchema, idField: "slug" },
  { kind: "track", label: "Track", pattern: new RegExp(`^content/tracks/${F}/track\\.yaml$`), format: "yaml", schema: TrackSchema, folderField: "slug" },
  { kind: "alternatives", label: "Track alternatives", pattern: new RegExp(`^content/tracks/${F}/alternatives\\.yaml$`), format: "yaml", schema: AlternativesFileSchema },
];

export const EDITABLE_KINDS = RULES.map((r) => ({ kind: r.kind, label: r.label }));

export type PathCheck = { ok: true; kind: string; label: string; rule: Rule; match: RegExpExecArray } | { ok: false; message: string };

/**
 * Accept only relative paths under content/ with .md or .yaml extensions, made of plain
 * segments (no "..", ".", empty, absolute, backslash, percent-encoded or control characters),
 * at a location that has a schema.
 */
export function checkContentPath(input: unknown): PathCheck {
  if (typeof input !== "string" || input.length === 0) return { ok: false, message: "Choose a content file." };
  if (input.length > MAX_PATH_LENGTH) return { ok: false, message: `The path is longer than ${MAX_PATH_LENGTH} characters.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\%]/.test(input)) return { ok: false, message: "The path contains characters that are not allowed." };
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) return { ok: false, message: "Use a path relative to the repository, starting with content/." };
  const segments = input.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return { ok: false, message: 'The path must not contain empty, "." or ".." segments.' };
  if (segments[0] !== "content") return { ok: false, message: "Only files under content/ can be edited." };
  if (!/\.(md|yaml)$/.test(input)) return { ok: false, message: "Only .md and .yaml files can be edited." };
  for (const rule of RULES) {
    const match = rule.pattern.exec(input);
    if (match) return { ok: true, kind: rule.kind, label: rule.label, rule, match };
  }
  return { ok: false, message: "This file is not editable here: the editor only changes files it can check against a content schema." };
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";

/** Validate one file's text. Returns human-readable problems; an empty list means valid. */
export function validateContentFile(check: Extract<PathCheck, { ok: true }>, content: string): string[] {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) return [`The file is larger than ${MAX_CONTENT_BYTES / 1024} KB.`];
  if (content.includes("\u0000")) return ["The file contains a NUL character."];
  const { rule, match } = check;

  let raw: unknown;
  if (rule.format === "markdown") {
    const split = splitFrontMatter(content);
    if (!split) return ["Missing YAML front matter: the file must start with a line ---, the fields, and another line ---."];
    try {
      raw = parseYaml(split.frontMatter);
    } catch (err) {
      return [`Invalid front matter: ${firstLine(err)}`];
    }
    if (split.body.trim().length === 0) return ["The Markdown body after the front matter is empty."];
  } else {
    try {
      raw = parseYaml(content);
    } catch (err) {
      return [`Invalid YAML: ${firstLine(err)}`];
    }
  }

  const parsed = rule.schema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

  const data = parsed.data as Fields;
  const problems: string[] = [];
  const folder = match.groups?.folder;
  const fileId = match.groups?.id;
  if (rule.idField && fileId !== undefined && data[rule.idField] !== fileId) {
    problems.push(`${rule.idField}: must match the file name ("${fileId}"); renaming files is done through Git`);
  }
  if (rule.folderField && folder !== undefined && data[rule.folderField] !== folder) {
    problems.push(`${rule.folderField}: must match the folder ("${folder}")`);
  }
  return problems;
}
