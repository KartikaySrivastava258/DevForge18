// Should refuse to release when the pushed tag does not match package.json: tag v1.4.0 needs "version": "1.4.0".
// Usage (in the release workflow, where GitHub sets GITHUB_REF_NAME to the tag): node scripts/check-version.mjs
// Exit code 0 when they match, 1 otherwise, with a message saying what to fix.
//
// TODO: implement. For now it accepts everything.
console.log(`not checked yet: ${process.env.GITHUB_REF_NAME ?? "(no tag)"}`);
