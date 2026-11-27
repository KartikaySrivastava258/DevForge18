/** API response shapes (mirrors server/src/routes). */
import type { CaseStudy, LearningPath, Resource, Track } from "../../../shared/content-schema.ts";

export type { CaseStudy, LearningPath, Resource, Track };
export type Level = "beginner" | "intermediate" | "advanced";
export type Role = "student" | "faculty" | "admin";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

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
  entryLevel: Level;
  estimatedHours: { min: number; max: number };
  hasQuiz: boolean;
  contentStatus: "outline" | "in-progress" | "complete";
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
  level: Level;
  estimatedMinutes: number;
}

export interface TracksResponse {
  categories: { id: string; label: string }[];
  tracks: TrackSummary[];
}

export interface TrackResponse {
  track: Track;
  summary: TrackSummary;
  lessons: LessonSummary[];
  simulations: SimulationSummary[];
  caseStudies: CaseStudy[];
  labs: LabSummary[];
  quiz: QuizSummary | null;
  projects: ProjectSummary[];
  prerequisites: TrackSummary[];
  related: { why: string; track: TrackSummary }[];
  paths: { slug: string; title: string; number: number }[];
}

export interface PathsResponse {
  paths: (LearningPath & { estimatedHours: { min: number; max: number } })[];
}

export interface PathResponse {
  path: LearningPath;
  modules: { focus: string; track: TrackSummary | null }[];
  estimatedHours: { min: number; max: number };
  capstone: CapstoneSummary | null;
}

export interface CapstoneSummary {
  id: string;
  letter: string;
  title: string;
  summary: string;
  level: "beginner" | "intermediate" | "advanced";
  estimatedHours: number;
  tracks: string[];
  paths: string[];
}

export interface CapstoneReuse {
  kind: "lesson" | "lab" | "project";
  id: string;
  title: string;
  track: string;
}

export interface PublicCapstone extends CapstoneSummary {
  userStories: string[];
  architectureHtml: string;
  milestones: { id: string; title: string; goal: string; deliverables: string[]; acceptance: string[]; reuses: CapstoneReuse[] }[];
  rubric: { criterion: string; excellent: string; good: string; needs_work: string }[];
  stretchGoals: string[];
  html: string;
  toc: { id: string; text: string }[];
  lastReviewed: string;
}

export interface PublicLesson {
  id: string;
  title: string;
  track: string;
  order: number;
  level: Level;
  estimatedMinutes: number;
  prerequisites: string[];
  learningObjectives: string[];
  resources: Resource[];
  html: string;
  toc: { id: string; text: string }[];
  wordCount: number;
  lastReviewed: string;
  contentVersion: number;
  verification: { method: "executed" | "pending" | "docs-checked"; details: string };
  selfCheck: { id: string; prompt: string; options: { id: string; text: string }[] }[];
  previous: LessonSummary | null;
  next: LessonSummary | null;
}

export interface LessonResponse {
  lesson: PublicLesson;
  track: TrackSummary | null;
}

