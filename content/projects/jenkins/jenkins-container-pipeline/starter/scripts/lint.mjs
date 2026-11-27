// A small linter with no dependencies: every JavaScript file must parse (node --check), application code in
// src/ must not call console.log (it would print into the server's output), and no test may be left as
// test.only or describe.only (that would silently skip the other tests). Exits 1 on any problem.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const exists = (p) => statSync(p, { throwIfNoEntry: false });
const files = [];
const walk = (p) => {
  if (exists(p)?.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name));
  else if (/\.m?js$/.test(p)) files.push(p);
};
["src", "test", "scripts", "server.js"].filter(exists).forEach(walk);

const problems = [];
for (const file of files) {
  const parsed = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (parsed.status !== 0) problems.push(`${file}: syntax error\n${parsed.stderr.trim()}`);
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (file.startsWith("src") && /\bconsole\.log\(/.test(line)) problems.push(`${file}:${i + 1}: console.log in application code`);
    if (/\b(test|it|describe)\.only\(/.test(line)) problems.push(`${file}:${i + 1}: .only() skips the other tests`);
  });
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`lint: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`lint: ${files.length} files OK`);
