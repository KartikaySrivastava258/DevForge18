import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { createServer } from "node:http";
import { createApp, type App } from "../server/src/app.ts";
import type { AppConfig } from "../server/src/config.ts";
import { ContentStore } from "../server/src/content/store.ts";
import { hashPassword } from "../server/src/auth/password.ts";
import { insertUser, type Role } from "../server/src/auth/users.ts";
import { migrate, openDatabase, type Db } from "../server/src/db/database.ts";
import { silentLogger } from "../server/src/observability/logger.ts";

const root = join(import.meta.dirname, "..");

export interface Harness {
  url: string;
  browser: Browser;
  newPage: (opts?: { mobile?: boolean; colorScheme?: "light" | "dark" }) => Promise<{ page: Page; context: BrowserContext; problems: string[] }>;
  /** Create an account directly in the database — the only way to get a faculty or admin account, as in production. */
  createUser: (user: { email: string; name: string; password: string; role: Role }) => Promise<void>;
  /** The in-memory database, for seeding state that only long real flows produce (as the API tests do). */
  db: Db;
  close: () => Promise<void>;
}

/** Runs the real server (built frontend + compiled content, in-memory DB) and a headless Chromium. */
export async function startHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
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
    ...overrides,
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
      // Reproduce slow CI machines: DEVFORGE_E2E_CPU_THROTTLE=8 slows the page's CPU eightfold (Chromium only).
      const throttle = Number(process.env.DEVFORGE_E2E_CPU_THROTTLE ?? "0");
      if (throttle > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
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
    db,
    createUser: async ({ email, name, password, role }) => {
      insertUser(db, { email, displayName: name, passwordHash: await hashPassword(password, config.passwordHashLogN), role });
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

/**
 * Samples a page condition in two event-loop phases after an action: right after the current microtask
 * queue flushes, and after the next macrotask. A UI that is only settled in the second sample has a window
 * where tests (and users) can observe a half-updated state — the cause of the mobile-menu flake diagnosed in
 * IMPLEMENTATION_STATUS.md. Use it to prove a state change happens in the same update as its trigger.
 */
export async function samplePhases(page: Page, action: () => void, condition: () => unknown): Promise<{ afterMicrotasks: unknown; afterNextTask: unknown }> {
  // A string expression is evaluated over the DevTools protocol, so the app's strict CSP (no eval) still holds
  // for the page itself. The functions must not use variables from the test's scope.
  const a = action.toString();
  const c = condition.toString();
  return page.evaluate(
    `new Promise((resolve) => { (${a})(); queueMicrotask(() => { const afterMicrotasks = (${c})(); setTimeout(() => resolve({ afterMicrotasks, afterNextTask: (${c})() }), 0); }); })`,
  ) as Promise<{ afterMicrotasks: unknown; afterNextTask: unknown }>;
}

/**
 * Waits until the locator's text matches, then returns it. Assertions made straight after a click or a
 * select race the UI's re-render and can read the previous text; this waits on the real condition
 * (the text the user would see) and fails with the last text it saw.
 */
export async function expectText(locator: Locator, pattern: RegExp, message?: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    last = await locator.innerText();
    if (pattern.test(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`${message ? `${message}: ` : ""}text did not match ${pattern} within ${timeoutMs} ms. Last text: ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
