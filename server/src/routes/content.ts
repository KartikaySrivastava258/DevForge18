import { CATEGORIES } from "../../../shared/content-schema.ts";
import type { SearchDocType } from "../../../shared/search.ts";
import { notFound } from "../http/errors.ts";
import { ok } from "../http/context.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

export function registerContentRoutes(router: Router, { content }: AppDeps): void {
  router.get("/api/tracks", () =>
    ok({
      categories: Object.entries(CATEGORIES).map(([id, label]) => ({ id, label })),
      tracks: content.listTracks().map((t) => content.summarise(t)),
    }),
  );

  router.get("/api/tracks/:slug", (ctx) => {
    const track = content.getTrack(ctx.params.slug ?? "");
    if (!track) throw notFound("Track");
    const summary = (slug: string) => {
      const t = content.getTrack(slug);
      return t ? content.summarise(t) : null;
    };
    return ok({
      track,
      summary: content.summarise(track),
      lessons: content.lessonsFor(track.slug).map((l) => content.lessonSummary(l)),
      simulations: content.simulationsFor(track.slug).map((s) => content.simulationSummary(s)),
      prerequisites: track.prerequisites.map(summary).filter(Boolean),
      related: track.related.map((r) => ({ why: r.why, track: summary(r.slug) })).filter((r) => r.track),
      paths: content
        .listPaths()
        .filter((p) => p.modules.some((m) => m.track === track.slug))
        .map((p) => ({ slug: p.slug, title: p.title, number: p.number })),
    });
  });

  router.get("/api/paths", () =>
    ok({
      paths: content.listPaths().map((p) => ({
        ...p,
        estimatedHours: p.modules.reduce(
          (acc, m) => {
            const t = content.getTrack(m.track);
            return t ? { min: acc.min + t.estimated_hours.min, max: acc.max + t.estimated_hours.max } : acc;
          },
          { min: 0, max: 0 },
        ),
      })),
    }),
  );

  router.get("/api/paths/:slug", (ctx) => {
    const path = content.getPath(ctx.params.slug ?? "");
    if (!path) throw notFound("Learning path");
    const modules = path.modules.map((m) => {
      const t = content.getTrack(m.track);
      return { focus: m.focus, track: t ? content.summarise(t) : null };
    });
    const estimatedHours = modules.reduce(
      (acc, m) => (m.track ? { min: acc.min + m.track.estimatedHours.min, max: acc.max + m.track.estimatedHours.max } : acc),
      { min: 0, max: 0 },
    );
    return ok({ path, modules, estimatedHours });
  });

  router.get("/api/lessons/:id", (ctx) => {
    const lesson = content.getLesson(ctx.params.id ?? "");
    if (!lesson) throw notFound("Lesson");
    const track = content.getTrack(lesson.track);
    return ok({ lesson: content.publicLesson(lesson), track: track ? content.summarise(track) : null });
  });

  router.get("/api/search", (ctx) => {
    const q = (ctx.query.get("q") ?? "").slice(0, 200);
    const limit = Number(ctx.query.get("limit") ?? "20");
    const requested = (ctx.query.get("type") ?? "").split(",").filter(Boolean);
    const allowed: readonly string[] = ["track", "path", "lesson", "topic"];
    const types = requested.filter((t): t is SearchDocType => allowed.includes(t));
    const results = q.trim() ? content.search(q, { limit: Number.isFinite(limit) ? limit : 20, ...(types.length ? { types } : {}) }) : [];
    return ok({ query: q, results });
  });
}
