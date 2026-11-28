/**
 * Endpoint authorization review (release checklist item 4, docs/security.md "Endpoint authorization review").
 *
 * Covers every endpoint added or changed since Phase 0 for the three questions the review asks:
 * anonymous callers get 401 where an account is needed, signed-in callers without the role get 403,
 * and one user can never read or change another user's resource. Every refused call is also checked
 * for side effects: the stored data must be exactly as it was.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, testContent, type TestServer } from "./helpers.ts";

const PROJECT = "git-portfolio-repository";
const ARCH = "batch-data-platform";
const LOCAL_LAB = "git-resolve-a-merge-conflict";
const SIM = "git-commit-graph";
const UNDO = `/api/simulations/${SIM}/challenges/undo-pushed-commit/verify`;
const CERT_TRACK = "kubernetes";
const DUE = "2026-12-15T18:00:00+05:30";

let server: TestServer;
let teacher: Client; // faculty, teaches cohort A (the learner's cohort)
let otherTeacher: Client; // faculty, teaches cohort B only
let learner: Client; // student in cohort A
let outsider: Client; // student in cohort B
let admin: Client;
let anonymous: Client;
type Key = "learner" | "outsider" | "teacher" | "otherTeacher" | "cohortA" | "codeA" | "cohortB" | "assignmentA" | "assignmentB" | "submission" | "decision" | "certificate";
const id = {} as Record<Key, string>;

async function login(email: string): Promise<Client> {
  const c = new Client(server.url);
  assert.equal((await c.post("/api/auth/login", { email, password: STRONG_PASSWORD })).status, 200, email);
  return c;
}
const userId = (email: string) => (server.db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

/** Everything an authorization failure could change. Audit events and sessions are left out on purpose. */
function snapshot(): string {
  const tables: [string, string][] = [
    ["users", "SELECT id, email, role, disabled_at FROM users ORDER BY id"],
    ["cohorts", "SELECT * FROM cohorts ORDER BY id"],
    ["cohort_members", "SELECT * FROM cohort_members ORDER BY cohort_id, user_id"],
    ["assignments", "SELECT * FROM assignments ORDER BY id"],
    ["submissions", "SELECT * FROM submissions ORDER BY id"],
    ["reviews", "SELECT * FROM reviews ORDER BY id"],
    ["architecture_decisions", "SELECT * FROM architecture_decisions ORDER BY id"],
    ["portfolios", "SELECT * FROM portfolios ORDER BY user_id"],
    ["certificates", "SELECT * FROM certificates ORDER BY id"],
    ["lab_progress", "SELECT * FROM lab_progress ORDER BY user_id, lab_id"],
    ["simulation_progress", "SELECT * FROM simulation_progress ORDER BY user_id, simulation_id, challenge_id"],
    ["quiz_attempts", "SELECT * FROM quiz_attempts ORDER BY rowid"],
    ["cms_submissions", "SELECT * FROM cms_submissions ORDER BY id"],
  ];
  return JSON.stringify(Object.fromEntries(tables.map(([name, sql]) => [name, server.db.prepare(sql).all()])));
}

