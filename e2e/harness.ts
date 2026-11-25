import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer } from "node:http";
import { createApp, type App } from "../server/src/app.ts";
import type { AppConfig } from "../server/src/config.ts";
import { ContentStore } from "../server/src/content/store.ts";
import { migrate, openDatabase } from "../server/src/db/database.ts";
import { silentLogger } from "../server/src/observability/logger.ts";

const root = join(import.meta.dirname, "..");

export interface Harness {
  url: string;
  browser: Browser;
  newPage: (opts?: { mobile?: boolean; colorScheme?: "light" | "dark" }) => Promise<{ page: Page; context: BrowserContext; problems: string[] }>;
  close: () => Promise<void>;
}

/** Runs the real server (built frontend + compiled content, in-memory DB) and a headless Chromium. */
export async function startHarness(): Promise<Harness> {
  // Bind the port first so the app is created with the exact origin the browser will send.
  let app: App | undefined;
  const server = createServer((req, res) => {
    if (!app) {
      res.statusCode = 503;
      res.end();
      return;
    }
    void app.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config: AppConfig = {
    env: "test",
    host: "127.0.0.1",
    port: 0,
    publicOrigin: url,
    databasePath: ":memory:",
    sessionTtlHours: 24,
    cookieSecure: false,
    passwordHashLogN: 14,
    trustProxy: false,
    logLevel: "error",
    contentPath: join(root, "build", "content.json"),
    webRoot: join(root, "build", "web"),
  };
  const db = openDatabase(":memory:");
  migrate(db);
  app = createApp({ config, db, content: ContentStore.fromFile(config.contentPath), logger: silentLogger });
  const browser = await chromium.launch();

  return {
    url,
    browser,
    newPage: async (opts = {}) => {
      const context = await browser.newContext({
        baseURL: url,
        colorScheme: opts.colorScheme ?? "dark",
        ...(opts.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1360, height: 900 } }),
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") problems.push(`console ${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      page.on("requestfailed", (r) => {
        if (r.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
      });
      page.on("response", (r) => {
        const expected404 = r.url().includes("/api/tracks/does-not-exist");
        if (r.status() >= 500 || (r.status() >= 400 && r.url().includes("/assets/")) || (r.status() === 404 && r.url().includes("/api/") && !expected404)) {
          problems.push(`HTTP ${r.status()} ${r.url()}`);
        }
      });
      return { page, context, problems };
    },
    close: async () => {
      await browser.close();
      app?.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
    },
  };
}
