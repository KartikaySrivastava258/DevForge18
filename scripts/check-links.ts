/**
 * Checks every external URL in /content (resources, sources, and links in lesson and other bodies). Needs internet access, so
 * it runs on a schedule in CI (see .github/workflows/link-check.yml) or by hand:
 *
 *   npm run content:check-links
 *
 * It reports; it does not edit content. A person reviews each result and
 * updates `verification` in the YAML, so "verified" always means a human
 * also confirmed the page is the right, current resource.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent } from "./lib/content-loader.ts";
import { externalLinks } from "./lib/external-links.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { bundle } = loadContent(join(root, "content"));
// Listed resources, case-study sources, alternatives, and every link in rendered lesson, lab, project,
// capstone and architecture bodies (scripts/lib/external-links.ts).
const urls = new Map<string, string[]>(externalLinks(bundle).map((l) => [l.url, l.usedBy]));

async function check(url: string): Promise<{ status: number | string; finalUrl: string }> {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "DevForge18-link-check" } });
      if (method === "HEAD" && (res.status === 405 || res.status === 403)) continue;
      return { status: res.status, finalUrl: res.url };
    } catch (err) {
      if (method === "GET") return { status: (err as Error).name, finalUrl: url };
    }
  }
  return { status: "unknown", finalUrl: url };
}

const results: { url: string; status: number | string; finalUrl: string; usedBy: string[] }[] = [];
const queue = [...urls.entries()];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [url, usedBy] = item;
      results.push({ url, usedBy, ...(await check(url)) });
    }
  }),
);
results.sort((a, b) => a.url.localeCompare(b.url));
const broken = results.filter((r) => typeof r.status !== "number" || r.status >= 400);
const redirected = results.filter((r) => typeof r.status === "number" && r.status < 400 && r.finalUrl.replace(/\/$/, "") !== r.url.replace(/\/$/, ""));
for (const r of results) console.log(`${String(r.status).padEnd(6)} ${r.url}${r.finalUrl !== r.url ? `  → ${r.finalUrl}` : ""}`);
// The scheduled workflow runs without a build step, so build/ may not exist yet.
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build", "link-report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length} links checked: ${broken.length} broken, ${redirected.length} redirected. Report: build/link-report.json`);
process.exit(broken.length > 0 ? 1 : 0);