before(async () => {
  server = await startTestServer();
  await server.createUser("teacher@example.edu", STRONG_PASSWORD, "faculty");
  await server.createUser("other-teacher@example.edu", STRONG_PASSWORD, "faculty");
  await server.createUser("learner@example.edu", STRONG_PASSWORD);
  await server.createUser("outsider@example.edu", STRONG_PASSWORD);
  await server.createUser("root@example.edu", STRONG_PASSWORD, "admin");
  teacher = await login("teacher@example.edu");
  otherTeacher = await login("other-teacher@example.edu");
  learner = await login("learner@example.edu");
  outsider = await login("outsider@example.edu");
  admin = await login("root@example.edu");
  anonymous = new Client(server.url);
  id.learner = userId("learner@example.edu");
  id.outsider = userId("outsider@example.edu");
  id.teacher = userId("teacher@example.edu");
  id.otherTeacher = userId("other-teacher@example.edu");

  // Two cohorts with different teachers and learners.
  const a = await teacher.post("/api/cohorts", { name: "Cohort A" });
  const b = await otherTeacher.post("/api/cohorts", { name: "Cohort B" });
  id.cohortA = a.json.cohort.id;
  id.codeA = a.json.cohort.joinCode;
  id.cohortB = b.json.cohort.id;
  assert.equal((await learner.post("/api/cohorts/join", { code: id.codeA })).status, 200);
  assert.equal((await outsider.post("/api/cohorts/join", { code: b.json.cohort.joinCode })).status, 200);
  const assignA = await teacher.post(`/api/cohorts/${id.cohortA}/assignments`, { kind: "lesson", itemId: "git-first-commits", dueAt: DUE });
  const assignB = await otherTeacher.post(`/api/cohorts/${id.cohortB}/assignments`, { kind: "quiz", itemId: "git-github", dueAt: DUE });
  id.assignmentA = assignA.json.assignment.id;
  id.assignmentB = assignB.json.assignment.id;

  // The learner's own work and progress: the targets of the "another user" tests.
  const sub = await learner.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://git.example.edu/learner/portfolio", notes: "learner-private-notes" });
  id.submission = sub.json.submission.id;
  await learner.request("PUT", `/api/me/decisions/${ARCH}`, { title: "Learner decision record", context: "learner-context", decision: "learner-decision", consequences: "learner-consequences", status: "submitted" });
  id.decision = String((server.db.prepare("SELECT id FROM architecture_decisions WHERE user_id = ?").get(id.learner) as { id: number }).id);
  await learner.request("PUT", "/api/me/portfolio", { isPublic: false, slug: "learner-portfolio", headline: "Learner headline" });
  const lab = testContent().getLab(LOCAL_LAB);
  assert.ok(lab);
  assert.equal((await learner.post(`/api/labs/${LOCAL_LAB}/complete`, { checkpoints: lab.checkpoints.map((c) => c.id) })).status, 200);
  assert.equal((await learner.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }] })).json.saved, true);
  // Make the learner eligible for the Kubernetes certificate (quiz passed, every server-verifiable lab verified).
  server.db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, 'kubernetes-quiz', ?, 0.9, 1, ?)").run(id.learner, CERT_TRACK, new Date().toISOString());
  for (const l of testContent().labsFor(CERT_TRACK).filter((x) => x.mode !== "local")) {
    server.db.prepare("INSERT INTO lab_progress (user_id, lab_id, track_slug, evidence, completed_at) VALUES (?, ?, ?, 'verified', ?)").run(id.learner, l.id, CERT_TRACK, new Date().toISOString());
  }
  const cert = await learner.post(`/api/me/certificates/${CERT_TRACK}`);
  assert.equal(cert.status, 201);
  id.certificate = cert.json.certificate.id;
  // One content-editor pull request recorded for the teacher (the editor itself is not configured here).
  server.db.prepare(
    "INSERT INTO cms_submissions (id, user_id, file_path, kind, title, branch, pr_url, pr_number, created_at) VALUES ('cms-1', ?, 'content/lessons/git-github/git-first-commits.md', 'lesson', 'Teacher edit', 'cms/x', 'https://github.example/pull/1', 1, ?)",
  ).run(id.teacher, new Date().toISOString());
});
after(() => server.close());

/** [method, path, body] — built lazily because the ids only exist after setup. */
type Call = [string, string, unknown?];

