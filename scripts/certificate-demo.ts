/**
 * A throwaway DevForge with certificates, for checking the certificate pages by hand (for example with a screen
 * reader):
 *
 *   npm run build && npm run demo:certificate -- --port 8091
 *
 * Starts the real app (built frontend and compiled content) on 127.0.0.1 with an IN-MEMORY database that
 * disappears when you press Ctrl+C. It never opens a database file, so it cannot put demonstration progress into a
 * real DevForge. In that database it creates one learner who has:
 *
 *   - a valid Kubernetes certificate (the public verification page),
 *   - a revoked Docker certificate (the same page in its "revoked" state),
 *   - everything needed for a PostgreSQL certificate but no certificate yet, so you can press "Get certificate"
 *     on the dashboard yourself.
 *
 * The learner earns these through the real API, like the accessibility audit does (e2e/accessibility.test.ts):
 * only the quiz attempts and verified labs, which take hours of real work, are written straight into the
 * in-memory database. The revoke uses an administrator account and the real admin endpoint.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createApp } from "../server/src/app.ts";
import { hashPassword } from "../server/src/auth/password.ts";
import { insertUser } from "../server/src/auth/users.ts";
import type { AppConfig } from "../server/src/config.ts";
import { ContentStore } from "../server/src/content/store.ts";
import { migrate, openDatabase } from "../server/src/db/database.ts";
import { silentLogger } from "../server/src/observability/logger.ts";

const root = join(import.meta.dirname, "..");
const { values } = parseArgs({ options: { port: { type: "string", default: "8091" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("Usage: npm run demo:certificate -- --port <1024-65535>");
  process.exit(2);
}
const contentPath = join(root, "build", "content.json");
const webRoot = join(root, "build", "web");
try {
  readFileSync(join(webRoot, "index.html"));
} catch {
  console.error("No built app in build/web: run npm run build first.");
  process.exit(2);
}

const url = `http://127.0.0.1:${port}`;
const config: AppConfig = {
  env: "development",
  host: "127.0.0.1",
  port,
  publicOrigin: url,
  databasePath: ":memory:",
  sessionTtlHours: 24,
  cookieSecure: false,
  passwordHashLogN: 14,
  trustProxy: false,
  logLevel: "error",
  contentPath,
  webRoot,
};
const db = openDatabase(":memory:");
migrate(db);
const content = ContentStore.fromFile(contentPath);
const app = createApp({ config, db, content, logger: silentLogger });
const server = createServer((req, res) => void app.handle(req, res));
await new Promise<void>((resolve, reject) => {
  server.once("error", (err: NodeJS.ErrnoException) =>
    reject(err.code === "EADDRINUSE" ? new Error(`Port ${port} is in use; choose another with -- --port <number>.`) : err),
  );
  server.listen(port, "127.0.0.1", resolve);
}).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

/** A tiny API client that keeps the session cookie, as a browser would. */
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(url + path, {
      method,
      headers: { "X-DevForge-CSRF": "1", Origin: url, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    if (set) cookie = set;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}
function expect(r: { status: number; json: unknown }, status: number, what: string): void {
  if (r.status !== status) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// Throwaway passwords: the accounts live only in this process's memory.
const learner = { email: "learner@example.com", password: `demo-${randomBytes(9).toString("base64url")}` };
const admin = { email: "admin@example.com", password: `demo-${randomBytes(9).toString("base64url")}` };

const asLearner = client();
const reg = await asLearner("POST", "/api/auth/register", { email: learner.email, displayName: "Asha Verma", password: learner.password });
expect(reg, 201, "register the learner");
const userId: string = reg.json.user.id;

const status = await asLearner("GET", "/api/me/certificates");
expect(status, 200, "certificate requirements");
const bundle = JSON.parse(readFileSync(contentPath, "utf8")) as { quizzes: { id: string; track: string }[] };
const now = new Date().toISOString();
function completeRequirements(track: string): void {
  const t = (status.json.tracks as { track: string; labs: { id: string }[] }[]).find((x) => x.track === track);
  const quiz = bundle.quizzes.find((q) => q.track === track);
  if (!t || !quiz) throw new Error(`track ${track} offers no certificate`);
  db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, ?, ?, 0.9, 1, ?)").run(userId, quiz.id, track, now);
  for (const lab of t.labs) {
    db.prepare("INSERT INTO lab_progress (user_id, lab_id, track_slug, evidence, completed_at) VALUES (?, ?, ?, 'verified', ?)").run(userId, lab.id, track, now);
  }
}
for (const track of ["kubernetes", "docker", "postgresql"]) completeRequirements(track);

const k8s = await asLearner("POST", "/api/me/certificates/kubernetes");
expect(k8s, 201, "issue the Kubernetes certificate");
const docker = await asLearner("POST", "/api/me/certificates/docker");
expect(docker, 201, "issue the Docker certificate");

insertUser(db, { email: admin.email, displayName: "Demo Admin", passwordHash: await hashPassword(admin.password, config.passwordHashLogN), role: "admin" });
const asAdmin = client();
expect(await asAdmin("POST", "/api/auth/login", admin), 200, "admin sign-in");
expect(await asAdmin("POST", `/api/certificates/${docker.json.certificate.id}/revoke`), 204, "revoke the Docker certificate");

console.log(`DevForge certificate demo on ${url} (in-memory database; Ctrl+C stops it and deletes everything)

Pages to check:
  1. Valid certificate (public, no sign-in):   ${url}/certificates/${k8s.json.certificate.id}
  2. Revoked certificate (public):              ${url}/certificates/${docker.json.certificate.id}
  3. Unknown certificate id (error state):      ${url}/certificates/0000000000000000
  4. Dashboard, "Certificates" section:         ${url}/dashboard
     Sign in as ${learner.email} with the password ${learner.password}
     PostgreSQL shows a "Get certificate" button: pressing it issues a certificate and opens its page.`);

const stop = () => {
  app.close();
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
