/**
 * Initial JavaScript (and CSS) a first-time visitor downloads for the home, a track and a lesson page.
 *
 *   npm run build && node --disable-warning=ExperimentalWarning scripts/measure-page-weight.ts
 *
 * Loads each page in headless Chromium with an empty cache against the built app (e2e harness: in-memory
 * database, a free port), records every script and stylesheet the page requested before it finished rendering,
 * and prints their size as served by DevForge (uncompressed) and gzip-compressed at level 6, which is what
 * Nginx's `gzip on` uses by default in deploy/nginx/nginx.conf.
 */
import { gzipSync } from "node:zlib";
import { startHarness } from "../e2e/harness.ts";

const PAGES = [
  { name: "home", path: "/", ready: "h1" },
  { name: "track (Docker)", path: "/tracks/docker", ready: "h1" },
  { name: "lesson (Images vs containers)", path: "/tracks/docker/lessons/docker-images-vs-containers", ready: "main h1" },
];

const harness = await startHarness();
try {
  const rows: string[] = [];
  for (const p of PAGES) {
    const { page, context } = await harness.newPage();
    const assets: { url: string; type: string; raw: number; gzip: number }[] = [];
    const pending: Promise<void>[] = [];
    page.on("response", (res) => {
      const type = res.request().resourceType();
      if (type !== "script" && type !== "stylesheet") return;
      pending.push(
        res.body().then((body) => {
          assets.push({ url: new URL(res.url()).pathname, type, raw: body.length, gzip: gzipSync(body, { level: 6 }).length });
        }),
      );
    });
    await page.goto(p.path);
    await page.locator(p.ready).first().waitFor();
    // Measure the real page, not the "not found" state of a mistyped path.
    if (await page.getByText(/page not found|could not find/i).count()) throw new Error(`${p.path} rendered a not-found page`);
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    await context.close();
    const sum = (type: string, key: "raw" | "gzip") => assets.filter((a) => a.type === type).reduce((n, a) => n + a[key], 0);
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    rows.push(
      `| ${p.name} | \`${p.path}\` | ${assets.filter((a) => a.type === "script").length} | ${kb(sum("script", "raw"))} | ${kb(sum("script", "gzip"))} | ${kb(sum("stylesheet", "raw"))} | ${kb(sum("stylesheet", "gzip"))} |`,
    );
    for (const a of assets) console.error(`  ${p.name}: ${a.type} ${a.url} ${a.raw} B (gzip ${a.gzip} B)`);
  }
  console.log("| Page | Path | Scripts | JS (served) | JS (gzip -6) | CSS (served) | CSS (gzip -6) |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(r);
} finally {
  await harness.close();
}