const signedInRoutes = (): Call[] => [
  ["GET", "/api/me/labs"],
  ["POST", `/api/labs/${LOCAL_LAB}/complete`, { checkpoints: [] }],
  ["GET", "/api/me/quizzes"],
  ["GET", `/api/projects/${PROJECT}/solution`],
  ["GET", "/api/me/decisions"],
  ["GET", `/api/me/decisions/${ARCH}`],
  ["PUT", `/api/me/decisions/${ARCH}`, { title: "Anonymous edit", context: "", decision: "", consequences: "", status: "draft" }],
  ["POST", "/api/cohorts", { name: "Anonymous cohort" }],
  ["GET", "/api/cohorts"],
  ["POST", "/api/cohorts/join", { code: id.codeA }],
  ["GET", `/api/cohorts/${id.cohortA}`],
  ["POST", `/api/cohorts/${id.cohortA}/code`],
  ["DELETE", `/api/cohorts/${id.cohortA}/members/${id.learner}`],
  ["GET", "/api/assignable"],
  ["POST", `/api/cohorts/${id.cohortA}/assignments`, { kind: "lesson", itemId: "git-first-commits", dueAt: DUE }],
  ["DELETE", `/api/cohorts/${id.cohortA}/assignments/${id.assignmentA}`],
  ["GET", "/api/me/assignments"],
  ["GET", "/api/me/submissions"],
  ["GET", `/api/me/submissions/project/${PROJECT}`],
  ["PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://evil.example/repo" }],
  ["GET", "/api/reviews"],
  ["GET", `/api/reviews/submission/${id.submission}`],
  ["POST", `/api/reviews/submission/${id.submission}`, { scores: {}, feedback: "x", outcome: "accepted" }],
  ["GET", `/api/me/decisions/${ARCH}/review`],
  ["GET", "/api/me/portfolio"],
  ["PUT", "/api/me/portfolio", { isPublic: true, slug: "learner-portfolio" }],
  ["GET", "/api/me/certificates"],
  ["POST", `/api/me/certificates/${CERT_TRACK}`],
  ["POST", `/api/certificates/${id.certificate}/revoke`],
  ["GET", "/api/me/export"],
  ["POST", "/api/me/delete", { password: STRONG_PASSWORD, confirm: "delete my account" }],
  ["GET", "/api/admin/users"],
  ["PATCH", `/api/admin/users/${id.learner}/role`, { role: "admin" }],
  ["PATCH", `/api/admin/users/${id.learner}/status`, { disabled: true }],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/cms/status"],
  ["GET", "/api/cms/files"],
  ["GET", "/api/cms/file?path=content%2Flessons%2Fgit-github%2Fgit-first-commits.md"],
  ["POST", "/api/cms/validate", { path: "content/lessons/git-github/git-first-commits.md", content: "x" }],
  ["POST", "/api/cms/submissions", { path: "content/lessons/git-github/git-first-commits.md", content: "x", baseSha: "0".repeat(40), title: "Anonymous edit" }],
  ["GET", "/api/cms/submissions"],
];

const staffRoutes = (): Call[] => [
  ["GET", `/api/projects/${PROJECT}/solution`],
  ["POST", "/api/cohorts", { name: "Learner cohort" }],
  ["POST", `/api/cohorts/${id.cohortA}/code`],
  ["GET", "/api/assignable"],
  ["POST", `/api/cohorts/${id.cohortA}/assignments`, { kind: "lesson", itemId: "git-branches-and-merging", dueAt: DUE }],
  ["DELETE", `/api/cohorts/${id.cohortA}/assignments/${id.assignmentA}`],
  ["GET", "/api/reviews"],
  ["GET", `/api/reviews/submission/${id.submission}`],
  ["POST", `/api/reviews/submission/${id.submission}`, { scores: {}, feedback: "Self review", outcome: "accepted" }],
  ["GET", `/api/reviews/decision/${id.decision}`],
  ["POST", `/api/reviews/decision/${id.decision}`, { scores: {}, feedback: "Self review", outcome: "accepted" }],
  ["GET", "/api/cms/status"],
  ["GET", "/api/cms/files"],
  ["GET", "/api/cms/file?path=content%2Flessons%2Fgit-github%2Fgit-first-commits.md"],
  ["POST", "/api/cms/validate", { path: "content/lessons/git-github/git-first-commits.md", content: "x" }],
  ["POST", "/api/cms/submissions", { path: "content/lessons/git-github/git-first-commits.md", content: "x", baseSha: "0".repeat(40), title: "Student edit" }],
  ["GET", "/api/cms/submissions"],
];

