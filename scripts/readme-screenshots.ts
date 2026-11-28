/**
 * Regenerates the README screenshots in docs/screenshots/ from the built app.
 *
 *   npm run build && node --disable-warning=ExperimentalWarning scripts/readme-screenshots.ts
 *
 * Uses the e2e harness (in-memory database, a free port, headless Chromium). Each shot waits for the page's own
 * heading and for the network to go quiet, then for animations to finish, so it shows the final state.
 */
import { join } from "node:path";
import type { Page } from "playwright";
import { startHarness } from "../e2e/harness.ts";

const out = join(import.meta.dirname, "..", "docs", "screenshots");

const SHOTS: { file: string; path: string; ready: string; colorScheme?: "light" | "dark"; mobile?: boolean; fullPage?: boolean }[] = [
  { file: "home-dark.jpg", path: "/", ready: "main h1" },
  { file: "home-light.jpg", path: "/", ready: "main h1", colorScheme: "light" },
  { file: "track-page.jpg", path: "/tracks/docker", ready: "main h1" },
  { file: "lesson.jpg", path: "/tracks/docker/lessons/docker-images-vs-containers", ready: "main h1" },
  { file: "mobile.jpg", path: "/", ready: "main h1", mobile: true },
  { file: "simulation.jpg", path: "/tracks/kubernetes/simulations/kubernetes-reconciliation", ready: "main h1" },
  { file: "architecture.jpg", path: "/architecture", ready: "main h1" },
];

async function settle(page: Page, ready: string): Promise<void> {
  await page.locator(ready).first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  if (await page.getByRole("heading", { name: "Page not found" }).count()) throw new Error(`${page.url()} is a not-found page`);
}

const h = await startHarness();
try {
  for (const shot of SHOTS) {
    const { page, context, problems } = await h.newPage({ colorScheme: shot.colorScheme ?? "dark", mobile: shot.mobile ?? false });
    await page.goto(shot.path);
    await settle(page, shot.ready);
    if (problems.length) throw new Error(`${shot.path}: ${problems.join("; ")}`);
    await page.screenshot({ path: join(out, shot.file), type: "jpeg", quality: 80, fullPage: shot.fullPage ?? false });
    console.log(`docs/screenshots/${shot.file}  ${shot.path}`);
    await context.close();
  }
} finally {
  await h.close();
}
