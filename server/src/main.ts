/** Process entry point: load config, migrate, load content, start the server. */
import { resolve } from "node:path";
import { createApp, createHttpServer } from "./app.ts";
import { loadConfig } from "./config.ts";
import { ContentStore } from "./content/store.ts";
import { migrate, openDatabase } from "./db/database.ts";
import { createLogger } from "./observability/logger.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel);

try {
  const db = openDatabase(resolve(config.databasePath));
  const migrations = migrate(db);
  if (migrations.applied.length) logger.info("migrations applied", { applied: migrations.applied });
  const content = ContentStore.fromFile(resolve(config.contentPath));
  const app = createApp({ config, db, content, logger });
  const server = createHttpServer(app);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      const next = config.port + 10;
      logger.error(`Port ${config.port} is already in use by another program`, {
        hint: `Stop the other program, or choose another port, e.g. PORT=${next} PUBLIC_ORIGIN=http://localhost:${next} npm start`,
        check: `sudo ss -ltnp 'sport = :${config.port}'  (shows which program is using the port)`,
      });
    } else if (err.code === "EACCES") {
      logger.error(`No permission to listen on port ${config.port}`, {
        hint: "Ports below 1024 need administrator rights; use a port such as 8080 or 8090 instead.",
      });
    } else {
      logger.error("server failed to start", { err });
    }
    db.close();
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info("DevForge 18 listening", {
      url: `http://${config.host}:${config.port}`,
      env: config.env,
      tracks: content.listTracks().length,
      lessons: content.bundle.lessons.length,
      contentEditor: config.cms?.enabled ? "enabled" : (config.cms?.reason ?? "not configured"),
    });
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    app.close();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} catch (err) {
  logger.error("failed to start", { err });
  process.exit(1);
}
