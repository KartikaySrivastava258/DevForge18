/**
 * Prints the mini-project checks a CI lesson shard will run (Docker checks, selected by shard and by changed
 * files) and writes count=<n> to $GITHUB_OUTPUT, so the shard installs the lesson tools (kind, kubectl …) when
 * a project check needs them even if no lesson is selected.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "./lib/content-loader.ts";
import { selectProjectChecks } from "./lib/project-selection.ts";

const { bundle } = loadContent(join(import.meta.dirname, "..", "content"));
const mine = selectProjectChecks(bundle.projects).filter((s) => !s.skip);
console.log(`project checks ${mine.length}: ${mine.map((s) => s.project.id).join(" ") || "(none)"}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${mine.length}\n`);
