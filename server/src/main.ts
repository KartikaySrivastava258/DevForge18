/** Process entry point: load config, migrate, load content, start the server. */
import { resolve } from "node:path";
import { createApp, createHttpServer, sharedLimiters } from "./app.ts";
import { loadConfig } from "./config.ts";
import { ContentStore } from "./content/store.ts";
import { migrate, openDatabase } from "./db/database.ts";
import { RedisRateLimitStore } from "./http/rate-limit-redis.ts";
import { createLogger } from "./observability/logger.ts";
import { Tracer } from "./observability/tracing.ts";
import { RedisClient } from "./redis/client.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel);

try {
  const db = openDatabase(resolve(config.databasePath));
  const migrations = migrate(db);
  if (migrations.applied.length) logger.info("migrations applied", { applied: migrations.applied });
  const content = ContentStore.fromFile(resolve(config.contentPath));
  // OpenTelemetry tracing, only when an OTLP endpoint is configured (ADR 0009).
  const tracer = config.tracing ? new Tracer(config.tracing, { logger }) : undefined;
  if (config.tracing) {
    logger.info("tracing on", { receiver: new URL(config.tracing.tracesUrl).origin, service: config.tracing.serviceName, sampler: config.tracing.sampler });
  }
  // Rate limits shared through Redis when REDIS_URL is set, else per process (ADR 0010).
  let rateLimitStore: RedisRateLimitStore | undefined;
  if (config.redisUrl) {
    const client = new RedisClient(config.redisUrl);
    rateLimitStore = new RedisRateLimitStore(client, { logger, address: client.address });
    logger.info("rate limits shared through Redis", { redis: client.address });
  }
  const app = createApp({
    config,
    db,
    content,
    logger,
    ...(tracer ? { tracer } : {}),
    ...(rateLimitStore ? { rateLimitStore, limiters: sharedLimiters(rateLimitStore, config.apiRateLimits) } : {}),
  });
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
      rateLimitStore?.close();
      // Send the spans still queued (bounded by the exporter timeout and the 10 s limit below).
      void (tracer?.shutdown() ?? Promise.resolve()).then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} catch (err) {
  logger.error("failed to start", { err });
  process.exit(1);
}
