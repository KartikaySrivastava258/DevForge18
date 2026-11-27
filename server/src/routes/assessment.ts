/**
 * Track quizzes and mini-projects (REMAINING_WORK.md §4.5, §4.7).
 * Quizzes are graded here and answers never leave the server before grading; project reference
 * solutions are served to faculty and admins only.
 */
import { z } from "zod/v4";
import { ok, readJson } from "../http/context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const id = z.string().regex(/^[a-z0-9-]{1,32}$/);
const Answer = z.union([z.string().regex(/^[a-z]$/), z.array(id).max(10), z.record(id, id)]);
const GradeBody = z.object({
  answers: z.record(z.string().max(64), Answer).refine((a) => Object.keys(a).length <= 30, "Too many answers."),
});

interface AttemptRow {
  track_slug: string;
  attempts: number;
  best_score: number;
  passed: number;
  last_attempt: string;
}

export function registerAssessmentRoutes(router: Router, { db, content }: AppDeps): void {
  router.get("/api/tracks/:slug/quiz", (ctx) => {
    const quiz = content.getQuiz(ctx.params.slug ?? "");
    if (!quiz) throw notFound("Quiz");
    return ok({ quiz: content.publicQuiz(quiz) });
  });

  // Public so anyone can practise; attempts are saved only for signed-in users.
  router.post("/api/tracks/:slug/quiz/grade", async (ctx) => {
    const quiz = content.getQuiz(ctx.params.slug ?? "");
    if (!quiz) throw notFound("Quiz");
    const { answers } = await readJson(ctx, GradeBody);
    const missing = quiz.questions.filter((q) => !(q.id in answers)).map((q) => q.id);
    if (missing.length > 0) {
      throw new HttpError(400, "validation_failed", "Answer every question before grading.", missing.map((field) => ({ field, message: "Not answered." })));
    }
    const grade = content.gradeQuiz(quiz.track, answers);
    if (!grade) throw notFound("Quiz");
    if (!ctx.user) return ok({ ...grade, saved: false });
    db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      ctx.user.id, quiz.id, quiz.track, grade.score, grade.passed ? 1 : 0, new Date().toISOString(),
    );
    return ok({ ...grade, saved: true });
  });

  router.get(
    "/api/me/quizzes",
    (ctx) => {
      const rows = db
        .prepare(
          `SELECT track_slug, COUNT(*) AS attempts, MAX(score) AS best_score, MAX(passed) AS passed, MAX(attempted_at) AS last_attempt
           FROM quiz_attempts WHERE user_id = ? GROUP BY track_slug ORDER BY track_slug`,
        )
        .all(ctx.user?.id ?? "") as unknown as AttemptRow[];
      return ok({
        quizzes: rows
          .filter((r) => content.getQuiz(r.track_slug))
          .map((r) => ({ track: r.track_slug, attempts: r.attempts, bestScore: r.best_score, passed: r.passed === 1, lastAttempt: r.last_attempt })),
      });
    },
    { auth: "user" },
  );

  router.get("/api/tracks/:slug/projects", (ctx) => {
    const track = content.getTrack(ctx.params.slug ?? "");
    if (!track) throw notFound("Track");
    return ok({ projects: content.projectsFor(track.slug).map((p) => content.projectSummary(p)) });
  });

  router.get("/api/projects/:id", (ctx) => {
    const project = content.getProject(ctx.params.id ?? "");
    if (!project) throw notFound("Project");
    return ok({ project: content.publicProject(project) });
  });

  router.get(
    "/api/projects/:id/solution",
    (ctx) => {
      const project = content.getProject(ctx.params.id ?? "");
      if (!project) throw notFound("Project");
      return ok({ solution: content.projectSolution(project) });
    },
    { auth: ["faculty", "admin"] },
  );
}
