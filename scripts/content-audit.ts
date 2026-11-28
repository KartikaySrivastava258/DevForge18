/**
 * Content audit for a release (REMAINING_WORK.md, release checklist item 2):
 *
 *   npm run content:audit                                   # counts, unexecuted lessons, declared link status
 *   npm run content:audit -- --links build/link-report.json # also the link checker's results
 *
 * Prints, for each of the 18 tracks, the number of lessons by level, simulations, labs, quizzes (and questions),
 * mini-projects, case studies and alternatives; then every lesson whose commands are not executed by the test
 * suite, with its reason; then every external link that is unverified or broken, either as declared in the content
 * or as found by the link checker (scripts/check-links.ts, run by the Link check workflow).
 *
 * Exit code 1 when the link report lists a broken link, so a release cannot go out with one unnoticed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS } from "../shared/content-schema.ts";
import { loadContent } from "./lib/content-loader.ts";
import { externalLinks } from "./lib/external-links.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linksArg = process.argv.indexOf("--links");
const reportPath = linksArg > 0 ? resolve(process.argv[linksArg + 1] ?? "") : undefined;

const { bundle, errors } = loadContent(join(root, "content"));
if (errors.length) {
  console.error(`Content has ${errors.length} validation error(s); run npm run content:build first.`);
  process.exit(2);
}

// ---- 1. Counts per track -------------------------------------------------------------------------------
type Row = Record<string, string | number>;
const rows: Row[] = bundle.tracks.map((t) => {
  const lessons = bundle.lessons.filter((l) => l.track === t.slug);
  const labs = bundle.labs.filter((l) => l.track === t.slug);
  const quizzes = bundle.quizzes.filter((q) => q.track === t.slug);
  const row: Row = { track: t.slug };
  for (const level of LEVELS) row[level.slice(0, 3)] = lessons.filter((l) => l.level === level).length;
  row.lessons = lessons.length;
  row.sims = bundle.simulations.filter((s) => s.track === t.slug).length;
  row.labs = labs.length;
  row["labs:sim/local/read"] = ["simulation", "local", "read-through"].map((m) => labs.filter((l) => l.mode === m).length).join("/");
  row.quizzes = quizzes.length;
  row.questions = quizzes.reduce((n, q) => n + q.questions.length, 0);
  row.projects = bundle.projects.filter((p) => p.track === t.slug).length;
  row.cases = bundle.case_studies.filter((c) => c.tracks.includes(t.slug)).length;
  row.alts = t.alternatives?.length ?? 0;
  return row;
});
const total: Row = { track: "TOTAL" };
for (const key of Object.keys(rows[0] ?? {})) {
  if (key === "track") continue;
  if (key === "labs:sim/local/read") {
    total[key] = [0, 1, 2].map((i) => rows.reduce((n, r) => n + Number(String(r[key]).split("/")[i]), 0)).join("/");
  } else if (key === "cases") {
    total[key] = `${bundle.case_studies.length} unique`;
  } else {
    total[key] = rows.reduce((n, r) => n + Number(r[key]), 0);
  }
}
const table = [...rows, total];
const cols = Object.keys(table[0] ?? {});
const width = (c: string) => Math.max(c.length, ...table.map((r) => String(r[c]).length));
const line = (r: Row | Record<string, string>) => cols.map((c, i) => (i === 0 ? String(r[c]).padEnd(width(c)) : String(r[c]).padStart(width(c)))).join("  ");
console.log(`# Content audit (${new Date().toISOString().slice(0, 10)}): ${bundle.tracks.length} tracks\n`);
console.log("Lessons by level (beg/int/adv), simulations, labs (by mode), quizzes and questions, mini-projects, case studies, alternatives:\n");
console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
for (const r of table) console.log(line(r));
const empty = rows.filter((r) => cols.some((c) => c !== "track" && c !== "labs:sim/local/read" && Number(r[c]) === 0));
console.log(`\nTracks with a zero in any column: ${empty.length ? empty.map((r) => r.track).join(", ") : "none"}`);
console.log(`Also: ${bundle.paths.length} paths, ${bundle.capstones.length} capstones, ${bundle.integrations.length} integrations, ${bundle.architectures.length} architectures.`);

// ---- 2. Lessons whose commands are not executed ---------------------------------------------------------
const notExecuted = bundle.lessons.filter((l) => l.verification.method !== "executed");
console.log(`\n## Lessons not "executed" (${notExecuted.length} of ${bundle.lessons.length})\n`);
for (const l of notExecuted) console.log(`- ${l.track}/${l.id} [${l.verification.method}]: ${l.verification.details}`);
if (!notExecuted.length) console.log("- none");

// ---- 3. External links ---------------------------------------------------------------------------------
const links = externalLinks(bundle);
const declared = links.filter((l) => l.declared && l.declared !== "verified");
console.log(`\n## External links: ${links.length} unique URLs`);
console.log(`\nDeclared in the content as unverified or broken (${declared.length}):\n`);
for (const l of declared) console.log(`- [${l.declared}] ${l.url} (${l.usedBy.join("; ")})`);
if (!declared.length) console.log("- none");

let brokenCount = 0;
if (reportPath) {
  if (!existsSync(reportPath)) {
    console.error(`\nLink report not found: ${reportPath}`);
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { checkedAt: string; results: { url: string; status: number | string; finalUrl: string }[] };
  const byUrl = new Map(report.results.map((r) => [r.url, r]));
  const broken = links.filter((l) => {
    const r = byUrl.get(l.url);
    return r && (typeof r.status !== "number" || r.status >= 400);
  });
  const unchecked = links.filter((l) => !byUrl.has(l.url));
  brokenCount = broken.length;
  console.log(`\nLink checker (${report.checkedAt}): ${report.results.length} checked`);
  console.log(`\nBroken according to the link checker (${broken.length}):\n`);
  for (const l of broken) console.log(`- ${byUrl.get(l.url)?.status} ${l.url} (${l.usedBy.join("; ")})`);
  if (!broken.length) console.log("- none");
  console.log(`\nNot covered by that report (${unchecked.length}):\n`);
  for (const l of unchecked) console.log(`- ${l.url} (${l.usedBy.join("; ")})`);
  if (!unchecked.length) console.log("- none");
} else {
  console.log("\n(No link report given: run the Link check workflow or npm run content:check-links, then pass --links build/link-report.json.)");
}
process.exit(brokenCount > 0 ? 1 : 0);
