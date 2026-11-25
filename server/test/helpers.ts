import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContent } from "../../scripts/lib/content-loader.ts";
import { createApp, createHttpServer, type App } from "../src/app.ts";
import { hashPassword } from "../src/auth/password.ts";
import { insertUser, type Role } from "../src/auth/users.ts";
import type { AppConfig } from "../src/config.ts";
import { ContentStore } from "../src/content/store.ts";
import { migrate, openDatabase, type Db } from "../src/db/database.ts";
import { silentLogger } from "../src/observability/logger.ts";
import type { Limiters } from "../src/routes/deps.ts";

const repoRoot = join(import.meta.dirname, "..", "..");
let cachedContent: ContentStore | undefined;
export function testContent(): ContentStore {
  if (!cachedContent) {
    const { bundle, errors } = loadContent(join(repoRoot, "content"));
    if (errors.length) throw new Error(`content invalid: ${errors.join("; ")}`);
    cachedContent = new ContentStore(bundle);
  }
  return cachedContent;
}

export const TEST_LOG_N = 14; // the minimum allowed; keeps tests fast

export interface TestServer {
  url: string;
  db: Db;
  app: App;
  webRoot: string;
  close: () => Promise<void>;
  /** Create a user directly in the database with a given role. */
  createUser: (email: string, password: string, role?: Role) => Promise<void>;
}

export async function startTestServer(overrides: Partial<AppConfig> = {}, limiters?: Limiters): Promise<TestServer> {
  const webRoot = mkdtempSync(join(tmpdir(), "devforge-web-"));
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>DevForge test shell</title>");
  writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log('ok')");

  const config: AppConfig = {
    env: "test",
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "http://localhost:8080",
    databasePath: ":memory:",
    sessionTtlHours: 24,
    cookieSecure: false,
    passwordHashLogN: TEST_LOG_N,
    trustProxy: false,
    logLevel: "error",
    contentPath: "unused",
    webRoot,
    ...overrides,
  };
  const db = openDatabase(":memory:");
  migrate(db);
  const app = createApp({ config, db, content: testContent(), logger: silentLogger, ...(limiters ? { limiters } : {}) });
  const server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    app,
    webRoot,
    createUser: async (email, password, role = "student") => {
      insertUser(db, { email, displayName: email.split("@")[0] ?? "user", passwordHash: await hashPassword(password, TEST_LOG_N), role });
    },
    close: async () => {
      app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(webRoot, { recursive: true, force: true });
    },
  };
}

/** A tiny cookie-aware API client, mirroring what the browser does. */
export class Client {
  readonly base: string;
  cookie = "";
  constructor(base: string) {
    this.base = base;
  }

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET" && method !== "HEAD" && !("x-devforge-csrf" in headers)) headers["x-devforge-csrf"] = "1";
    if (body !== undefined) headers["content-type"] ??= "application/json";
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const pair = c.split(";")[0] ?? "";
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request("GET", path, undefined, headers);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("POST", path, body, headers);
  }
}

export const STRONG_PASSWORD = "correct horse battery staple";
