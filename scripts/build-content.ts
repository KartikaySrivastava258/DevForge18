/**
 * Validates all content and writes build/content.json.
 * Exit code 1 if any error is found, so CI blocks invalid content.
 *
 *   npm run content:build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent } from "./lib/content-loader.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { bundle, errors, warnings } = loadContent(join(repoRoot, "content"));

for (const warning of warnings) console.warn(`warn  ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`error ${error}`);
  console.error(`\nContent validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

const outFile = join(repoRoot, "build", "content.json");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(bundle));
console.log(
  `Content OK: ${bundle.tracks.length} tracks, ${bundle.paths.length} learning paths, ` +
    `${bundle.lessons.length} lessons, ${bundle.labs.length} labs, ${bundle.case_studies.length} case studies → ${outFile}`,
);
