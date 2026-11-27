/**
 * Architecture studio (REMAINING_WORK.md §7, milestone 10): reference architectures, the relationship
 * graph's integration guides, and learners' own architecture decision records.
 */
import { z } from "zod/v4";
import { ok, readJson } from "../http/context.ts";
import { notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const DecisionBody = z.object({
  title: z.string().trim().min(3).max(200),
  context: z.string().max(8000),
  decision: z.string().max(8000),
  consequences: z.string().max(8000),
  status: z.enum(["draft", "submitted"]),
});

interface DecisionRow {
  architecture_id: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: "draft" | "submitted";
  updated_at: string;
}

const toApi = (r: DecisionRow) => ({ architectureId: r.architecture_id, title: r.title, context: r.context, decision: r.decision, consequences: r.consequences, status: r.status, updatedAt: r.updated_at });

export function registerArchitectureRoutes(router: Router, { db, content }: AppDeps): void {
  router.get("/api/architectures", () => ok({ architectures: content.listArchitectures().map((a) => content.architectureSummary(a)) }));

  router.get("/api/architectures/:id", (ctx) => {
    const a = content.getArchitecture(ctx.params.id ?? "");
    if (!a) throw notFound("Architecture");
    return ok({ architecture: content.publicArchitecture(a) });
  });

  router.get(
    "/api/me/decisions",
    (ctx) => {
      const rows = db.prepare("SELECT * FROM architecture_decisions WHERE user_id = ? ORDER BY updated_at DESC").all(ctx.user?.id ?? "") as unknown as DecisionRow[];
      return ok({ decisions: rows.map(toApi) });
    },
    { auth: "user" },
  );

  router.get(
    "/api/me/decisions/:architectureId",
    (ctx) => {
      const row = db.prepare("SELECT * FROM architecture_decisions WHERE user_id = ? AND architecture_id = ?").get(ctx.user?.id ?? "", ctx.params.architectureId ?? "") as unknown as DecisionRow | undefined;
      return ok({ decision: row ? toApi(row) : null });
    },
    { auth: "user" },
  );

  router.put(
    "/api/me/decisions/:architectureId",
    async (ctx) => {
      const a = content.getArchitecture(ctx.params.architectureId ?? "");
      if (!a) throw notFound("Architecture");
      const body = await readJson(ctx, DecisionBody);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO architecture_decisions (user_id, architecture_id, title, context, decision, consequences, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, architecture_id) DO UPDATE SET title = excluded.title, context = excluded.context, decision = excluded.decision,
           consequences = excluded.consequences, status = excluded.status, updated_at = excluded.updated_at`,
      ).run(ctx.user?.id ?? "", a.id, body.title, body.context, body.decision, body.consequences, body.status, now, now);
      const row = db.prepare("SELECT * FROM architecture_decisions WHERE user_id = ? AND architecture_id = ?").get(ctx.user?.id ?? "", a.id) as unknown as DecisionRow;
      return ok({ decision: toApi(row) });
    },
    { auth: "user" },
  );
}
