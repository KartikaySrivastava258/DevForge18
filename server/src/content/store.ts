/**
 * In-memory access to the compiled content bundle (build/content.json).
 * Content is read-only at runtime; changes go through Git review and a rebuild.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type CaseStudy,
  type CompiledLab,
  CATEGORIES,
  type CompiledLesson,
  type CompiledProject,
  type CompiledQuiz,
  type QuizQuestion,
  type ContentBundle,
  type LearningPath,
  type Simulation,
  type Track,
} from "../../../shared/content-schema.ts";
import { buildSearchDocs, buildSearchIndex, search, type SearchDocType, type SearchHit, type SearchIndex } from "../../../shared/search.ts";

export interface TrackSummary {
  slug: string;
  number: number;
  title: string;
  shortTitle: string;
  category: string;
  categoryLabel: string;
  products: string[];
  mentalModel: string;
  outcome: string;
  entryLevel: string;
  estimatedHours: { min: number; max: number };
  contentStatus: string;
  lessonCount: number;
  topicCount: number;
  prerequisites: string[];
  related: { slug: string; why: string }[];
}

export interface LessonSummary {
  id: string;
  title: string;
  track: string;
  order: number;
  level: string;
  estimatedMinutes: number;
}

export interface GradeResult {
  lessonId: string;
  total: number;
  correct: number;
  score: number;
  passed: boolean;
  results: { id: string; correct: boolean; explanation?: string }[];
}

export class ContentStore {
  readonly bundle: ContentBundle;
  private readonly tracks = new Map<string, Track>();
  private readonly paths = new Map<string, LearningPath>();
  private readonly lessons = new Map<string, CompiledLesson>();
  private readonly lessonsByTrack = new Map<string, CompiledLesson[]>();
  private readonly simulations = new Map<string, Simulation>();
  private readonly labs = new Map<string, CompiledLab>();
  private readonly quizzes = new Map<string, CompiledQuiz>();
  private readonly projects = new Map<string, CompiledProject>();
  private readonly index: SearchIndex;

  constructor(bundle: ContentBundle) {
    for (const q of bundle.quizzes ?? []) this.quizzes.set(q.track, q);
    for (const p of bundle.projects ?? []) this.projects.set(p.id, p);
    if (bundle.schema_version !== 1) throw new Error(`Unsupported content schema_version ${String(bundle.schema_version)}`);
    this.bundle = bundle;
    for (const t of bundle.tracks) this.tracks.set(t.slug, t);
    for (const p of bundle.paths) this.paths.set(p.slug, p);
    for (const l of bundle.lessons) {
      this.lessons.set(l.id, l);
      const list = this.lessonsByTrack.get(l.track) ?? [];
      list.push(l);
      this.lessonsByTrack.set(l.track, list);
    }
    for (const list of this.lessonsByTrack.values()) list.sort((a, b) => a.order - b.order);
    for (const s of bundle.simulations ?? []) this.simulations.set(s.id, s);
    for (const l of bundle.labs ?? []) this.labs.set(l.id, l);
    this.index = buildSearchIndex(buildSearchDocs(bundle));
  }

  static fromFile(path: string): ContentStore {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      throw new Error(`Content bundle not found at ${path}. Run "npm run content:build" first.`);
    }
    return new ContentStore(JSON.parse(raw) as ContentBundle);
  }

  listTracks(): Track[] { return this.bundle.tracks; }
  getTrack(slug: string): Track | undefined { return this.tracks.get(slug); }
  listPaths(): LearningPath[] { return this.bundle.paths; }
  getPath(slug: string): LearningPath | undefined { return this.paths.get(slug); }
  getLesson(id: string): CompiledLesson | undefined { return this.lessons.get(id); }
  lessonsFor(track: string): CompiledLesson[] { return this.lessonsByTrack.get(track) ?? []; }
  getSimulation(id: string): Simulation | undefined { return this.simulations.get(id); }
  caseStudiesFor(track: string): CaseStudy[] { return (this.bundle.case_studies ?? []).filter((c) => c.tracks.includes(track)); }
  getLab(id: string): CompiledLab | undefined { return this.labs.get(id); }
  labsFor(track: string): CompiledLab[] { return [...this.labs.values()].filter((l) => l.track === track); }

  labSummary(l: CompiledLab) {
    return { id: l.id, title: l.title, track: l.track, level: l.level, mode: l.mode, estimatedMinutes: l.estimated_minutes };
  }

  /** The lab as sent to browsers: question answers and explanations removed. */
  publicLab(l: CompiledLab) {
    const sim = l.simulation ? this.simulations.get(l.simulation.id) : undefined;
    return {
      ...this.labSummary(l),
      prerequisites: l.prerequisites.map((id) => this.lessons.get(id)).filter((x): x is CompiledLesson => !!x).map((x) => this.lessonSummary(x)),
      objectives: l.objectives,
      checkpoints: l.checkpoints,
      simulation: sim && l.simulation ? { ...this.simulationSummary(sim), challenges: sim.challenges.filter((c) => l.simulation?.challenges.includes(c.id)).map((c) => ({ id: c.id, title: c.title })) } : null,
      questions: (l.questions ?? []).map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
      resources: l.resources,
      html: l.html,
      toc: l.toc,
      verification: l.verification,
      lastReviewed: l.last_reviewed,
      contentVersion: l.content_version,
    };
  }

  /** Grade a read-through lab's questions; explanations only for correct answers (as for lessons). */
  gradeLab(labId: string, answers: Record<string, string>) {
    const lab = this.labs.get(labId);
    if (!lab) return undefined;
    const results = (lab.questions ?? []).map((q) => (answers[q.id] === q.answer ? { id: q.id, correct: true, explanation: q.explanation } : { id: q.id, correct: false }));
    const correct = results.filter((r) => r.correct).length;
    return { total: results.length, correct, passed: results.length > 0 && correct === results.length, results };
  }

  simulationsFor(track: string): Simulation[] { return [...this.simulations.values()].filter((s) => s.track === track); }

  simulationSummary(s: Simulation) {
    return { id: s.id, track: s.track, title: s.title, concept: s.concept, challengeCount: s.challenges.length, scenarioCount: s.scenarios.length };
  }

  /** The simulation as sent to browsers: reference solutions removed (like self-check answers). */
  publicSimulation(s: Simulation) {
    return {
      id: s.id,
      track: s.track,
      title: s.title,
      concept: s.concept,
      learningObjectives: s.learning_objectives,
      simplifications: s.simplifications,
      textAlternative: s.text_alternative,
      scenarios: s.scenarios,
      // The check's name is public (the model runs in the browser anyway); the reference solution is not.
      challenges: s.challenges.map((c) => ({ id: c.id, title: c.title, goal: c.goal, scenario: c.scenario, check: c.check, hint: c.hint })),
      lastReviewed: s.last_reviewed,
    };
  }
  hasItem(type: "track" | "lesson" | "path", id: string): boolean {
    return type === "track" ? this.tracks.has(id) : type === "lesson" ? this.lessons.has(id) : this.paths.has(id);
  }

  summarise(track: Track): TrackSummary {
    return {
      slug: track.slug,
      number: track.number,
      title: track.title,
      shortTitle: track.short_title,
      category: track.category,
      categoryLabel: CATEGORIES[track.category],
      products: track.products.map((p) => p.name),
      mentalModel: track.mental_model,
      outcome: track.outcome,
      entryLevel: track.entry_level,
      estimatedHours: track.estimated_hours,
      contentStatus: track.content_status,
      lessonCount: this.lessonsFor(track.slug).length,
      topicCount: track.topics.length,
      prerequisites: track.prerequisites,
      related: track.related,
    };
  }

  lessonSummary(l: CompiledLesson): LessonSummary {
    return { id: l.id, title: l.title, track: l.track, order: l.order, level: l.level, estimatedMinutes: l.estimated_minutes };
  }

  /** The lesson as sent to browsers: self-check answers and explanations removed. */
  publicLesson(l: CompiledLesson) {
    const siblings = this.lessonsFor(l.track);
    const position = siblings.findIndex((s) => s.id === l.id);
    const prev = position > 0 ? siblings[position - 1] : undefined;
    const next = position >= 0 ? siblings[position + 1] : undefined;
    return {
      id: l.id,
      title: l.title,
      track: l.track,
      order: l.order,
      level: l.level,
      estimatedMinutes: l.estimated_minutes,
      prerequisites: l.prerequisites,
      learningObjectives: l.learning_objectives,
      resources: l.resources,
      html: l.html,
      toc: l.toc,
      wordCount: l.word_count,
      lastReviewed: l.last_reviewed,
      contentVersion: l.content_version,
      verification: l.verification,
      selfCheck: l.self_check.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
      previous: prev ? this.lessonSummary(prev) : null,
      next: next ? this.lessonSummary(next) : null,
    };
  }

  /**
   * Grade a self-check. Explanations are returned only for correct answers,
   * so a wrong attempt does not simply reveal the answer — the learner
   * re-reads and tries again (productive struggle over answer-copying).
   */
  grade(lessonId: string, answers: Record<string, string>): GradeResult | undefined {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) return undefined;
    const results = lesson.self_check.map((q) => {
      const correct = answers[q.id] === q.answer;
      return correct ? { id: q.id, correct, explanation: q.explanation } : { id: q.id, correct };
    });
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    return { lessonId, total, correct, score: total ? correct / total : 0, passed: correct === total, results };
  }

  // ---- Quizzes ---------------------------------------------------------------

  getQuiz(track: string): CompiledQuiz | undefined { return this.quizzes.get(track); }

  quizSummary(q: CompiledQuiz) {
    return { id: q.id, track: q.track, title: q.title, questionCount: q.questions.length, passMark: q.pass_mark };
  }

  /** The quiz as sent to browsers: no answers, and items to order or match in a stable shuffled order. */
  publicQuiz(q: CompiledQuiz) {
    return {
      id: q.id,
      track: q.track,
      title: q.title,
      description: q.description,
      passMark: q.pass_mark,
      lastReviewed: q.last_reviewed,
      questions: q.questions.map((x) => publicQuestion(q, x)),
    };
  }

  /**
   * Grade a quiz. As with self-checks, a wrong answer gets the lesson to revisit, not the explanation,
   * so the answer is not simply revealed; correct answers get the explanation.
   */
  gradeQuiz(track: string, answers: Record<string, QuizAnswer>) {
    const quiz = this.quizzes.get(track);
    if (!quiz) return undefined;
    const results = quiz.questions.map((q) => {
      const correct = isCorrect(q, answers[q.id]);
      const lesson = this.lessons.get(q.lesson);
      const review = { id: q.lesson, title: lesson?.title ?? q.lesson };
      return correct ? { id: q.id, correct, explanation: q.explanation } : { id: q.id, correct, review };
    });
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    const score = total ? correct / total : 0;
    return { quizId: quiz.id, track, total, correct, score, passMark: quiz.pass_mark, passed: score >= quiz.pass_mark, results };
  }

  // ---- Projects --------------------------------------------------------------

  getProject(id: string): CompiledProject | undefined { return this.projects.get(id); }
  projectsFor(track: string): CompiledProject[] { return [...this.projects.values()].filter((p) => p.track === track); }

  projectSummary(p: CompiledProject) {
    return { id: p.id, track: p.track, title: p.title, level: p.level, estimatedHours: p.estimated_hours };
  }

  /** Everything a learner sees: never the reference solution. */
  publicProject(p: CompiledProject) {
    return {
      ...this.projectSummary(p),
      prerequisites: p.prerequisites.map((id) => { const l = this.lessons.get(id); return l ? this.lessonSummary(l) : null; }).filter(Boolean),
      relatedTracks: p.related_tracks,
      userStories: p.user_stories,
      acceptanceCriteria: p.acceptance_criteria,
      rubric: p.rubric,
      hints: p.hints,
      stretchGoals: p.stretch_goals,
      html: p.html,
      toc: p.toc,
      starterFiles: p.starter_files,
      lastReviewed: p.last_reviewed,
    };
  }

  /** The reference solution, for faculty and admins only (the route enforces the role). */
  projectSolution(p: CompiledProject) {
    return { id: p.id, files: p.solution_files };
  }

  search(query: string, options: { limit?: number; types?: SearchDocType[] }): SearchHit[] {
    return search(this.index, query, options);
  }
}

