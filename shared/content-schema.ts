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
    /** Labs only: the id of the published lab page (content/labs/<track>/<id>.md). */
    lab: slug.optional(),
    /** Projects only: the id of the published project page (content/projects/<track>/<id>.md). */
    project: slug.optional(),
  })
  .strict();

// ---- Alternatives (content/tracks/<slug>/alternatives.yaml) — REMAINING_WORK.md §5 ------------------
export const AlternativeSchema = z
  .object({
    name: z.string().min(2).max(80),
    category: z.string().min(2).max(40),
    /** Official homepage; omitted for options that are not a product ("custom code"). */
    url: httpsUrl.optional(),
    /** As stated by the project; "not stated" when no licence was read (e.g. hosted services). */
    licence: z.string().min(2).max(240),
    /** Where the licence was read (official site or repository). */
    licence_source: httpsUrl.optional(),
    /** Status a learner must know (deprecations, recent licence changes, uncertainty). */
    note: z.string().min(10).max(400).optional(),
    choose_when: z.string().min(15),
    avoid_when: z.string().min(15),
  })
  .strict();
export type Alternative = z.infer<typeof AlternativeSchema>;
export const AlternativesFileSchema = z
  .object({ checked_on: isoDate, alternatives: z.array(AlternativeSchema).min(2).max(6) })
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
/** A track as served: track.yaml plus its alternatives.yaml (when present). */
export type Track = z.infer<typeof TrackSchema> & { alternatives?: Alternative[]; alternatives_checked_on?: string };

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
    /**
     * The lesson's commands set up everything they need from nothing (their own containers, folders and data),
     * so tests run them without replaying the prerequisite lessons first. Prerequisites stay what a learner
     * should read before; this only says the lab does not continue from their state.
     */
    starts_fresh: z.boolean().optional(),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict();
export type LessonMeta = z.infer<typeof LessonMetaSchema>;

/**
 * Front matter of a lab (content/labs/<track>/<id>.md) — REMAINING_WORK.md §4.4.
 * A lab is longer than a lesson's "Try it yourself": a goal, steps, checkpoints
 * and a reset. "local" labs run on the learner's machine; their steps and their
 * check script (a ```bash run check block) are executed by the test suite, and
 * completion is self-reported because a browser cannot prove it. "simulation"
 * labs are completed when the server has verified the listed challenges;
 * "read-through" labs by answering questions about real output, graded on the
 * server.
 */