const adminRoutes = (): Call[] => [
  ["GET", "/api/admin/users"],
  ["PATCH", `/api/admin/users/${id.learner}/role`, { role: "faculty" }],
  ["PATCH", `/api/admin/users/${id.learner}/status`, { disabled: true }],
  ["GET", "/api/admin/audit"],
  ["POST", `/api/certificates/${id.certificate}/revoke`],
];

describe("authorization review: sign-in and role checks", () => {
  it("anonymous callers get 401 on every route that needs an account, and nothing changes", async () => {
    const before = snapshot();
    for (const [method, path, body] of signedInRoutes()) {
      const res = await anonymous.request(method, path, body);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.json.error.code, "unauthenticated", `${method} ${path}`);
    }
    assert.equal(snapshot(), before);
  });

  it("students get 403 on faculty and admin routes, and nothing changes", async () => {
    const before = snapshot();
    for (const [method, path, body] of [...staffRoutes(), ...adminRoutes()]) {
      const res = await learner.request(method, path, body);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.json.error.code, "forbidden", `${method} ${path}`);
      assert.doesNotMatch(res.text, /learner-private-notes|learner-decision|@example\.edu/, `${method} ${path} leaks nothing`);
    }
    assert.equal(snapshot(), before);
  });

  it("faculty get 403 on admin routes (users, roles, account status, audit log, certificate revocation), and nothing changes", async () => {
    const before = snapshot();
    for (const [method, path, body] of adminRoutes()) {
      const res = await teacher.request(method, path, body);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.doesNotMatch(res.text, /@example\.edu/, `${method} ${path} leaks nothing`);
    }
    assert.equal(snapshot(), before);
  });

  it("public-by-design routes answer without an account and never include personal data", async () => {
    const pub: string[] = [
      "/api/graph",
      "/api/integrations/docker-to-kubernetes",
      "/api/capstones",
      "/api/capstones/capstone-a",
      "/api/architectures",
      `/api/architectures/${ARCH}`,
      "/api/tracks/git-github",
      "/api/paths/devops-platform",
      "/api/tracks/git-github/quiz",
      "/api/tracks/git-github/projects",
      `/api/projects/${PROJECT}`,
      `/api/labs/${LOCAL_LAB}`,
      `/api/simulations/${SIM}`,
      `/api/certificates/${id.certificate}`,
    ];
    for (const path of pub) {
      const res = await anonymous.get(path);
      assert.equal(res.status, 200, path);
      assert.doesNotMatch(res.text, /@example\.edu|learner-private-notes|learner-decision|password_hash|scrypt/, path);
    }
    // Anonymous practice is graded but never stored.
    const before = snapshot();
    assert.equal((await anonymous.post(UNDO, { actions: [{ type: "revert", commit: "HEAD" }] })).json.saved, false);
    assert.equal(snapshot(), before);
  });

  it("the CSRF check refuses a cross-site account deletion even with a valid session cookie", async () => {
    const before = snapshot();
    const body = { password: STRONG_PASSWORD, confirm: "delete my account" };
    const noHeader = await learner.request("POST", "/api/me/delete", body, { "x-devforge-csrf": "" });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.json.error.code, "csrf_failed");
    const crossSite = await learner.request("POST", "/api/me/delete", body, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.json.error.code, "csrf_failed");
    assert.equal(snapshot(), before);
    assert.equal((await learner.get("/api/me/portfolio")).status, 200, "the account and its session still work");
  });
});