export type QuizAnswer = string | string[] | Record<string, string>;

/** A stable shuffle (same order every time for a quiz), never equal to the given order. */
function stableShuffle<T extends { id: string }>(quizId: string, items: T[]): T[] {
  const key = (i: T) => createHash("sha256").update(`${quizId}:${i.id}`).digest("hex");
  const shuffled = [...items].sort((a, b) => key(a).localeCompare(key(b)));
  return shuffled.every((x, n) => x.id === items[n]?.id) ? [...shuffled.slice(1), ...shuffled.slice(0, 1)] : shuffled;
}

function publicQuestion(quiz: CompiledQuiz, q: QuizQuestion) {
  const base = { id: q.id, type: q.type, level: q.level, prompt: q.prompt };
  switch (q.type) {
    case "single":
      return { ...base, options: q.options };
    case "multiple":
      return { ...base, options: q.options };
    case "output":
      return { ...base, command: q.command, output: q.output, options: q.options };
    case "ordering":
      return { ...base, items: stableShuffle(`${quiz.id}:${q.id}`, q.items) };
    case "matching":
      return { ...base, left: q.left, right: stableShuffle(`${quiz.id}:${q.id}`, q.right) };
    case "diagram":
      return { ...base, figureHtml: quiz.figures[q.id] ?? "", targets: q.targets, labels: stableShuffle(`${quiz.id}:${q.id}`, q.labels) };
  }
}

function isCorrect(q: QuizQuestion, answer: QuizAnswer | undefined): boolean {
  if (answer === undefined) return false;
  switch (q.type) {
    case "single":
    case "output":
      return answer === q.answer;
    case "multiple":
      return Array.isArray(answer) && answer.length === q.answers.length && q.answers.every((a) => answer.includes(a));
    case "ordering":
      return Array.isArray(answer) && answer.length === q.order.length && q.order.every((id, n) => answer[n] === id);
    case "matching":
      return typeof answer === "object" && !Array.isArray(answer) && Object.entries(q.pairs).every(([l, r]) => answer[l] === r);
    case "diagram":
      return typeof answer === "object" && !Array.isArray(answer) && Object.entries(q.answers).every(([t, l]) => answer[t] === l);
  }
}
