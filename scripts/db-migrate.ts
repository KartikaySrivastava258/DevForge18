/** Apply pending database migrations.  npm run db:migrate */
import { resolve } from "node:path";
import { loadConfig } from "../server/src/config.ts";
import { migrate, openDatabase } from "../server/src/db/database.ts";

const config = loadConfig();
const path = resolve(config.databasePath);
const db = openDatabase(path);
const result = migrate(db);
// The path is printed because a wrong DATABASE_PATH silently gets a new, empty database.
console.log(
  result.applied.length
    ? `Applied ${result.applied.length} migration(s) to ${path}: ${result.applied.join(", ")}`
    : `Database ${path} is up to date (${result.alreadyApplied} migration(s) already applied).`,
);
db.close();
