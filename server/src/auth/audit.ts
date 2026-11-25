import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.ts";

export function recordAudit(
  db: Db,
  event: { actorUserId: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> },
): void {
  db.prepare(
    `INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    event.actorUserId,
    event.action,
    event.targetType ?? null,
    event.targetId ?? null,
    JSON.stringify(event.metadata ?? {}),
    new Date().toISOString(),
  );
}
