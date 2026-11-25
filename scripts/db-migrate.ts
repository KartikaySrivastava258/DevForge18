/** Apply pending database migrations.  npm run db:migrate */
import { resolve } from "node:path";
import { loadConfig } from "../server/src/config.ts";
import { migrate, openDatabase } from "../server/src/db/database.ts";

const config = loadConfig();
const db = openDatabase(resolve(config.databasePath));
const result = migrate(db);
console.log(
  result.applied.length
    ? `Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`
    : `Database is up to date (${result.alreadyApplied} migration(s) already applied).`,
);
db.close();