describe("authorization review: a learner's own data", () => {
  it("/api/me reads return only the caller's own records, never another learner's", async () => {
    // Positive control: the learner sees their own data.
    assert.ok((await learner.get("/api/me/labs")).json.labs.some((l: { labId: string }) => l.labId === LOCAL_LAB));
    assert.equal((await learner.get("/api/me/quizzes")).json.quizzes.length, 1);
    assert.equal((await learner.get("/api/me/decisions")).json.decisions.length, 1);
    assert.equal((await learner.get(`/api/me/submissions/project/${PROJECT}`)).json.submission.notes, "learner-private-notes");

    const own = async (path: string) => {
      const res = await outsider.get(path);
      assert.equal(res.status, 200, path);
      assert.doesNotMatch(res.text, /learner-private-notes|learner-decision|Learner decision record|learner@example\.edu|Learner headline/, path);
      return res.json;
    };
    assert.deepEqual((await own("/api/me/labs")).labs, []);
    assert.deepEqual((await own("/api/me/quizzes")).quizzes, []);
    assert.deepEqual((await own("/api/me/decisions")).decisions, []);
    assert.equal((await own(`/api/me/decisions/${ARCH}`)).decision, null);
    assert.equal((await own(`/api/me/decisions/${ARCH}/review`)).review, null);
    assert.deepEqual((await own("/api/me/submissions")).submissions, []);
    assert.equal((await own(`/api/me/submissions/project/${PROJECT}`)).submission, null);
    assert.equal((await own("/api/me/portfolio")).portfolio, null);
    const certs = (await own("/api/me/certificates")).tracks.find((t: { track: string }) => t.track === CERT_TRACK);
    assert.equal(certs.certificate, null);
    assert.equal(certs.eligible, false, "eligibility is computed from the caller's progress only");
    const assignments = (await own("/api/me/assignments")).assignments;
    assert.deepEqual(assignments.map((a: { id: string }) => a.id), [id.assignmentB], "only the assignments of the caller's own cohort");
    // Public content pages show the caller's progress, not someone else's.
    assert.equal((await own(`/api/labs/${LOCAL_LAB}`)).progress, null);
    assert.deepEqual((await own(`/api/simulations/${SIM}`)).completed, []);
    assert.equal((await anonymous.get(`/api/labs/${LOCAL_LAB}`)).json.progress, null);
  });

  it("writes to /api/me routes change only the caller's own rows", async () => {
    const learnerRows = () =>
      JSON.stringify([
        server.db.prepare("SELECT * FROM submissions WHERE user_id = ?").all(id.learner),
        server.db.prepare("SELECT * FROM architecture_decisions WHERE user_id = ?").all(id.learner),
        server.db.prepare("SELECT * FROM portfolios WHERE user_id = ?").all(id.learner),
        server.db.prepare("SELECT * FROM lab_progress WHERE user_id = ?").all(id.learner),
      ]);
    const before = learnerRows();
    const sub = await outsider.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://evil.example/repo", notes: "outsider" });
    assert.equal(sub.status, 200);
    assert.notEqual(sub.json.submission.id, id.submission, "the outsider gets a submission of their own");
    const dec = await outsider.request("PUT", `/api/me/decisions/${ARCH}`, { title: "Outsider decision", context: "", decision: "", consequences: "", status: "draft" });
    assert.equal(dec.status, 200);
    const lab = testContent().getLab(LOCAL_LAB);
    assert.equal((await outsider.post(`/api/labs/${LOCAL_LAB}/complete`, { checkpoints: lab?.checkpoints.map((c) => c.id) })).status, 200);
    const slug = await outsider.request("PUT", "/api/me/portfolio", { isPublic: true, slug: "learner-portfolio", headline: "Taken over" });
    assert.equal(slug.status, 409, "another learner's portfolio address cannot be taken over");
    assert.equal(learnerRows(), before);
    // Clean up the outsider's rows so later tests see only the learner's work.
    server.db.prepare("DELETE FROM submissions WHERE user_id = ?").run(id.outsider);
    server.db.prepare("DELETE FROM architecture_decisions WHERE user_id = ?").run(id.outsider);
    server.db.prepare("DELETE FROM lab_progress WHERE user_id = ?").run(id.outsider);
  });

  it("another learner's progress never earns a certificate; neither the holder nor faculty can revoke one", async () => {
    const before = snapshot();
    const res = await outsider.post(`/api/me/certificates/${CERT_TRACK}`);
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "not_eligible");
    assert.equal((await learner.post(`/api/certificates/${id.certificate}/revoke`)).status, 403, "the holder");
    assert.equal((await teacher.post(`/api/certificates/${id.certificate}/revoke`)).status, 403, "the holder's teacher");
    assert.equal(snapshot(), before);
    assert.equal((await anonymous.get(`/api/certificates/${id.certificate}`)).json.certificate.revokedAt, null);
  });

  it("a private portfolio is 404 for everyone, including the learner's teacher; publishing is the owner's choice and disabling the account hides it", async () => {
    for (const who of [anonymous, outsider, teacher, admin]) assert.equal((await who.get("/api/portfolio/learner-portfolio")).status, 404);
    assert.equal((await learner.request("PUT", "/api/me/portfolio", { isPublic: true, slug: "learner-portfolio", headline: "Learner headline" })).status, 200);
    const pub = await anonymous.get("/api/portfolio/learner-portfolio");
    assert.equal(pub.status, 200);
    assert.doesNotMatch(pub.text, /@example\.edu|learner-private-notes/);
    assert.equal((await admin.request("PATCH", `/api/admin/users/${id.learner}/status`, { disabled: true })).status, 200);
    assert.equal((await anonymous.get("/api/portfolio/learner-portfolio")).status, 404, "a disabled account's portfolio is hidden");
    assert.equal((await admin.request("PATCH", `/api/admin/users/${id.learner}/status`, { disabled: false })).status, 200);
    learner = await login("learner@example.edu"); // disabling deleted the learner's sessions
    assert.equal((await learner.request("PUT", "/api/me/portfolio", { isPublic: false, slug: "learner-portfolio", headline: "Learner headline" })).status, 200);
    assert.equal((await anonymous.get("/api/portfolio/learner-portfolio")).status, 404, "switching it off hides it again");
  });
});

