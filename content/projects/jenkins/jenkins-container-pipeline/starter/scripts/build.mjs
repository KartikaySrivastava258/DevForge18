// Builds the deployable folder dist/: the server, the application code, package.json and BUILD_INFO.json,
// which records the version, the commit and the build (GIT_COMMIT and BUILD_NUMBER in Jenkins, "local" elsewhere).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("src", "dist/src", { recursive: true });
cpSync("server.js", "dist/server.js");
const { scripts, ...runtime } = pkg;
writeFileSync("dist/package.json", JSON.stringify({ ...runtime, scripts: { start: scripts.start } }, null, 2) + "\n");
const info = { name: pkg.name, version: pkg.version, commit: process.env.GIT_COMMIT ?? "local", build: process.env.BUILD_NUMBER ?? "local" };
writeFileSync("dist/BUILD_INFO.json", JSON.stringify(info, null, 2) + "\n");
console.log(`built dist/ for ${pkg.name} ${pkg.version}`);
