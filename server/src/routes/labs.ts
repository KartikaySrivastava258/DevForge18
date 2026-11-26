import { z } from "zod/v4";
import { ok, readJson } from "../http/context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const CompleteBody = z.object({
  /** Local labs: the checkpoint ids the learner ticked. */
  checkpoints: z.array(z.string().max(64)).max(12).optional(),
  /** Read-through labs: answers to the questions. */
  answers: z
    .record(z.string().max(64), z.string().regex(/^[a-z]$/, "Answers are option letters."))
    .refine((a) => Object.keys(a).length <= 30, "Too many answers.")
    .optional(),
});

interface LabRow {
  lab_id: string;
  track_slug: string;
  evidence: "self-reported" | "verified";
  completed_at: string;
}
const toLabProgress = (r: LabRow) => ({ labId: r.lab_id, track: r.track_slug, evidence: r.evidence, completedAt: r.completed_at });

export function registerLabRoutes(router: Router, { db, content }: AppDeps): void {
  const progressFor = (userId: string | undefined, labId: string) =>
    userId ? (db.prepare("SELECT * FROM lab_progress WHERE user_id = ? AND lab_id = ?").get(userId, labId) as LabRow | undefined) : undefined;

  router.get("/api/labs/:id", (ctx) => {
    const lab = content.getLab(ctx.params.id ?? "");
    if (!lab) throw notFound("Lab");
    const track = content.getTrack(lab.track);
    const row = progressFor(ctx.user?.id, lab.id);
    const challengesDone = lab.simulation && ctx.user
      ? (db.prepare("SELECT challenge_id FROM simulation_progress WHERE user_id = ? AND simulation_id = ?").all(ctx.user.id, lab.simulation.id) as { challenge_id: string }[]).map((r) => r.challenge_id)
      : [];
    return ok({ lab: content.publicLab(lab), track: track ? content.summarise(track) : null, progress: row ? toLabProgress(row) : null, challengesDone });
  });

  /**
   * Record a completed lab. How completion is established depends on the mode,
   * and is stored with it: local labs are self-reported (every checkpoint must
   * be ticked); simulation labs need every listed challenge already verified
   * by the server; read-through labs are graded here.
   */
  router.post(
    "/api/labs/:id/complete",
    async (ctx) => {
      const lab = content.getLab(ctx.params.id ?? "");
      if (!lab) throw notFound("Lab");
      const userId = ctx.user?.id ?? "";
      const body = await readJson(ctx, CompleteBody);
      let evidence: LabRow["evidence"];
      let grade: ReturnType<typeof content.gradeLab> | undefined;
      if (lab.mode === "local") {
        const ticked = new Set(body.checkpoints ?? []);
        const missing = lab.checkpoints.filter((c) => !ticked.has(c.id));
        if (missing.length) throw new HttpError(400, "validation_failed", "Tick every checkpoint once you have seen it.", missing.map((c) => ({ field: c.id, message: "Not ticked." })));
        evidence = "self-reported";
      } else if (lab.mode === "simulation") {
        const done = new Set((db.prepare("SELECT challenge_id FROM simulation_progress WHERE user_id = ? AND simulation_id = ?").all(userId, lab.simulation?.id ?? "") as { challenge_id: string }[]).map((r) => r.challenge_id));
        const missing = (lab.simulation?.challenges ?? []).filter((c) => !done.has(c));
        if (missing.length) throw new HttpError(409, "challenges_incomplete", "Complete the simulation's challenges first; the server verifies each one.", missing.map((c) => ({ field: c, message: "Not completed." })));
        evidence = "verified";
      } else {
        const answers = body.answers ?? {};
        const unanswered = (lab.questions ?? []).filter((q) => !(q.id in answers));
        if (unanswered.length) throw new HttpError(400, "validation_failed", "Answer every question before checking.", unanswered.map((q) => ({ field: q.id, message: "Not answered." })));
        grade = content.gradeLab(lab.id, answers);
        if (!grade?.passed) return ok({ completed: false, grade, progress: null });
        evidence = "verified";
      }
      db.prepare(
        `INSERT INTO lab_progress (user_id, lab_id, track_slug, evidence, completed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, lab_id) DO UPDATE SET evidence = CASE WHEN lab_progress.evidence = 'verified' THEN 'verified' ELSE excluded.evidence END`,
      ).run(userId, lab.id, lab.track, evidence, new Date().toISOString());
      const row = progressFor(userId, lab.id);
      return ok({ completed: true, grade: grade ?? null, progress: row ? toLabProgress(row) : null });
    },
    { auth: "user" },
  );

  router.get(
    "/api/me/labs",
    (ctx) => {
      const rows = (db.prepare("SELECT * FROM lab_progress WHERE user_id = ? ORDER BY completed_at DESC").all(ctx.user?.id ?? "") as unknown as LabRow[]).filter((r) => content.getLab(r.lab_id));
      return ok({ labs: rows.map(toLabProgress) });
    },
    { auth: "user" },
  );
}