describe("authorization review: cohorts are managed only by the faculty who teach them", () => {
  it("another teacher cannot open, re-key, assign to or remove members from a cohort they do not teach", async () => {
    const before = snapshot();
    const open = await otherTeacher.get(`/api/cohorts/${id.cohortA}`);
    assert.equal(open.status, 404);
    assert.doesNotMatch(open.text, /learner@example\.edu/);
    assert.equal((await otherTeacher.post(`/api/cohorts/${id.cohortA}/code`)).status, 403);
    assert.equal((await otherTeacher.post(`/api/cohorts/${id.cohortA}/assignments`, { kind: "lesson", itemId: "git-branches-and-merging", dueAt: DUE })).status, 403);
    assert.equal((await otherTeacher.request("DELETE", `/api/cohorts/${id.cohortA}/assignments/${id.assignmentA}`)).status, 403);
    assert.equal((await otherTeacher.request("DELETE", `/api/cohorts/${id.cohortB}/assignments/${id.assignmentA}`)).status, 404, "cohort A's assignment cannot be deleted through cohort B");
    assert.equal((await otherTeacher.request("DELETE", `/api/cohorts/${id.cohortA}/members/${id.learner}`)).status, 403);
    assert.equal((await otherTeacher.request("DELETE", `/api/cohorts/${id.cohortB}/members/${id.learner}`)).status, 404, "nor through a cohort the learner is not in");
    const list = await otherTeacher.get("/api/cohorts");
    assert.deepEqual(list.json.cohorts.map((c: { id: string }) => c.id), [id.cohortB]);
    assert.equal(snapshot(), before);
  });

  it("a learner in the cohort cannot see other members, the join code, or remove anyone", async () => {
    const before = snapshot();
    const view = await learner.get(`/api/cohorts/${id.cohortA}`);
    assert.equal(view.status, 200);
    assert.equal(view.json.learners, undefined);
    assert.equal(view.json.cohort.joinCode, undefined);
    assert.equal((await learner.get("/api/cohorts")).json.cohorts[0].joinCode, undefined);
    assert.equal((await learner.request("DELETE", `/api/cohorts/${id.cohortA}/members/${id.teacher}`)).status, 403);
    assert.equal((await learner.request("DELETE", `/api/cohorts/${id.cohortA}/assignments/${id.assignmentA}`)).status, 403);
    assert.equal(snapshot(), before);
  });

  it("a teacher whose faculty role is taken away loses the teacher's view of the cohort at once", async () => {
    await server.createUser("assistant@example.edu", STRONG_PASSWORD, "faculty");
    const assistant = await login("assistant@example.edu");
    assert.equal((await assistant.post("/api/cohorts/join", { code: id.codeA })).json.cohort.role, "faculty", "another teacher joins with the code");
    assert.equal((await assistant.get(`/api/cohorts/${id.cohortA}`)).json.learners.length, 1);
    assert.equal((await admin.request("PATCH", `/api/admin/users/${userId("assistant@example.edu")}/role`, { role: "student" })).status, 200);

    const before = snapshot();
    const view = await assistant.get(`/api/cohorts/${id.cohortA}`);
    assert.equal(view.status, 404);
    assert.doesNotMatch(view.text, /learner@example\.edu/);
    assert.equal((await assistant.get("/api/cohorts")).json.cohorts[0].joinCode, undefined);
    assert.equal((await assistant.request("DELETE", `/api/cohorts/${id.cohortA}/members/${id.learner}`)).status, 403);
    assert.equal((await assistant.post(`/api/cohorts/${id.cohortA}/code`)).status, 403);
    assert.equal((await assistant.get(`/api/reviews/submission/${id.submission}`)).status, 403);
    assert.equal(snapshot(), before);
    assert.equal((await assistant.request("DELETE", `/api/cohorts/${id.cohortA}/members/${userId("assistant@example.edu")}`)).status, 204, "they can still leave");
  });

  it("the cohort's own teacher and administrators can manage it (positive control)", async () => {
    assert.equal((await teacher.post(`/api/cohorts/${id.cohortA}/code`)).status, 200);
    assert.equal((await admin.post(`/api/cohorts/${id.cohortB}/code`)).status, 200);
    const extra = await teacher.post(`/api/cohorts/${id.cohortA}/assignments`, { kind: "lesson", itemId: "git-branches-and-merging", dueAt: DUE });
    assert.equal(extra.status, 201);
    assert.equal((await teacher.request("DELETE", `/api/cohorts/${id.cohortA}/assignments/${extra.json.assignment.id}`)).status, 204);
    assert.equal(server.db.prepare("SELECT 1 FROM assignments WHERE id = ?").get(extra.json.assignment.id), undefined);
    id.codeA = (server.db.prepare("SELECT join_code FROM cohorts WHERE id = ?").get(id.cohortA) as { join_code: string }).join_code;
  });
});

