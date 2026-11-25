import { z } from "zod/v4";
import type { Db } from "../db/database.ts";
import { ok, noContent, readJson } from "../http/context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const CheckBody = z.object({
  answers: z
    .record(z.string().max(64), z.string().regex(/^[a-z]$/, "Answers are option letters."))
    .refine((a) => Object.keys(a).length <= 30, "Too many answers."),
});

const BOOKMARK_TYPES = ["track", "lesson", "path"] as const;
type BookmarkType = (typeof BOOKMARK_TYPES)[number];
const isBookmarkType = (v: string): v is BookmarkType => (BOOKMARK_TYPES as readonly string[]).includes(v);

interface ProgressRow {
  lesson_id: string;
  track_slug: string;
  status: "in_progress" | "completed";
  attempts: number;
  best_score: number | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

const toProgress = (r: ProgressRow) => ({
  lessonId: r.lesson_id,
  track: r.track_slug,
  status: r.status,
  attempts: r.attempts,
  bestScore: r.best_score,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  updatedAt: r.updated_at,
});

function getProgress(db: Db, userId: string, lessonId: string): ProgressRow | undefined {
  return db.prepare("SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?").get(userId, lessonId) as ProgressRow | undefined;
}

export function registerLearningRoutes(router: Router, { db, content }: AppDeps): void {
  router.post(
    "/api/lessons/:id/start",
    (ctx) => {
      const lesson = content.getLesson(ctx.params.id ?? "");
      if (!lesson) throw notFound("Lesson");
      const userId = ctx.user?.id ?? "";
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO lesson_progress (user_id, lesson_id, track_slug, status, attempts, started_at, updated_at)
         VALUES (?, ?, ?, 'in_progress', 0, ?, ?)
         ON CONFLICT (user_id, lesson_id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(userId, lesson.id, lesson.track, now, now);
      const row = getProgress(db, userId, lesson.id);
      return ok({ progress: row ? toProgress(row) : null });
    },
    { auth: "user" },
  );

  // Public so anyone can practise; progress is saved only for signed-in users.
  router.post("/api/lessons/:id/check", async (ctx) => {
    const lesson = content.getLesson(ctx.params.id ?? "");
    if (!lesson) throw notFound("Lesson");
    const { answers } = await readJson(ctx, CheckBody);
    const missing = lesson.self_check.filter((q) => !(q.id in answers)).map((q) => q.id);
    if (missing.length > 0) {
      throw new HttpError(400, "validation_failed", "Answer every question before checking.", missing.map((id) => ({ field: id, message: "Not answered." })));
    }
    const grade = content.grade(lesson.id, answers);
    if (!grade) throw notFound("Lesson");
    if (!ctx.user) return ok({ ...grade, saved: false, progress: null });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO lesson_progress (user_id, lesson_id, track_slug, status, attempts, best_score, started_at, completed_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET
         attempts     = attempts + 1,
         best_score   = MAX(COALESCE(best_score, 0), excluded.best_score),
         status       = CASE WHEN status = 'completed' OR excluded.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
         completed_at = COALESCE(completed_at, excluded.completed_at),
         updated_at   = excluded.updated_at`,
    ).run(
      ctx.user.id,
      lesson.id,
      lesson.track,
      grade.passed ? "completed" : "in_progress",
      grade.score,
      now,
      grade.passed ? now : null,
      now,
    );
    const row = getProgress(db, ctx.user.id, lesson.id);
    return ok({ ...grade, saved: true, progress: row ? toProgress(row) : null });
  });

  router.get(
    "/api/me/progress",
    (ctx) => {
      const rows = db
        .prepare("SELECT * FROM lesson_progress WHERE user_id = ? ORDER BY updated_at DESC")
        .all(ctx.user?.id ?? "") as unknown as ProgressRow[];
      // Only count lessons that still exist in the current content.
      const live = rows.filter((r) => content.getLesson(r.lesson_id));
      const tracks = content.listTracks().map((t) => {
        const total = content.lessonsFor(t.slug).length;
        const completed = live.filter((r) => r.track_slug === t.slug && r.status === "completed").length;
        return { slug: t.slug, shortTitle: t.short_title, completed, total };
      });
      const recent = live.slice(0, 5).map((r) => {
        const lesson = content.getLesson(r.lesson_id);
        return { ...toProgress(r), title: lesson?.title ?? r.lesson_id };
      });
      return ok({
        lessons: live.map(toProgress),
        tracks,
        recent,
        totals: {
          lessonsCompleted: live.filter((r) => r.status === "completed").length,
          lessonsInProgress: live.filter((r) => r.status === "in_progress").length,
          lessonsAvailable: content.bundle.lessons.length,
        },
      });
    },
    { auth: "user" },
  );

  router.get(
    "/api/me/bookmarks",
    (ctx) => {
      const rows = db
        .prepare("SELECT item_type, item_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC")
        .all(ctx.user?.id ?? "") as { item_type: BookmarkType; item_id: string; created_at: string }[];
      const bookmarks = rows.map((r) => {
        let title: string | null = null;
        let url: string | null = null;
        if (r.item_type === "track") {
          const t = content.getTrack(r.item_id);
          if (t) [title, url] = [`${t.short_title} — ${t.title}`, `/tracks/${t.slug}`];
        } else if (r.item_type === "path") {
          const p = content.getPath(r.item_id);
          if (p) [title, url] = [p.title, `/paths/${p.slug}`];
        } else {
          const l = content.getLesson(r.item_id);
          if (l) [title, url] = [l.title, `/tracks/${l.track}/lessons/${l.id}`];
        }
        return { type: r.item_type, id: r.item_id, createdAt: r.created_at, title, url, available: title !== null };
      });
      return ok({ bookmarks });
    },
    { auth: "user" },
  );

  router.put(
    "/api/me/bookmarks/:type/:id",
    (ctx) => {
      const type = ctx.params.type ?? "";
      const id = ctx.params.id ?? "";
      if (!isBookmarkType(type)) throw new HttpError(400, "validation_failed", "Unknown bookmark type.");
      if (!content.hasItem(type, id)) throw notFound("Item");
      db.prepare("INSERT OR IGNORE INTO bookmarks (user_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)").run(
        ctx.user?.id ?? "",
        type,
        id,
        new Date().toISOString(),
      );
      return ok({ bookmarked: true });
    },
    { auth: "user" },
  );

  router.delete(
    "/api/me/bookmarks/:type/:id",
    (ctx) => {
      db.prepare("DELETE FROM bookmarks WHERE user_id = ? AND item_type = ? AND item_id = ?").run(
        ctx.user?.id ?? "",
        ctx.params.type ?? "",
        ctx.params.id ?? "",
      );
      return noContent();
    },
    { auth: "user" },
  );
}
