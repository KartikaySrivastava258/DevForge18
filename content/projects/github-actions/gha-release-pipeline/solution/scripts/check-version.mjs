// Refuses to release when the pushed tag does not match package.json: tag v1.4.0 needs "version": "1.4.0".
// Usage (in the release workflow, where GitHub sets GITHUB_REF_NAME to the tag): node scripts/check-version.mjs
// Exit code 0 when they match, 1 otherwise, with a message saying what to fix.
import { readFileSync } from "node:fs";

const tag = process.env.GITHUB_REF_NAME ?? "";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`"${tag}" is not a release tag: expected v<major>.<minor>.<patch>, such as v${version}`);
  process.exit(1);
}
if (tag !== `v${version}`) {
  console.error(`tag ${tag} does not match package.json version ${version}: bump the version or tag v${version}`);
  process.exit(1);
}
console.log(`tag ${tag} matches package.json`);