describe("authorization review: reviews", () => {
  it("another teacher cannot read or review work of a learner they do not teach", async () => {
    const before = snapshot();
    for (const [type, target] of [["submission", id.submission], ["decision", id.decision]] as const) {
      const read = await otherTeacher.get(`/api/reviews/${type}/${target}`);
      assert.equal(read.status, 403, `GET ${type}`);
      assert.doesNotMatch(read.text, /learner-private-notes|learner-decision/);
      const write = await otherTeacher.post(`/api/reviews/${type}/${target}`, { scores: {}, feedback: "Not my learner", outcome: "accepted" });
      assert.equal(write.status, 403, `POST ${type}`);
    }
    assert.ok(!(await otherTeacher.get("/api/reviews")).json.items.some((i: { id: string }) => i.id === id.submission || i.id === id.decision));
    assert.equal(snapshot(), before);
  });

  it("a decision record is reviewable only under its canonical id, so reviews always reach the learner", async () => {
    const before = snapshot();
    for (const alias of [`0${id.decision}`, `0x${Number(id.decision).toString(16)}`]) {
      const res = await teacher.post(`/api/reviews/decision/${alias}`, { scores: {}, feedback: "Alias", outcome: "accepted" });
      assert.equal(res.status, 404, alias);
      assert.equal((await teacher.get(`/api/reviews/decision/${alias}`)).status, 404, alias);
    }
    assert.equal(snapshot(), before);
    assert.equal((await teacher.get(`/api/reviews/decision/${id.decision}`)).status, 200, "the canonical id works");
  });

  it("administrators cannot review their own work", async () => {
    const sub = await admin.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://git.example.edu/admin/p" });
    const rubric = testContent().getProject(PROJECT)?.rubric ?? [];
    const res = await admin.post(`/api/reviews/submission/${sub.json.submission.id}`, { scores: Object.fromEntries(rubric.map((r) => [r.criterion, "excellent"])), feedback: "Great", outcome: "accepted" });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "own_work");
    assert.equal(server.db.prepare("SELECT 1 FROM reviews WHERE target_id = ?").get(sub.json.submission.id), undefined);
    server.db.prepare("DELETE FROM submissions WHERE id = ?").run(sub.json.submission.id);
  });

  it("leaving the cohort ends the teacher's access to the learner's work", async () => {
    assert.equal((await teacher.get(`/api/reviews/submission/${id.submission}`)).status, 200);
    assert.equal((await learner.request("DELETE", `/api/cohorts/${id.cohortA}/members/${id.learner}`)).status, 204);
    assert.equal((await teacher.get(`/api/reviews/submission/${id.submission}`)).status, 403);
    assert.ok(!(await teacher.get("/api/reviews")).json.items.some((i: { id: string }) => i.id === id.submission));
    assert.equal((await learner.post("/api/cohorts/join", { code: id.codeA })).status, 200);
  });
});