export const LabMetaSchema = z
  .object({
    id: slug,
    title: z.string().min(3),
    track: slug,
    level: z.enum(LEVELS),
    mode: z.enum(["local", "simulation", "read-through"]),
    estimated_minutes: z.number().int().min(5).max(240),
    /** Lessons to finish first; executed ones are replayed before the lab in tests. */
    prerequisites: z.array(slug),
    objectives: z.array(z.string().min(10)).min(1),
    /** What the learner must see or have; ticked before a local lab counts as done. */
    checkpoints: z.array(z.object({ id: slug, text: z.string().min(10) }).strict()).min(1).max(12),
    simulation: z.object({ id: slug, challenges: z.array(slug).min(1) }).strict().optional(),
    questions: z.array(SelfCheckSchema).optional(),
    resources: z.array(ResourceSchema),
    verification: z
      .object({ method: z.enum(["executed", "pending", "docs-checked"]), details: z.string().min(20) })
      .strict(),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict()
  .refine((l) => l.mode !== "simulation" || l.simulation, { message: "a simulation lab names its simulation and challenges", path: ["simulation"] })
  .refine((l) => l.mode !== "read-through" || (l.questions?.length ?? 0) >= 2, { message: "a read-through lab needs at least two questions", path: ["questions"] })
  .refine((l) => l.mode === "read-through" || !l.questions, { message: "only read-through labs have questions", path: ["questions"] });
export type LabMeta = z.infer<typeof LabMetaSchema>;

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

// ---- Case studies (content/case-studies/<id>.yaml) — REMAINING_WORK.md §3 ----------------------------
/**
 * Every claim about a real organisation carries its primary source: the
 * verbatim quote that supports it, where it was published, and when it was
 * checked. "confirmed" means the organisation or its own staff say it;
 * "inferred" means it is the narrative of someone else (often the vendor's
 * customer-story page) or follows from the source without being said.
 */
export const ClaimSchema = z
  .object({
    text: z.string().min(15),
    quote: z.string().min(10, "quote the source's own words").max(400),
    source_url: httpsUrl,
    source_title: z.string().min(3),
    publisher: z.string().min(2),
    published: z.union([isoDate, z.literal("not stated")]),
    checked_on: isoDate,
    kind: z.enum(["confirmed", "inferred"]),
    /** Who said it, or how the date was found. */
    note: z.string().min(5).max(400).optional(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

export const CaseStudySchema = z
  .object({
    id: slug,
    organisation: z.string().min(2),
    tracks: z.array(slug).min(1),
    summary: z.string().min(30),
    claims: z.array(ClaimSchema).min(1),
    lessons_learned: z.array(z.string().min(15)).min(1),
    /** What a reader should keep in mind (vendor page, historical post…). */
    caveat: z.string().min(10).optional(),
    owner: z.string().min(2),
    last_reviewed: isoDate,
  })
  .strict();
export type CaseStudy = z.infer<typeof CaseStudySchema>;

// --- Quizzes (REMAINING_WORK §4.7): one per track, mixing levels; graded on the server, answers never sent before grading.

const QuizItemSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/), text: z.string().min(1) }).strict();
const quizBase = {
  id: slug,
  level: z.enum(LEVELS),
  /** The lesson that teaches this, so a wrong answer can point the learner to it. */
  lesson: slug,
  prompt: z.string().min(10),
  explanation: z.string().min(20, "explain why the answer is right"),
};
const uniqueIds = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

export const QuizQuestionSchema = z.discriminatedUnion("type", [
  z.object({ ...quizBase, type: z.literal("single"), options: z.array(OptionSchema).min(2).max(6), answer: z.string().regex(/^[a-z]$/) })
    .strict()
    .refine((q) => uniqueIds(q.options) && q.options.some((o) => o.id === q.answer), "answer must be one of unique option ids"),
  z.object({ ...quizBase, type: z.literal("multiple"), options: z.array(OptionSchema).min(3).max(8), answers: z.array(z.string().regex(/^[a-z]$/)).min(1) })
    .strict()
    .refine((q) => uniqueIds(q.options) && q.answers.every((a) => q.options.some((o) => o.id === a)) && new Set(q.answers).size === q.answers.length,
      "answers must be distinct option ids"),
  z.object({ ...quizBase, type: z.literal("ordering"), items: z.array(QuizItemSchema).min(3).max(8), order: z.array(z.string()).min(3) })
    .strict()
    .refine((q) => uniqueIds(q.items) && q.order.length === q.items.length && q.items.every((i) => q.order.includes(i.id)),
      "order must list every item id exactly once"),
  z.object({ ...quizBase, type: z.literal("matching"), left: z.array(QuizItemSchema).min(2).max(8), right: z.array(QuizItemSchema).min(2).max(10),
    pairs: z.record(z.string(), z.string()) })
    .strict()
    .refine((q) => uniqueIds(q.left) && uniqueIds(q.right) && q.left.every((l) => q.right.some((r) => r.id === q.pairs[l.id])) &&
      Object.keys(q.pairs).length === q.left.length, "pairs must map every left id to a right id"),
  z.object({ ...quizBase, type: z.literal("output"), command: z.string().min(1), output: z.string().min(1),
    options: z.array(OptionSchema).min(2).max(6), answer: z.string().regex(/^[a-z]$/) })
    .strict()
    .refine((q) => uniqueIds(q.options) && q.options.some((o) => o.id === q.answer), "answer must be one of unique option ids"),
  z.object({ ...quizBase, type: z.literal("diagram"), media: z.string().regex(/^media:[a-z0-9-]+\/[a-z0-9-]+\.svg$/),
    targets: z.array(QuizItemSchema).min(2).max(8), labels: z.array(QuizItemSchema).min(2).max(10), answers: z.record(z.string(), z.string()) })
    .strict()
    .refine((q) => uniqueIds(q.targets) && uniqueIds(q.labels) && q.targets.every((t) => q.labels.some((l) => l.id === q.answers[t.id])) &&
      Object.keys(q.answers).length === q.targets.length, "answers must label every target"),
]);
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizSchema = z
  .object({
    id: slug,
    track: slug,
    title: z.string().min(3),
    description: z.string().min(20),
    /** Share of questions that must be correct to pass (and, on learning paths, to skip the module). */
    pass_mark: z.number().min(0.5).max(1),
    questions: z.array(QuizQuestionSchema).min(8).max(30),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict()
  .refine((q) => uniqueIds(q.questions), "question ids must be unique")
  .refine((q) => LEVELS.every((level) => q.questions.some((x) => x.level === level)), "a track quiz must mix all three levels");
export type Quiz = z.infer<typeof QuizSchema>;
/** A quiz after compilation: diagram questions carry their figure as safe HTML (keyed by question id). */
export type CompiledQuiz = Quiz & { figures: Record<string, string> };

// --- Mini-projects (REMAINING_WORK §4.5): brief, stories, testable acceptance criteria, rubric, starter, hints, faculty-only solution.

export const ProjectMetaSchema = z
  .object({
    id: slug,
    track: slug,
    title: z.string().min(3),
    level: z.enum(LEVELS),
    estimated_hours: z.number().positive().max(40),
    prerequisites: z.array(slug),
    related_tracks: z.array(slug),
    user_stories: z.array(z.string().regex(/^As an? .+, I want .+ so that .+/, "write stories as: As a …, I want … so that …")).min(2),
    acceptance_criteria: z.array(z.string().min(15)).min(3),
    rubric: z
      .array(z.object({ criterion: z.string().min(3), excellent: z.string().min(10), good: z.string().min(10), needs_work: z.string().min(10) }).strict())
      .min(3),
    hints: z.array(z.string().min(15)).min(2),
    stretch_goals: z.array(z.string().min(10)).min(1),
    /** Folder under projects/<track>/<id>/ that learners start from; must exist. */
    starter: z.literal("starter"),
    /** Folder with the reference solution; served to faculty and admins only. */
    solution: z.literal("solution"),
    owner: z.string().min(2),
    last_reviewed: isoDate,
    content_version: z.number().int().positive(),
  })
  .strict();
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export interface ProjectFile {
  path: string;
  content: string;
}

export interface CompiledProject extends ProjectMeta {
  html: string;
  toc: { id: string; text: string }[];
  starter_files: ProjectFile[];
  /** Never sent to students; the server strips it from public responses. */
  solution_files: ProjectFile[];
}

/** A lesson after compilation: Markdown rendered to safe HTML plus a table of contents. */
export interface CompiledLesson extends LessonMeta {
  html: string;
  toc: { id: string; text: string }[];
  word_count: number;
}

export interface CompiledLab extends LabMeta {
  html: string;
  toc: { id: string; text: string }[];
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
  case_studies: CaseStudy[];
  labs: CompiledLab[];
  quizzes: CompiledQuiz[];
  projects: CompiledProject[];
}