export interface LessonProgress {
  lessonId: string;
  track: string;
  status: "in_progress" | "completed";
  attempts: number;
  bestScore: number | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface CheckResponse {
  lessonId: string;
  total: number;
  correct: number;
  score: number;
  passed: boolean;
  results: { id: string; correct: boolean; explanation?: string }[];
  saved: boolean;
  progress: LessonProgress | null;
}

export interface ProgressResponse {
  lessons: LessonProgress[];
  tracks: { slug: string; shortTitle: string; completed: number; total: number }[];
  recent: (LessonProgress & { title: string })[];
  totals: { lessonsCompleted: number; lessonsInProgress: number; lessonsAvailable: number };
}

export interface Bookmark {
  type: "track" | "lesson" | "path";
  id: string;
  createdAt: string;
  title: string | null;
  url: string | null;
  available: boolean;
}

export interface SearchResult {
  type: "track" | "path" | "lesson" | "topic";
  id: string;
  title: string;
  url: string;
  snippet: string;
  context: string;
  score: number;
}

export interface SimulationSummary {
  id: string;
  track: string;
  title: string;
  concept: string;
  challengeCount: number;
  scenarioCount: number;
}

export interface PublicSimulation {
  id: string;
  track: string;
  title: string;
  concept: string;
  learningObjectives: string[];
  simplifications: string[];
  textAlternative: string;
  scenarios: { id: string; title: string; description: string; params: unknown }[];
  challenges: { id: string; title: string; goal: string; scenario: string; check: string; hint: string }[];
  lastReviewed: string;
}

export interface SimulationResponse {
  simulation: PublicSimulation;
  track: TrackSummary | null;
  completed: string[];
}

export interface VerifyResponse {
  passed: boolean;
  saved: boolean;
  completed: string[];
}

export type LabMode = "local" | "simulation" | "read-through";
export interface LabSummary {
  id: string;
  title: string;
  track: string;
  level: Level;
  mode: LabMode;
  estimatedMinutes: number;
}
export interface LabProgress {
  labId: string;
  track: string;
  evidence: "self-reported" | "verified";
  completedAt: string;
}
export interface PublicLab extends LabSummary {
  prerequisites: LessonSummary[];
  objectives: string[];
  checkpoints: { id: string; text: string }[];
  simulation: (SimulationSummary & { challenges: { id: string; title: string }[] }) | null;
  questions: { id: string; prompt: string; options: { id: string; text: string }[] }[];
  resources: Resource[];
  html: string;
  toc: { id: string; text: string }[];
  verification: { method: "executed" | "pending" | "docs-checked"; details: string };
  lastReviewed: string;
  contentVersion: number;
}
export interface LabResponse {
  lab: PublicLab;
  track: TrackSummary | null;
  progress: LabProgress | null;
  challengesDone: string[];
}
export interface LabCompleteResponse {
  completed: boolean;
  grade: { total: number; correct: number; passed: boolean; results: { id: string; correct: boolean; explanation?: string }[] } | null;
  progress: LabProgress | null;
}

// ---- Track quizzes and mini-projects ----

export interface QuizItem {
  id: string;
  text: string;
}

interface QuizQuestionBase {
  id: string;
  level: "beginner" | "intermediate" | "advanced";
  prompt: string;
}

export type PublicQuizQuestion =
  | (QuizQuestionBase & { type: "single" | "multiple"; options: QuizItem[] })
  | (QuizQuestionBase & { type: "output"; command: string; output: string; options: QuizItem[] })
  | (QuizQuestionBase & { type: "ordering"; items: QuizItem[] })
  | (QuizQuestionBase & { type: "matching"; left: QuizItem[]; right: QuizItem[] })
  | (QuizQuestionBase & { type: "diagram"; figureHtml: string; targets: QuizItem[]; labels: QuizItem[] });

export interface PublicQuiz {
  id: string;
  track: string;
  title: string;
  description: string;
  passMark: number;
  lastReviewed: string;
  questions: PublicQuizQuestion[];
}

export type QuizAnswer = string | string[] | Record<string, string>;

export interface QuizGradeResponse {
  quizId: string;
  track: string;
  total: number;
  correct: number;
  score: number;
  passMark: number;
  passed: boolean;
  results: { id: string; correct: boolean; explanation?: string; review?: { id: string; title: string } }[];
  saved: boolean;
}

export interface QuizSummary {
  id: string;
  track: string;
  title: string;
  questionCount: number;
  passMark: number;
}

export interface ProjectSummary {
  id: string;
  track: string;
  title: string;
  level: "beginner" | "intermediate" | "advanced";
  estimatedHours: number;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface PublicProject extends ProjectSummary {
  prerequisites: LessonSummary[];
  relatedTracks: string[];
  userStories: string[];
  acceptanceCriteria: string[];
  rubric: { criterion: string; excellent: string; good: string; needs_work: string }[];
  hints: string[];
  stretchGoals: string[];
  html: string;
  toc: { id: string; text: string }[];
  starterFiles: ProjectFile[];
  checkScript: string | null;
  lastReviewed: string;
}

export interface MyQuizResult {
  track: string;
  attempts: number;
  bestScore: number;
  passed: boolean;
  lastAttempt: string;
}