describe("authorization review: content editor submissions", () => {
  it("faculty see only their own content-editor pull requests; administrators see all", async () => {
    const mine = await teacher.get("/api/cms/submissions");
    assert.deepEqual([mine.json.scope, mine.json.submissions.length], ["mine", 1]);
    const other = await otherTeacher.get("/api/cms/submissions");
    assert.deepEqual([other.json.scope, other.json.submissions.length], ["mine", 0]);
    assert.doesNotMatch(other.text, /Teacher edit/);
    const all = await admin.get("/api/cms/submissions");
    assert.deepEqual([all.json.scope, all.json.submissions.length], ["all", 1]);
  });
});

describe("authorization review: data export and account deletion", () => {
  it("export contains only the signed-in account's data", async () => {
    const res = await outsider.get("/api/me/export");
    assert.equal(res.status, 200);
    assert.equal(res.json.account.id, id.outsider);
    assert.doesNotMatch(res.text, new RegExp(`learner@example\\.edu|${id.learner}|learner-private-notes|learner-decision|${id.certificate}`));
    assert.deepEqual(res.json.submissions, []);
    assert.deepEqual(res.json.certificates, []);
  });

  it("account deletion deletes only the signed-in account, even if another user's id is sent", async () => {
    await server.createUser("leaver@example.edu", STRONG_PASSWORD);
    const leaver = await login("leaver@example.edu");
    const leaverId = userId("leaver@example.edu");
    const learnerData = () =>
      JSON.stringify([
        server.db.prepare("SELECT id, email, role, disabled_at FROM users WHERE id = ?").get(id.learner),
        server.db.prepare("SELECT * FROM submissions WHERE user_id = ?").all(id.learner),
        server.db.prepare("SELECT * FROM certificates WHERE user_id = ?").all(id.learner),
        server.db.prepare("SELECT * FROM cohort_members WHERE user_id = ?").all(id.learner),
      ]);
    const before = learnerData();
    const res = await leaver.post("/api/me/delete", { password: STRONG_PASSWORD, confirm: "delete my account", userId: id.learner, id: id.learner });
    assert.equal(res.status, 204);
    assert.equal(server.db.prepare("SELECT 1 FROM users WHERE id = ?").get(leaverId), undefined);
    assert.equal(learnerData(), before);
    assert.equal((await learner.get("/api/me/portfolio")).status, 200, "the learner's session still works");
  });
});
