import { z } from "zod/v4";
import { recordAudit } from "../auth/audit.ts";
import { deleteUserSessions } from "../auth/sessions.ts";
import {
  countActiveAdmins,
  findUserById,
  listUsers,
  ROLES,
  setUserDisabled,
  setUserRole,
  toPublicUser,
  type UserRecord,
} from "../auth/users.ts";
import { transaction } from "../db/database.ts";
import { ok, readJson } from "../http/context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const RoleBody = z.object({ role: z.enum(ROLES) });
const StatusBody = z.object({ disabled: z.boolean() }).strict();

/** What the admin screens see: the public user plus whether the account is disabled. */
const toAdminUser = (u: UserRecord) => ({ ...toPublicUser(u), disabledAt: u.disabled_at });

function paging(query: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(query.get("limit") ?? "25") || 25, 1), 100);
  const offset = Math.max(Number(query.get("offset") ?? "0") || 0, 0);
  return { limit, offset };
}

export function registerAdminRoutes(router: Router, { db, content }: AppDeps): void {
  router.get(
    "/api/admin/users",
    (ctx) => {
      const { limit, offset } = paging(ctx.query);
      const roleParam = ctx.query.get("role");
      const role = ROLES.find((r) => r === roleParam);
      const { users, total } = listUsers(db, { limit, offset, role });
      return ok({ users: users.map(toAdminUser), total, limit, offset });
    },
    { auth: ["admin"] },
  );

  router.patch(
    "/api/admin/users/:id/role",
    async (ctx) => {
      const { role } = await readJson(ctx, RoleBody);
      const actor = ctx.user;
      if (!actor) throw new HttpError(401, "unauthenticated", "Sign in first.");
      const updated = transaction(db, () => {
        const target = findUserById(db, ctx.params.id ?? "");
        if (!target) throw notFound("User");
        if (target.role === role) return target;
        if (target.role === "admin" && role !== "admin" && countActiveAdmins(db) <= 1) {
          throw new HttpError(409, "last_admin", "You cannot remove the last administrator.");
        }
        setUserRole(db, target.id, role);
        recordAudit(db, {
          actorUserId: actor.id,
          action: "user.role_changed",
          targetType: "user",
          targetId: target.id,
          metadata: { from: target.role, to: role },
        });
        return findUserById(db, target.id) ?? target;
      });
      return ok({ user: toAdminUser(updated) });
    },
    { auth: ["admin"] },
  );

  // Disable or re-enable an account. A disabled account cannot sign in, and its
  // sessions are deleted at once (getSessionUser also refuses disabled users).
  router.patch(
    "/api/admin/users/:id/status",
    async (ctx) => {
      const { disabled } = await readJson(ctx, StatusBody);
      const actor = ctx.user;
      if (!actor) throw new HttpError(401, "unauthenticated", "Sign in first.");
      const updated = transaction(db, () => {
        const target = findUserById(db, ctx.params.id ?? "");
        if (!target) throw notFound("User");
        if (Boolean(target.disabled_at) === disabled) return target;
        if (disabled && target.id === actor.id) {
          throw new HttpError(409, "cannot_disable_self", "You cannot disable your own account.");
        }
        if (disabled && target.role === "admin" && countActiveAdmins(db) <= 1) {
          throw new HttpError(409, "last_admin", "You cannot disable the last active administrator.");
        }
        setUserDisabled(db, target.id, disabled);
        if (disabled) deleteUserSessions(db, target.id);
        recordAudit(db, {
          actorUserId: actor.id,
          action: disabled ? "user.disabled" : "user.enabled",
          targetType: "user",
          targetId: target.id,
        });
        return findUserById(db, target.id) ?? target;
      });
      return ok({ user: toAdminUser(updated) });
    },
    { auth: ["admin"] },
  );

  router.get(
    "/api/admin/audit",
    (ctx) => {
      const { limit, offset } = paging(ctx.query);
      const events = db
        .prepare(
          `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at, u.email AS actor_email,
                  u.display_name AS actor_name, t.display_name AS target_name
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
           LEFT JOIN users t ON a.target_type = 'user' AND t.id = a.target_id
           ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as { metadata: string }[];
      return ok({ events: events.map((e) => ({ ...e, metadata: JSON.parse(e.metadata) as unknown })), limit, offset });
    },
    { auth: ["admin"] },
  );

  // Aggregated, non-identifying learning statistics for faculty.
  router.get(
    "/api/faculty/overview",
    () => {
      const byRole = db.prepare("SELECT role, COUNT(*) AS n FROM users GROUP BY role").all() as { role: string; n: number }[];
      const completions = db
        .prepare("SELECT track_slug, COUNT(*) AS n FROM lesson_progress WHERE status = 'completed' GROUP BY track_slug")
        .all() as { track_slug: string; n: number }[];
      const completionMap = new Map(completions.map((c) => [c.track_slug, c.n]));
      return ok({
        users: Object.fromEntries(byRole.map((r) => [r.role, r.n])),
        tracks: content.listTracks().map((t) => ({
          slug: t.slug,
          shortTitle: t.short_title,
          lessonCompletions: completionMap.get(t.slug) ?? 0,
        })),
      });
    },
    { auth: ["faculty", "admin"] },
  );
}
