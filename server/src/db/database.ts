/**
 * SQLite access via Node's built-in node:sqlite module (no native add-on to
 * compile, nothing to install). See docs/adr/0002-database.md for why SQLite
 * was chosen for this phase and how a move to PostgreSQL is kept possible.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;"); // readers do not block the single writer
    db.exec("PRAGMA synchronous = NORMAL;"); // durable with WAL; safe trade-off for this workload
  }
  return db;
}

/** Run `fn` inside a transaction; roll back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

export function migrate(db: Db, dir: string = MIGRATIONS_DIR): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const applied = new Map(
    (db.prepare("SELECT version, checksum FROM schema_migrations").all() as { version: string; checksum: string }[]).map(
      (r) => [r.version, r.checksum],
    ),
  );

  const result: MigrationResult = { applied: [], alreadyApplied: 0 };
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);
    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
      }
      result.alreadyApplied += 1;
      continue;
    }
    transaction(db, () => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)").run(
        file,
        checksum,
        new Date().toISOString(),
      );
    });
    result.applied.push(file);
  }
  return result;
}
