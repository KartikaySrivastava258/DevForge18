/**
 * Server-side sessions. The browser holds a random 256-bit token in an
 * HttpOnly cookie; the database stores only its SHA-256 hash.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/database.ts";
import type { UserRecord } from "./users.ts";

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Db, userId: string, ttlHours: number, userAgent: string | undefined): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(hashToken(token), userId, now.toISOString(), expiresAt.toISOString(), now.toISOString(), userAgent?.slice(0, 300) ?? null);
  return { token, expiresAt };
}

interface SessionRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
}

/** Resolve a session token to an active user, or undefined if invalid, expired or disabled. */
export function getSessionUser(db: Db, token: string): UserRecord | undefined {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const id = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(id) as (SessionRow & UserRecord) | undefined;
  if (!row) return undefined;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return undefined;
  }
  if (row.disabled_at) return undefined;
  if (now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), id);
  }
  const { session_id: _s, expires_at: _e, last_seen_at: _l, ...user } = row;
  return user;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

export function deleteUserSessions(db: Db, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions(db: Db): number {
  return Number(db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString()).changes);
}
