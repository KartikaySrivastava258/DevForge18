/**
 * Online, consistent backup of the SQLite database using VACUUM INTO, which
 * is safe while the server is running. The backup is then opened and checked.
 *
 *   npm run db:backup                    → ./backups/devforge-<timestamp>.db
 *   npm run db:backup -- ./my-copy.db
 *
 * Run it with the server's DATABASE_PATH. Restore: stop the server, replace
 * DATABASE_PATH with the backup file (removing any -wal/-shm files beside
 * it), start the server. Tested by scripts/upgrade-test.sh.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../server/src/config.ts";
import { openDatabase } from "../server/src/db/database.ts";

const config = loadConfig();
const source = resolve(config.databasePath);
// Opening a missing path would create an empty database there and "back up" that.
if (!existsSync(source)) {
  console.error(`No database at ${source}. Set DATABASE_PATH to the server's database file.`);
  process.exit(1);
}
const target = resolve(process.argv[2] ?? `./backups/devforge-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
if (existsSync(target)) {
  console.error(`Refusing to overwrite existing file ${target}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = openDatabase(source);
db.prepare("VACUUM INTO ?").run(target);
db.close();

const copy = new DatabaseSync(target, { readOnly: true });
const integrity = (copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
const users = (copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
copy.close();
if (integrity !== "ok") {
  console.error(`Backup written but integrity check failed: ${integrity}`);
  process.exit(1);
}
console.log(`Backup OK: ${source} → ${target} (integrity ok, ${users} user(s)).`);
