/**
 * In-memory access to the compiled content bundle (build/content.json).
 * Content is read-only at runtime; changes go through Git review and a rebuild.
 */
import { readFileSync } from "node:fs";
import {
  CATEGORIES,
  type CompiledLesson,
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
  private readonly index: SearchIndex;

  constructor(bundle: ContentBundle) {
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
      challenges: s.challenges.map((c) => ({ id: c.id, title: c.title, goal: c.goal, scenario: c.scenario, hint: c.hint })),
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

  search(query: string, options: { limit?: number; types?: SearchDocType[] }): SearchHit[] {
    return search(this.index, query, options);
  }
}
