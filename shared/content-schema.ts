/**
 * Content schemas — the single source of truth for the shape of all
 * learning content (tracks, learning paths, lessons).
 *
 * Authored content lives in /content as YAML / Markdown. The build step
 * (scripts/build-content.ts) parses it, validates it against these schemas,
 * runs cross-reference checks, and emits build/content.json for the server.
 * Anything that fails validation never reaches learners.
 */
import { z } from "zod/v4";

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case (a-z, 0-9, hyphen)");

/** YAML parses unquoted 2026-01-31 as a Date; normalise both forms to "YYYY-MM-DD". */
export const isoDate = z.preprocess(
  (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .refine((value) => {
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
    }, "must be a real calendar date"),
);

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "external links must use https://");

export const ResourceSchema = z
  .object({
    title: z.string().min(3),
    url: httpsUrl,
    publisher: z.string().min(2),
    type: z.enum([
      "documentation",
      "tutorial",
      "course",
      "reference",
      "video",
      "exercises",
      "source-code",
      "article",
    ]),
    level: z.enum([...LEVELS, "all"]),
    official: z.boolean(),
    why: z.string().min(10, "explain why this resource is recommended"),
    /**
     * Link verification is tracked explicitly. A resource is only shown as
     * "verified" after a human or the link checker confirmed it on a date.
     */
    verification: z
      .object({
        status: z.enum(["unverified", "verified", "broken"]),
        checked_on: isoDate.optional(),
      })
      .strict()
      .refine((v) => v.status === "unverified" || v.checked_on !== undefined, {
        message: "verified/broken resources need checked_on",
      }),
  })
  .strict();
export type Resource = z.infer<typeof ResourceSchema>;

export const CATEGORIES = {
  "source-planning": "Source control & planning",
  "containers-infra": "Containers & infrastructure",
  "ci-cd": "CI/CD & automation servers",
  "data-messaging": "Data, caching & messaging",
  observability: "Monitoring & observability",
  "ai-ml": "AI & machine learning",
  "apis-automation": "APIs & workflow automation",
} as const;
export type Category = keyof typeof CATEGORIES;
const categoryKeys = Object.keys(CATEGORIES) as [Category, ...Category[]];

const ProductSchema = z.object({ name: z.string().min(2), role: z.string().min(10) }).strict();

const TopicSchema = z.object({ title: z.string().min(3), level: z.enum(LEVELS) }).strict();

const PlannedWorkSchema = z
  .object({
    title: z.string().min(3),
    level: z.enum(LEVELS),
    /** read-through | local (learner's own machine) | simulation (browser, clearly labelled). */
    mode: z.enum(["read-through", "local", "simulation"]).optional(),
    status: z.enum(["planned", "available"]),
  })
  .strict();

