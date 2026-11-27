import { randomUUID } from "node:crypto";
import type { Db } from "../db/database.ts";

export const ROLES = ["student", "faculty", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: Role;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

/** The shape of a user that is safe to send to a browser. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, displayName: u.display_name, role: u.role, createdAt: u.created_at };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(db: Db, email: string): UserRecord | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(normaliseEmail(email)) as UserRecord | undefined;
}

export function findUserById(db: Db, id: string): UserRecord | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
}

export function insertUser(
  db: Db,
  input: { email: string; displayName: string; passwordHash: string; role: Role },
): UserRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, normaliseEmail(input.email), input.displayName.trim(), input.passwordHash, input.role, now, now);
  const created = findUserById(db, id);
  if (!created) throw new Error("user insert failed");
  return created;
}

export function updatePasswordHash(db: Db, userId: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), userId);
}

export function setUserRole(db: Db, userId: string, role: Role): void {
  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, new Date().toISOString(), userId);
}

/** Disable (now) or re-enable an account. Callers delete the user's sessions when disabling. */
export function setUserDisabled(db: Db, userId: string, disabled: boolean): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?").run(disabled ? now : null, now, userId);
}

export function countActiveAdmins(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number };
  return row.n;
}

export function listUsers(db: Db, opts: { limit: number; offset: number; role?: Role | undefined }): { users: UserRecord[]; total: number } {
  const where = opts.role ? "WHERE role = ?" : "";
  const params = opts.role ? [opts.role] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...params) as { n: number }).n;
  const users = db
    .prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as unknown as UserRecord[];
  return { users, total };
}
