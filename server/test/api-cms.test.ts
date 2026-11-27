import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cmsSettings, CMS_NOT_CONFIGURED } from "../src/config.ts";
import { markdownText } from "../src/routes/cms.ts";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.ts";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

const LESSON = "content/lessons/git-github/git-first-commits.md";
const CASE_STUDY = "content/case-studies/docker-shopify.yaml";

async function signIn(server: TestServer, email: string, role: "student" | "faculty" | "admin", name?: string): Promise<Client> {
  await server.createUser(email, STRONG_PASSWORD, role);
  if (name) server.db.prepare("UPDATE users SET display_name = ? WHERE email = ?").run(name, email);
  const client = new Client(server.url);
  assert.equal((await client.post("/api/auth/login", { email, password: STRONG_PASSWORD })).status, 200);
  return client;
}

describe("content editor configuration", () => {
  it("is disabled with a reason, never an exception, when settings are missing or unsafe", () => {
    assert.deepEqual(cmsSettings({}), { enabled: false, reason: CMS_NOT_CONFIGURED });
    assert.match((cmsSettings({ GITHUB_REPOSITORY: "org/repo" }) as { reason: string }).reason, /GITHUB_TOKEN is missing/);
    assert.match((cmsSettings({ GITHUB_TOKEN: "x" }) as { reason: string }).reason, /GITHUB_REPOSITORY is missing/);
    assert.match((cmsSettings({ GITHUB_REPOSITORY: "not a repo", GITHUB_TOKEN: "x" }) as { reason: string }).reason, /owner\/name/);
    assert.match((cmsSettings({ GITHUB_REPOSITORY: "org/..", GITHUB_TOKEN: "x" }) as { reason: string }).reason, /owner\/name/);
    assert.match(
      (cmsSettings({ GITHUB_REPOSITORY: "org/repo", GITHUB_TOKEN: "x", GITHUB_API_URL: "http://github.example.com" }) as { reason: string }).reason,
      /https/,
      "the token is never sent over plain HTTP to another machine",
    );
    assert.deepEqual(cmsSettings({ GITHUB_REPOSITORY: "org/repo", GITHUB_TOKEN: "x" }), {
      enabled: true,
      github: { owner: "org", repo: "repo", token: "x", apiUrl: "https://api.github.com" },
    });
    assert.equal((cmsSettings({ GITHUB_REPOSITORY: "org/repo", GITHUB_TOKEN: "x", GITHUB_API_URL: "http://127.0.0.1:9/api/" }) as { github: { apiUrl: string } }).github.apiUrl, "http://127.0.0.1:9/api");
  });

  it("escapes pull request text so names and notes cannot mention users or inject Markdown", () => {
    assert.equal(markdownText("@octocat [x](y)"), "&#64;octocat \\[x\\]\\(y\\)");
  });
});

describe("content editor while not configured", () => {
  let server: TestServer;
  let faculty: Client;
  before(async () => {
    server = await startTestServer();
    faculty = await signIn(server, "faculty@example.edu", "faculty");
  });
  after(() => server.close());

  it("reports itself disabled with the reason and refuses GitHub operations with 503", async () => {
    const status = await faculty.get("/api/cms/status");
    assert.equal(status.status, 200);
    assert.equal(status.json.enabled, false);
    assert.equal(status.json.reason, CMS_NOT_CONFIGURED);
    for (const res of [
      await faculty.get("/api/cms/files"),
      await faculty.get(`/api/cms/file?path=${encodeURIComponent(LESSON)}`),
      await faculty.post("/api/cms/submissions", { path: LESSON, content: "x", baseSha: "0".repeat(40), title: "Fix a typo" }),
    ]) {
      assert.equal(res.status, 503);
      assert.equal(res.json.error.code, "cms_disabled");
    }
  });

  it("still validates text, which needs no GitHub access", async () => {
    const res = await faculty.post("/api/cms/validate", { path: CASE_STUDY, content: "id: [unclosed" });
    assert.equal(res.status, 200);
    assert.equal(res.json.valid, false);
    assert.match(res.json.errors[0], /Invalid YAML/);
  });
});