export const TrackSchema = z
  .object({
    slug,
    number: z.number().int().min(1).max(18),
    title: z.string().min(3),
    short_title: z.string().min(2).max(24),
    category: z.enum(categoryKeys),
    products: z.array(ProductSchema).min(1),
    mental_model: z.string().min(20),
    outcome: z.string().min(20),
    summary: z.string().min(80, "summary must be a real explanation, not a one-liner"),
    problem: z.string().min(40),
    not_this: z.string().min(30),
    architecture_position: z.string().min(30),
    entry_level: z.enum(LEVELS),
    estimated_hours: z
      .object({ min: z.number().positive(), max: z.number().positive() })
      .strict()
      .refine((h) => h.max >= h.min, "max must be >= min"),
    skills_needed: z.array(z.string().min(3)),
    prerequisites: z.array(slug),
    related: z.array(z.object({ slug, why: z.string().min(15) }).strict()),
    topics: z.array(TopicSchema).min(5),
    labs: z.array(PlannedWorkSchema).min(3),
    projects: z.array(PlannedWorkSchema).min(3),
    resources: z.array(ResourceSchema).min(1),
    content_status: z.enum(["outline", "in-progress", "complete"]),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict();
export type Track = z.infer<typeof TrackSchema>;

export const PathSchema = z
  .object({
    slug,
    number: z.number().int().positive(),
    title: z.string().min(3),
    target_learner: z.string().min(20),
    outcome: z.string().min(20),
    prerequisites: z.array(z.string().min(3)),
    modules: z.array(z.object({ track: slug, focus: z.string().min(10) }).strict()).min(3),
    capstone: z.object({ title: z.string().min(3), status: z.enum(["planned", "available"]) }).strict(),
    alternate_route: z.string().min(20),
    last_reviewed: isoDate,
  })
  .strict();
export type LearningPath = z.infer<typeof PathSchema>;

const OptionSchema = z.object({ id: z.string().regex(/^[a-z]$/), text: z.string().min(1) }).strict();

export const SelfCheckSchema = z
  .object({
    id: slug,
    prompt: z.string().min(10),
    options: z.array(OptionSchema).min(2).max(6),
    answer: z.string().regex(/^[a-z]$/),
    explanation: z.string().min(20, "explain why the answer is right"),
  })
  .strict()
  .refine((q) => q.options.some((o) => o.id === q.answer), "answer must match an option id")
  .refine((q) => new Set(q.options.map((o) => o.id)).size === q.options.length, "option ids must be unique");
export type SelfCheck = z.infer<typeof SelfCheckSchema>;

/** Front matter of a lesson Markdown file (content/lessons/<track>/<id>.md). */
export const LessonMetaSchema = z
  .object({
    id: slug,
    title: z.string().min(3),
    track: slug,
    order: z.number().int().positive(),
    level: z.enum(LEVELS),
    estimated_minutes: z.number().int().positive().max(180),
    prerequisites: z.array(slug),
    learning_objectives: z.array(z.string().min(10)).min(1),
    resources: z.array(ResourceSchema),
    self_check: z.array(SelfCheckSchema).min(2, "every lesson needs at least two self-check questions"),
    /**
     * How the lesson's commands and outputs were verified. "executed" lessons
     * contain ```bash run blocks that the test suite runs on every change
     * (scripts/lib/lesson-runner.ts); "pending" lessons have run blocks that
     * need a service (such as PostgreSQL) and whose outputs have not yet been
     * confirmed by a real run — `npm run lessons:record` confirms them;
     * "docs-checked" lessons were checked against official documentation only.
     */
    verification: z
      .object({ method: z.enum(["executed", "pending", "docs-checked"]), details: z.string().min(20) })
      .strict(),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict();
export type LessonMeta = z.infer<typeof LessonMetaSchema>;

/**
 * Sidecar for a figure: content/media/<track>/<name>.yaml next to <name>.svg.
 * The SVG itself is validated by scripts/lib/svg.ts (ADR 0007).
 */
export const MediaMetaSchema = z
  .object({
    /** Text alternative: what the figure shows, for people who cannot see it. */
    alt: z.string().min(20, "alt text must describe what the figure shows"),
    /** Visible caption under the figure. */
    caption: z.string().min(10),
    credit: z.string().min(2),
    /** "project-content" means the same licence as the rest of DevForge's content. */
    licence: z.enum(["project-content", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "Apache-2.0", "MIT"]),
    /** Required for anything not made by the project: where the original came from. */
    source_url: httpsUrl.optional(),
  })
  .strict()
  .refine((m) => m.licence === "project-content" || m.source_url !== undefined, { message: "third-party media need source_url" });
export type MediaMeta = z.infer<typeof MediaMetaSchema>;

/**
 * A step-through diagram: content/media/<track>/<name>.steps.yaml. Elements of
 * the figure with data-step="N" appear at step N (and are highlighted while it
 * is current); data-until="M" hides an element after step M.
 */
export const StepDiagramSchema = z
  .object({
    figure: z.string().regex(/^[a-z0-9-]+\.svg$/, "a figure file name in the same folder, such as commit-flow.svg"),
    title: z.string().min(5),
    steps: z
      .array(z.object({ caption: z.string().min(15, "each step's caption is also its text alternative; make it a full sentence") }).strict())
      .min(2, "a step-through needs at least two steps")
      .max(12),
  })
  .strict();
export type StepDiagram = z.infer<typeof StepDiagramSchema>;

/**
 * A simulation: content/simulations/<track>/<id>.yaml, backed by a model in
 * shared/simulations/ with the same id. Scenario params and challenge
 * solutions are validated against that model by the content loader.
 */
export const SimulationSchema = z
  .object({
    id: slug,
    track: slug,
    title: z.string().min(3),
    concept: z.string().min(40, "explain the concept the simulation makes visible"),
    learning_objectives: z.array(z.string().min(10)).min(1),
    /** What the model leaves out or simplifies — shown next to the "Simulation" badge. */
    simplifications: z.array(z.string().min(15)).min(1, "every simulation must say what it simplifies"),
    text_alternative: z.string().min(80),
    scenarios: z
      .array(z.object({ id: slug, title: z.string().min(3), description: z.string().min(20), params: z.unknown() }).strict())
      .min(1),
    challenges: z.array(
      z
        .object({
          id: slug,
          title: z.string().min(3),
          goal: z.string().min(20),
          scenario: slug,
          /** Name of a check function exported by the model. */
          check: z.string().regex(/^[a-z][a-z0-9-]*$/),
          hint: z.string().min(20),
          /** A reference solution (list of actions); replayed at build time, never sent to browsers. */
          solution: z.array(z.unknown()).min(1).max(100),
        })
        .strict(),
    ),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict();
export type Simulation = z.infer<typeof SimulationSchema>;

/** A lesson after compilation: Markdown rendered to safe HTML plus a table of contents. */
export interface CompiledLesson extends LessonMeta {
  html: string;
  toc: { id: string; text: string }[];
  word_count: number;
}

/** The compiled content bundle the server loads at start-up. */
export interface ContentBundle {
  schema_version: 1;
  generated_at: string;
  tracks: Track[];
  paths: LearningPath[];
  lessons: CompiledLesson[];
  /** Scenario params are normalised by the model's schema; solutions stay server-side. */
  simulations: Simulation[];
}
