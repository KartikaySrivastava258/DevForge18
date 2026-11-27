/**
 * Child-process entry for the practice server. It must run in its own process:
 * the lesson runner executes bash synchronously, which would block a server
 * living in the same Node.js event loop.
 * Prints one JSON line {"url": "..."} when ready; exits on SIGTERM.
 */
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createApp, createHttpServer } from "../../server/src/app.ts";
import type { AppConfig } from "../../server/src/config.ts";
import { ContentStore } from "../../server/src/content/store.ts";
import { migrate, openDatabase } from "../../server/src/db/database.ts";
import { silentLogger } from "../../server/src/observability/logger.ts";
import { Tracer, tracingConfigFromEnv } from "../../server/src/observability/tracing.ts";
import { loadContent } from "./content-loader.ts";

const contentRoot = process.argv[2] ?? join(import.meta.dirname, "..", "..", "content");
const requestedPort = Number(process.argv[3] ?? "0");
const { bundle, errors } = loadContent(contentRoot);
if (errors.length) {
  console.error(`content invalid: ${errors[0]}`);
  process.exit(1);
}
const config: AppConfig = {
  env: "test",
  host: "127.0.0.1",
  port: 0,
  publicOrigin: "http://localhost:8080",
  databasePath: ":memory:",
  sessionTtlHours: 24,
  cookieSecure: false,
  passwordHashLogN: 14,
  trustProxy: false,
  logLevel: "error",
  contentPath: "unused",
  webRoot: join(contentRoot, "..", "build", "web"),
};
const db = openDatabase(":memory:");
migrate(db);
// Tracing as in production: on when the environment names an OTLP endpoint (the OpenTelemetry lab).
const tracing = tracingConfigFromEnv(process.env);
const tracer = tracing ? new Tracer(tracing, { logger: silentLogger }) : undefined;
const app = createApp({ config, db, content: new ContentStore(bundle), logger: silentLogger, ...(tracer ? { tracer } : {}) });
const server = createHttpServer(app);
server.on("error", (err) => {
  console.error(`practice server could not listen on port ${requestedPort}: ${err.message}`);
  process.exit(1);
});
server.listen(requestedPort, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${port}` })}\n`);
});
process.on("SIGTERM", () => {
  app.close();
  server.closeAllConnections();
  server.close(() => void (tracer?.shutdown() ?? Promise.resolve()).then(() => process.exit(0)));
});