describe("content editor with GitHub (fake)", () => {
  let server: TestServer;
  let gh: FakeGitHub;
  const as: Record<string, Client> = {};
  before(async () => {
    gh = await startFakeGitHub();
    server = await startTestServer({ cms: { enabled: true, github: gh.settings } });
    as.student = await signIn(server, "student@example.edu", "student");
    as.faculty = await signIn(server, "ada.faculty@example.edu", "faculty", "Ada Lovelace");
    as.admin = await signIn(server, "admin@example.edu", "admin");
    as.anon = new Client(server.url);
  });
  after(async () => {
    await server.close();
    await gh.close();
  });

  const openFile = async (path: string) => {
    const res = await as.faculty!.get(`/api/cms/file?path=${encodeURIComponent(path)}`);
    assert.equal(res.status, 200, res.text);
    return res.json as { content: string; sha: string; kind: string; defaultBranch: string };
  };
  const writes = () => gh.requests.filter((r) => r.method !== "GET");

  it("is limited to faculty and admins: students get 403, anonymous users 401", async () => {
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/cms/status"],
      ["GET", "/api/cms/files"],
      ["GET", `/api/cms/file?path=${encodeURIComponent(LESSON)}`],
      ["POST", "/api/cms/validate", { path: LESSON, content: "x" }],
      ["POST", "/api/cms/submissions", { path: LESSON, content: "x", baseSha: "0".repeat(40), title: "Fix a typo" }],
      ["GET", "/api/cms/submissions"],
    ];
    const before = gh.requests.length;
    for (const [method, path, body] of routes) {
      assert.equal((await as.student!.request(method, path, body)).status, 403, `${method} ${path} as student`);
      assert.equal((await as.anon!.request(method, path, body)).status, 401, `${method} ${path} anonymously`);
    }
    assert.equal(gh.requests.length, before, "no GitHub call is made for refused requests");
    assert.equal((await as.admin!.get("/api/cms/status")).json.enabled, true);
  });

  it("lists only editable content files from the default branch, and sends the token and API version", async () => {
    const res = await as.faculty!.get("/api/cms/files");
    assert.equal(res.status, 200);
    assert.equal(res.json.defaultBranch, "main");
    const paths = res.json.files.map((f: { path: string }) => f.path);
    assert.ok(paths.includes(LESSON));
    assert.ok(paths.includes(CASE_STUDY));
    assert.ok(!paths.some((p: string) => p.includes("starter/") || p.startsWith(".github") || p.endsWith(".svg")), paths.join(", "));
    const call = gh.requests.at(-1)!;
    assert.equal(call.authorization, `Bearer ${gh.settings.token}`);
    assert.equal(call.apiVersion, "2026-03-10");
    assert.ok(!res.text.includes(gh.settings.token), "the token never reaches the browser");
  });

  it("opens a file from the default branch with its blob SHA", async () => {
    const file = await openFile(LESSON);
    assert.equal(file.kind, "lesson");
    assert.equal(file.defaultBranch, "main");
    assert.match(file.content, /^---\nid: git-first-commits\n/);
    assert.equal(file.sha, gh.branches.get("main")!.get(LESSON)!.sha);
  });

  it("rejects path traversal, absolute paths, other extensions and files without a schema before calling GitHub", async () => {
    const bad = [
      "content/../server/src/app.ts",
      "content/lessons/../../.github/workflows/ci.yml",
      "content/lessons/git-github/../../../package.json",
      "/etc/passwd",
      "/content/lessons/git-github/git-first-commits.md",
      "C:/content/x.md",
      "content\\lessons\\git-github\\git-first-commits.md",
      "content/%2e%2e/x.md",
      "content//lessons/git-github/git-first-commits.md",
      "content/./lessons/git-github/git-first-commits.md",
      "content/lessons/git-github/notes.txt",
      "content/lessons/git-github/script.sh",
      "server/src/app.ts",
      "README.md",
      "content/projects/docker/docker-notes-api/starter/README.md",
      "content/media/docker/layers.yaml",
      `content/lessons/git-github/${"a".repeat(250)}.md`,
      "",
    ];
    const before = gh.requests.length;
    for (const path of bad) {
      const read = await as.faculty!.get(`/api/cms/file?path=${encodeURIComponent(path)}`);
      assert.equal(read.status, 400, `GET ${path}`);
      assert.equal(read.json.error.code, "invalid_path");
      const check = await as.faculty!.post("/api/cms/validate", { path, content: "---\nid: x\n---\nbody" });
      assert.equal(check.status, 400, `validate ${path}`);
      const submit = await as.faculty!.post("/api/cms/submissions", { path, content: "x", baseSha: "a".repeat(40), title: "Try something" });
      assert.equal(submit.status, 400, `submit ${path}`);
    }
    assert.equal(gh.requests.length, before, "no path outside the rules reaches GitHub");
  });

  it("reports validation errors (YAML, schema, id/folder) and opens no pull request", async () => {
    const file = await openFile(LESSON);
    const cases: [string, RegExp][] = [
      [file.content.replace("level: beginner", "level: [beginner"), /Invalid front matter/],
      [file.content.replace(/^estimated_minutes: 30\n/m, ""), /estimated_minutes/],
      [file.content.replace("id: git-first-commits", "id: git-other-name"), /id: must match the file name/],
      [file.content.replace("track: git-github", "track: docker"), /track: must match the folder/],
      ["No front matter at all", /Missing YAML front matter/],
    ];
    const before = writes().length;
    for (const [content, pattern] of cases) {
      const check = await as.faculty!.post("/api/cms/validate", { path: LESSON, content });
      assert.equal(check.json.valid, false);
      assert.ok(check.json.errors.some((e: string) => pattern.test(e)), `${pattern}: ${check.json.errors.join(" | ")}`);
      const submit = await as.faculty!.post("/api/cms/submissions", { path: LESSON, content, baseSha: file.sha, title: "Broken change" });
      assert.equal(submit.status, 422);
      assert.equal(submit.json.error.code, "content_invalid");
      assert.ok(submit.json.error.details.some((d: { field: string; message: string }) => d.field === "content" && pattern.test(d.message)));
    }
    const valid = await as.faculty!.post("/api/cms/validate", { path: LESSON, content: file.content });
    assert.deepEqual(valid.json, { valid: true, kind: "lesson", errors: [] });
    assert.equal(writes().length, before, "nothing was written to GitHub");
  });

  it("enforces the size limit and the CSRF check", async () => {
    const file = await openFile(CASE_STUDY);
    const big = await as.faculty!.post("/api/cms/validate", { path: CASE_STUDY, content: `${file.content}\n# ${"x".repeat(70 * 1024)}\n` });
    assert.equal(big.json.valid, false);
    assert.match(big.json.errors[0], /larger than 64 KB/);
    const huge = await as.faculty!.post("/api/cms/validate", { path: CASE_STUDY, content: "x".repeat(200 * 1024) });
    assert.equal(huge.status, 413);
    const noCsrf = await as.faculty!.request("POST", "/api/cms/submissions", { path: CASE_STUDY, content: file.content, baseSha: file.sha, title: "No header" }, { "x-devforge-csrf": "" });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error.code, "csrf_failed");
  });

  it("creates a branch, commits the file and opens a pull request; records it with the author's display name only", async () => {
    const file = await openFile(LESSON);
    const edited = file.content.replace("Your first repository and commits", "Your first repository and your first commits");
    const res = await as.faculty!.post("/api/cms/submissions", {
      path: LESSON,
      content: edited,
      baseSha: file.sha,
      title: "Clarify the first-commits lesson title",
      note: "Students asked about this. cc @someone",
    });
    assert.equal(res.status, 201, res.text);
    const s = res.json.submission;
    assert.match(s.branch, /^cms\/git-first-commits-\d{8}-\d{6}-[0-9a-f]{6}$/);
    assert.equal(s.prUrl, "https://github.example/devforge-test/devforge18/pull/1");
    assert.equal(s.prNumber, 1);

    // GitHub side: branch from main's head, the file committed on that branch only, the pull request into main.
    assert.equal(gh.branches.get(s.branch)!.get(LESSON)!.text, edited);
    assert.equal(gh.branches.get("main")!.get(LESSON)!.text, file.content, "main is untouched");
    const put = gh.requests.find((r) => r.method === "PUT")!.body as { message: string; branch: string; sha: string };
    assert.equal(put.branch, s.branch);
    assert.equal(put.sha, file.sha);
    assert.match(put.message, /^Clarify the first-commits lesson title\n\nSubmitted through the DevForge content editor by Ada Lovelace\.$/);
    const pr = gh.pulls[0]!;
    assert.deepEqual([pr.head, pr.base, pr.title], [s.branch, "main", "Clarify the first-commits lesson title"]);
    assert.match(pr.body, /by \*\*Ada Lovelace\*\* \(faculty\)/);
    assert.match(pr.body, /`content\/lessons\/git-github\/git-first-commits\.md`/);
    assert.match(pr.body, /cc &#64;someone/, "mentions in the note are neutralised");
    assert.match(pr.body, /CI: cross-file checks/);
    for (const r of gh.requests) assert.ok(!JSON.stringify(r.body ?? "").includes("@example.edu"), "no e-mail address is sent to GitHub");

    // Our side: the submission table and the audit log.
    const row = server.db.prepare("SELECT * FROM cms_submissions WHERE id = ?").get(s.id) as Record<string, unknown>;
    assert.equal(row.file_path, LESSON);
    assert.equal(row.branch, s.branch);
    assert.equal(row.pr_url, s.prUrl);
    assert.equal(row.kind, "lesson");
    const audit = await as.admin!.get("/api/admin/audit");
    const event = audit.json.events.find((e: { action: string }) => e.action === "content.pull_request_opened");
    assert.equal(event.target_id, LESSON);
    assert.deepEqual(event.metadata, { branch: s.branch, prUrl: s.prUrl, prNumber: 1 });

    const mine = await as.faculty!.get("/api/cms/submissions");
    assert.equal(mine.json.scope, "mine");
    assert.equal(mine.json.submissions[0].author, "Ada Lovelace");
    assert.ok(!mine.text.includes("@example.edu"));
    const all = await as.admin!.get("/api/cms/submissions");
    assert.equal(all.json.scope, "all");
    assert.equal(all.json.submissions.length, 1);
  });

  it("refuses an edit based on an outdated version of the file, and an edit without changes", async () => {
    const file = await openFile(CASE_STUDY);
    gh.commitOnMain(CASE_STUDY, file.content.replace("Shopify containerised", "Shopify containerized"));
    const stale = await as.faculty!.post("/api/cms/submissions", {
      path: CASE_STUDY,
      content: file.content.replace("Shopify containerised", "Shopify moved"),
      baseSha: file.sha,
      title: "Reword the summary",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "stale_base");

    const fresh = await openFile(CASE_STUDY);
    const same = await as.faculty!.post("/api/cms/submissions", { path: CASE_STUDY, content: fresh.content, baseSha: fresh.sha, title: "Nothing changed" });
    assert.equal(same.status, 422);
    assert.equal(same.json.error.code, "no_changes");
  });

  it("turns GitHub failures into readable errors and audits them", async () => {
    const file = await openFile(CASE_STUDY);
    const edit = { path: CASE_STUDY, content: file.content.replace("Shopify containerized", "Shopify containerised"), baseSha: file.sha, title: "Spelling" };
    gh.failNext("POST /repos/devforge-test/devforge18/pulls", 403, "Resource not accessible by personal access token");
    const res = await as.admin!.post("/api/cms/submissions", edit);
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, "github_access");
    assert.match(res.json.error.message, /Pull requests write access/);
    assert.match(res.json.error.message, /The branch cms\/docker-shopify-/);
    const audit = await as.admin!.get("/api/admin/audit");
    const failed = audit.json.events.find((e: { action: string }) => e.action === "content.pull_request_failed");
    assert.equal(failed.metadata.step, "open the pull request");
    assert.equal(failed.metadata.status, 403);

    gh.failNext("GET /repos/devforge-test/devforge18", 401, "Bad credentials");
    const unauth = await as.faculty!.get("/api/cms/files");
    assert.equal(unauth.status, 502);
    assert.equal(unauth.json.error.code, "github_auth");
    assert.equal((await as.faculty!.get(`/api/cms/file?path=${encodeURIComponent("content/lessons/git-github/git-no-such-lesson.md")}`)).status, 404);
  });
});
