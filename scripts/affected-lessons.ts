/**
 * Prints the executed lessons and labs a CI shard will run, given DEVFORGE_CHANGED_FILES and
 * DEVFORGE_LESSON_SHARD (see scripts/lib/runnables.ts). Writes count=<n> to $GITHUB_OUTPUT when set,
 * so a shard with nothing to run can skip installing tools, and models=true|false: whether the simulation
 * models compared with real tools in Docker must run (modelComparisonsAffected in scripts/lib/affected.ts).
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { modelComparisonsAffected, scopeFromEnv } from "./lib/affected.ts";
import { loadRunnables, shardFilter } from "./lib/runnables.ts";

const { select } = loadRunnables(join(import.meta.dirname, "..", "content"));
const inShard = shardFilter(process.env.DEVFORGE_LESSON_SHARD);
const scope = scopeFromEnv(process.env.DEVFORGE_CHANGED_FILES);
const mine = select(scope).filter((_, i) => inShard(i));
const models = modelComparisonsAffected(scope);
console.log(`scope: ${scope === "all" ? "everything" : `${scope.lessonFiles.size} changed lesson/lab file(s)${scope.contentChanged ? ", content changed" : ""}`}`);
console.log(`runs ${mine.length}: ${mine.map((r) => r.id).join(" ") || "(none)"}`);
console.log(`simulation models against real tools: ${models ? "yes" : "no"}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${mine.length}\nmodels=${models}\n`);
