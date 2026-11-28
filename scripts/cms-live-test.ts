/**
 * One-off integration test of the content editor against the real GitHub API (ADR 0011).
 *
 *   node --disable-warning=ExperimentalWarning --env-file="$HOME/.config/devforge18/cms-test.env" scripts/cms-live-test.ts
 *
 * The env file (outside the repository, mode 600) holds GITHUB_REPOSITORY and GITHUB_TOKEN for a SCRATCH
 * repository; --env-file puts them into this one process only, never into the shell. The test:
 *   1. starts DevForge in this process on a free port with an in-memory database (nothing is written to data/),
 *   2. signs in as a throwaway faculty account and opens the editor's status, file list and one lesson,
 *   3. submits a small, valid edit, which must come back as a pull request,
 *   4. reads that pull request back from GitHub independently and checks its branch, base and changed file,
 *   5. checks that the token never appeared in the server's log output or in an API response.
 * It prints the pull request's URL, never the token. The pull request is left open for a person to inspect.
 */
import assert from "node:assert/strict";
import { cmsSettings } from "../server/src/config.ts";
import { GITHUB_API_VERSION } from "../server/src/cms/github.ts";
import type { Logger } from "../server/src/observability/logger.ts";
import { Client, STRONG_PASSWORD, startTestServer } from "../server/test/helpers.ts";

const LESSON = "content/lessons/docker/docker-images-vs-containers.md";
const cms = cmsSettings(process.env);
if (!cms.enabled) {
  console.error(`The content editor is not configured: ${cms.reason}`);
  process.exit(2);
}
const { owner, repo, token, apiUrl } = cms.github;
if (repo === "DevForge18" || repo === "devforge18") {
  console.error("Refusing to run against what looks like the main repository; use a scratch repository.");
  process.exit(2);
}

const logLines: string[] = [];
const capture = (level: string) => (msg: string, fields?: Record<string, unknown>) => {
  logLines.push(`${level} ${msg} ${JSON.stringify(fields ?? {}, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v))}`);
};
const logger: Logger = { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") };

const step = (n: number, what: string) => console.log(`${n}. ${what}`);
const app = await startTestServer({ cms }, undefined, { logger });
const responses: string[] = [];
try {
  await app.createUser("cms-live-test@example.edu", STRONG_PASSWORD, "faculty");
  const c = new Client(app.url);
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const res = method === "GET" ? await c.get(path) : await c.post(path, body);
    responses.push(res.text);
    return res;
  };
  assert.equal((await call("POST", "/api/auth/login", { email: "cms-live-test@example.edu", password: STRONG_PASSWORD })).status, 200);

  const status = await call("GET", "/api/cms/status");
  assert.equal(status.json?.enabled, true, `editor enabled (${status.text})`);
  step(1, `editor enabled for ${status.json.repository}`);

  const files = await call("GET", "/api/cms/files");
  assert.equal(files.status, 200, files.text);
  assert.ok(files.json.files.length > 100, "the scratch repository holds DevForge's content files");
  step(2, `listed ${files.json.files.length} editable content files on ${files.json.defaultBranch} (truncated: ${files.json.truncated})`);

  const file = await call("GET", `/api/cms/file?path=${encodeURIComponent(LESSON)}`);
  assert.equal(file.status, 200, file.text);
  step(3, `read ${LESSON} (${file.json.content.length} characters, blob ${file.json.sha.slice(0, 7)})`);

  // A real but harmless edit: one sentence added at the end of the lesson.
  const stamp = new Date().toISOString();
  const edited = `${file.json.content.replace(/\s*$/, "")}\n\nThis sentence was added by the content editor's live test on ${stamp}.\n`;
  const valid = await call("POST", "/api/cms/validate", { path: LESSON, content: edited });
  assert.equal(valid.json?.valid, true, `edit validates (${valid.text})`);

  const submitted = await call("POST", "/api/cms/submissions", {
    path: LESSON,
    content: edited,
    baseSha: file.json.sha,
    title: "Content editor live test (scratch repository)",
    note: "Opened by scripts/cms-live-test.ts to test the editor against the real GitHub API. Close it without merging.",
  });
  assert.equal(submitted.status, 201, submitted.text);
  const { prUrl, prNumber, branch } = submitted.json.submission;
  step(4, `pull request opened: ${prUrl} (branch ${branch})`);

  // Read it back from GitHub, independently of the editor's own client.
  const gh = async (path: string) => {
    const res = await fetch(`${apiUrl}/repos/${owner}/${repo}${path}`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": GITHUB_API_VERSION },
    });
    assert.equal(res.status, 200, `GET ${path} → ${res.status}`);
    return res.json() as Promise<any>;
  };
  const pr = await gh(`/pulls/${prNumber}`);
  assert.equal(pr.state, "open");
  assert.equal(pr.head.ref, branch);
  assert.equal(pr.base.ref, files.json.defaultBranch);
  const changed = await gh(`/pulls/${prNumber}/files`);
  assert.deepEqual(changed.map((f: { filename: string }) => f.filename), [LESSON]);
  assert.equal(changed[0].additions, 2, "one blank line and one sentence added");
  assert.equal(changed[0].deletions, 0);
  step(5, `GitHub confirms: PR #${prNumber} open, ${branch} → ${pr.base.ref}, 1 file changed (+2 −0)`);

  const mine = await call("GET", "/api/cms/submissions");
  assert.equal(mine.json.submissions[0]?.prNumber, prNumber);
  step(6, "the submission is listed under the faculty account's submissions");

  const leaked = [...logLines, ...responses].filter((line) => line.includes(token));
  assert.equal(leaked.length, 0, `the token appeared in ${leaked.length} log line(s) or response(s)`);
  step(7, `the token appears in none of ${logLines.length} server log lines and ${responses.length} API responses`);
  console.log("PASS: content editor works against the real GitHub API.");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`FAIL: ${message.split(token).join("[token]")}`);
  for (const line of logLines.slice(-10)) console.error(`  log: ${line.split(token).join("[token]")}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
