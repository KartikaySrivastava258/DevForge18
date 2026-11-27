/**
 * Institutional features (REMAINING_WORK.md §6.3): cohorts, assignments, submissions, rubric reviews,
 * portfolios and certificates — including who may see what.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, STRONG_PASSWORD, startTestServer, testContent, type TestServer } from "./helpers.ts";

let server: TestServer;
let teacher: Client;
let otherTeacher: Client;
let learner: Client;
let outsider: Client;
let admin: Client;
let anonymous: Client;
const ids: Record<string, string> = {};

const PROJECT = "git-portfolio-repository";
const ARCH = "batch-data-platform";

async function login(email: string): Promise<Client> {
  const c = new Client(server.url);
  const r = await c.post("/api/auth/login", { email, password: STRONG_PASSWORD });
  assert.equal(r.status, 200);
  return c;
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
  for (const [k, e] of [["learner", "learner@example.edu"], ["outsider", "outsider@example.edu"], ["teacher", "teacher@example.edu"]] as const) {
    ids[k] = (server.db.prepare("SELECT id FROM users WHERE email = ?").get(e) as { id: string }).id;
  }
});
after(() => server.close());

describe("cohorts", () => {
  it("only faculty and admins create cohorts; the creator teaches it and gets a join code", async () => {
    assert.equal((await anonymous.post("/api/cohorts", { name: "DevOps 2026" })).status, 401);
    assert.equal((await learner.post("/api/cohorts", { name: "DevOps 2026" })).status, 403);
    const r = await teacher.post("/api/cohorts", { name: "DevOps 2026", description: "Semester 5, section B" });
    assert.equal(r.status, 201);
    assert.equal(r.json.cohort.role, "faculty");
    assert.match(r.json.cohort.joinCode, /^[A-HJ-NP-Z2-9]{10}$/);
    ids.cohort = r.json.cohort.id;
    ids.code = r.json.cohort.joinCode;
  });

  it("learners join with the code (case-insensitive), and a wrong code is a clear 404", async () => {
    const bad = await learner.post("/api/cohorts/join", { code: "AAAAAAAAAA" });
    assert.equal(bad.status, 404);
    assert.equal(bad.json.error.code, "unknown_code");
    const r = await learner.post("/api/cohorts/join", { code: ids.code?.toLowerCase() });
    assert.equal(r.status, 200);
    assert.equal(r.json.cohort.role, "learner");
    const again = await learner.post("/api/cohorts/join", { code: ids.code });
    assert.equal(again.json.cohort.role, "learner");
    const mine = await learner.get("/api/cohorts");
    assert.equal(mine.json.cohorts.length, 1);
    assert.equal(mine.json.cohorts[0].joinCode, undefined, "learners never see the join code");
  });

  it("non-members get 404; learners see assignments but not other members; faculty see members and progress", async () => {
    assert.equal((await outsider.get(`/api/cohorts/${ids.cohort}`)).status, 404);
    assert.equal((await otherTeacher.get(`/api/cohorts/${ids.cohort}`)).status, 404);
    const asLearner = await learner.get(`/api/cohorts/${ids.cohort}`);
    assert.equal(asLearner.status, 200);
    assert.equal(asLearner.json.learners, undefined);
    assert.equal(asLearner.json.cohort.joinCode, undefined);
    const asTeacher = await teacher.get(`/api/cohorts/${ids.cohort}`);
    assert.equal(asTeacher.json.learners.length, 1);
    assert.equal(asTeacher.json.learners[0].email, "learner@example.edu");
    assert.equal((await admin.get(`/api/cohorts/${ids.cohort}`)).status, 200, "administrators can open any cohort");
  });

  it("a new join code invalidates the old one", async () => {
    assert.equal((await learner.post(`/api/cohorts/${ids.cohort}/code`)).status, 403);
    const r = await teacher.post(`/api/cohorts/${ids.cohort}/code`);
    assert.equal(r.status, 200);
    assert.notEqual(r.json.joinCode, ids.code);
    assert.equal((await outsider.post("/api/cohorts/join", { code: ids.code })).status, 404);
    ids.code = r.json.joinCode;
  });

  it("the last teacher cannot leave; a learner can leave and rejoin", async () => {
    const r = await teacher.request("DELETE", `/api/cohorts/${ids.cohort}/members/${ids.teacher}`);
    assert.equal(r.status, 409);
    assert.equal((await outsider.post("/api/cohorts/join", { code: ids.code })).status, 200);
    assert.equal((await outsider.request("DELETE", `/api/cohorts/${ids.cohort}/members/${ids.learner}`)).status, 403, "learners cannot remove others");
    assert.equal((await outsider.request("DELETE", `/api/cohorts/${ids.cohort}/members/${ids.outsider}`)).status, 204);
    assert.equal((await outsider.get(`/api/cohorts/${ids.cohort}`)).status, 404);
  });
});

describe("assignments", () => {
  it("faculty assign existing items with a due date; unknown items and duplicates are rejected", async () => {
    const assignable = await teacher.get("/api/assignable");
    const kinds = new Set(assignable.json.items.map((i: { kind: string }) => i.kind));
    assert.deepEqual([...kinds].sort(), ["architecture", "capstone", "lab", "lesson", "project", "quiz"]);
    assert.equal((await learner.get("/api/assignable")).status, 403);

    const due = "2026-12-15T18:00:00+05:30";
    const make = (kind: string, itemId: string) => teacher.post(`/api/cohorts/${ids.cohort}/assignments`, { kind, itemId, dueAt: due, instructions: "Read it before the lab session." });
    const lesson = await make("lesson", "git-first-commits");
    assert.equal(lesson.status, 201);
    assert.equal(lesson.json.assignment.dueAt, "2026-12-15T12:30:00.000Z", "due dates are stored in UTC");
    assert.equal(lesson.json.assignment.item.href, "/tracks/git-github/lessons/git-first-commits");
    for (const [kind, id] of [["quiz", "git-github"], ["project", PROJECT], ["architecture", ARCH], ["capstone", "capstone-a"]]) {
      assert.equal((await make(kind as string, id as string)).status, 201, `${kind} ${id}`);
    }
    assert.equal((await make("lesson", "no-such-lesson")).status, 400);
    assert.equal((await make("lesson", "git-first-commits")).status, 409);
    assert.equal((await learner.post(`/api/cohorts/${ids.cohort}/assignments`, { kind: "lesson", itemId: "git-first-commits", dueAt: due })).status, 403);
  });

  it("a learner's status comes from their own progress records", async () => {
    const before = await learner.get("/api/me/assignments");
    assert.equal(before.json.assignments.length, 5);
    assert.ok(before.json.assignments.every((a: { status: { state: string } }) => a.status.state === "not_started"));

    server.db.prepare("INSERT INTO lesson_progress (user_id, lesson_id, track_slug, status, attempts, best_score, started_at, completed_at, updated_at) VALUES (?, 'git-first-commits', 'git-github', 'completed', 1, 1, ?, ?, ?)")
      .run(String(ids.learner), "2026-11-01T00:00:00.000Z", "2026-12-20T00:00:00.000Z", "2026-12-20T00:00:00.000Z");
    server.db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, 'git-github-quiz', 'git-github', 0.4, 0, ?)").run(String(ids.learner), "2026-12-01T00:00:00.000Z");
    const after = await learner.get("/api/me/assignments");
    const byKind = Object.fromEntries(after.json.assignments.map((a: { kind: string; status: unknown }) => [a.kind, a.status]));
    assert.deepEqual(byKind.lesson, { state: "done", completedAt: "2026-12-20T00:00:00.000Z", detail: null, late: true });
    assert.equal(byKind.quiz.state, "in_progress");

    const cohort = await teacher.get(`/api/cohorts/${ids.cohort}`);
    assert.equal(cohort.json.learners[0].lessonsCompleted, 1);
    assert.equal(cohort.json.learners[0].assignments.filter((s: { state: string }) => s.state === "done").length, 1);
  });
});

describe("submissions and reviews", () => {
  it("learners submit an https link to their work; other schemes and unknown items are rejected", async () => {
    assert.equal((await learner.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await learner.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "http://example.com/repo" })).status, 400);
    assert.equal((await learner.request("PUT", "/api/me/submissions/project/no-such-project", { repositoryUrl: "https://example.com/r" })).status, 404);
    const r = await learner.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://git.example.edu/learner/portfolio", notes: "Tags v1.0.0" });
    assert.equal(r.status, 200);
    assert.equal(r.json.submission.status, "submitted");
    ids.submission = r.json.submission.id;
  });

  it("faculty who teach the learner see the work in their queue; other faculty are refused", async () => {
    const q = await teacher.get("/api/reviews");
    assert.equal(q.status, 200);
    assert.ok(q.json.items.some((i: { id: string; reviewed: boolean }) => i.id === ids.submission && !i.reviewed));
    assert.equal((await otherTeacher.get("/api/reviews")).json.items.length, 0);
    assert.equal((await otherTeacher.get(`/api/reviews/submission/${ids.submission}`)).status, 403);
    assert.equal((await learner.get("/api/reviews")).status, 403);
  });

  it("a review must score every rubric criterion; it updates the submission and the learner sees it", async () => {
    const t = await teacher.get(`/api/reviews/submission/${ids.submission}`);
    const rubric = t.json.rubric as { criterion: string }[];
    assert.equal(rubric.length, testContent().getProject(PROJECT)?.rubric.length);
    const partial = Object.fromEntries(rubric.slice(1).map((r) => [r.criterion, "good"]));
    const missing = await teacher.post(`/api/reviews/submission/${ids.submission}`, { scores: partial, feedback: "Nice", outcome: "accepted" });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, "rubric_mismatch");
    const scores = Object.fromEntries(rubric.map((r, i) => [r.criterion, i === 0 ? "needs_work" : "good"]));
    const r = await teacher.post(`/api/reviews/submission/${ids.submission}`, { scores, feedback: "Remove the .env file from history.", outcome: "changes_requested" });
    assert.equal(r.status, 201);
    const mine = await learner.get(`/api/me/submissions/project/${PROJECT}`);
    assert.equal(mine.json.submission.status, "changes_requested");
    assert.equal(mine.json.submission.review.feedback, "Remove the .env file from history.");
    assert.equal(mine.json.submission.review.reviewer, "teacher");

    const resubmitted = await learner.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://git.example.edu/learner/portfolio", notes: "History rewritten" });
    assert.equal(resubmitted.json.submission.status, "submitted");
    assert.equal(resubmitted.json.submission.review, null, "an older review is not shown as the review of the new submission");
    const accept = await teacher.post(`/api/reviews/submission/${ids.submission}`, { scores: Object.fromEntries(rubric.map((x) => [x.criterion, "excellent"])), feedback: "Clean history now.", outcome: "accepted" });
    assert.equal(accept.status, 201);
  });

  it("submitted architecture decision records are reviewed against the ADR rubric", async () => {
    const saved = await learner.request("PUT", `/api/me/decisions/${ARCH}`, { title: "Use a batch platform for marks", context: "Nightly marks import", decision: "Airflow + PostgreSQL", consequences: "Another service to run", status: "submitted" });
    assert.equal(saved.status, 200);
    const q = await teacher.get("/api/reviews");
    const item = q.json.items.find((i: { type: string }) => i.type === "decision");
    assert.ok(item);
    const t = await teacher.get(`/api/reviews/decision/${item.id}`);
    assert.equal(t.json.target.work.decision, "Airflow + PostgreSQL");
    const scores = Object.fromEntries(t.json.rubric.map((r: { criterion: string }) => [r.criterion, "good"]));
    assert.equal((await teacher.post(`/api/reviews/decision/${item.id}`, { scores, feedback: "Name an alternative you rejected.", outcome: "changes_requested" })).status, 201);
    const mine = await learner.get(`/api/me/decisions/${ARCH}/review`);
    assert.equal(mine.json.review.outcome, "changes_requested");
    assert.equal(mine.json.review.current, true);
    const status = (await learner.get("/api/me/assignments")).json.assignments.find((a: { kind: string }) => a.kind === "architecture").status;
    assert.equal(status.detail, "changes requested");
  });
});

describe("portfolio", () => {
  it("is private until the learner publishes it, and never shows the e-mail address", async () => {
    assert.equal((await anonymous.get("/api/portfolio/learner-portfolio")).status, 404);
    assert.equal((await learner.request("PUT", "/api/me/portfolio", { isPublic: false, slug: "learner-portfolio", headline: "DevOps learner" })).status, 200);
    assert.equal((await anonymous.get("/api/portfolio/learner-portfolio")).status, 404, "saved but private");
    assert.equal((await outsider.request("PUT", "/api/me/portfolio", { isPublic: true, slug: "learner-portfolio" })).status, 409, "slugs are unique");
    assert.equal((await learner.request("PUT", "/api/me/portfolio", { isPublic: true, slug: "Bad Slug!" })).status, 400);
    assert.equal((await learner.request("PUT", "/api/me/portfolio", { isPublic: true, slug: "learner-portfolio", headline: "DevOps learner" })).status, 200);
    const p = await anonymous.get("/api/portfolio/learner-portfolio");
    assert.equal(p.status, 200);
    assert.equal(p.json.portfolio.name, "learner");
    assert.equal(p.json.portfolio.work.length, 1, "only accepted work is shown");
    assert.equal(p.json.portfolio.work[0].item.title, testContent().getProject(PROJECT)?.title);
    assert.doesNotMatch(p.text, /@example\.edu/);
  });
});

describe("certificates", () => {
  const TRACK = "kubernetes";
  it("are refused until the quiz is passed and every server-verifiable lab is verified", async () => {
    const before = (await learner.get("/api/me/certificates")).json.tracks.find((t: { track: string }) => t.track === TRACK);
    assert.equal(before.eligible, false);
    assert.equal(before.labs.length, 2, "Kubernetes has a read-through and a simulation lab, both server-verified");
    assert.equal((await learner.post(`/api/me/certificates/${TRACK}`)).status, 409);

    server.db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, 'kubernetes-quiz', ?, 0.9, 1, ?)").run(String(ids.learner), TRACK, new Date().toISOString());
    for (const lab of before.labs) {
      server.db.prepare("INSERT INTO lab_progress (user_id, lab_id, track_slug, evidence, completed_at) VALUES (?, ?, ?, 'self-reported', ?)").run(String(ids.learner), lab.id, TRACK, new Date().toISOString());
    }
    assert.equal((await learner.post(`/api/me/certificates/${TRACK}`)).status, 409, "self-reported completion never counts");
    server.db.prepare("UPDATE lab_progress SET evidence = 'verified' WHERE user_id = ? AND track_slug = ?").run(String(ids.learner), TRACK);
    const issued = await learner.post(`/api/me/certificates/${TRACK}`);
    assert.equal(issued.status, 201);
    assert.match(issued.json.certificate.id, /^[0-9a-f]{32}$/);
    ids.certificate = issued.json.certificate.id;
    assert.equal((await learner.post(`/api/me/certificates/${TRACK}`)).json.certificate.id, ids.certificate, "issuing twice returns the same certificate");
  });

  it("a track without server-verifiable labs (Git) uses its simulation challenges", async () => {
    const git = (await learner.get("/api/me/certificates")).json.tracks.find((t: { track: string }) => t.track === "git-github");
    const sims = testContent().simulationsFor("git-github");
    assert.equal(git.labs.length, sims.reduce((n, s) => n + s.challenges.length, 0));
    assert.ok(git.labs.every((l: { id: string }) => l.id.includes("/")));
  });

  it("anyone can verify a certificate by its id; only admins revoke it", async () => {
    const v = await anonymous.get(`/api/certificates/${ids.certificate}`);
    assert.equal(v.status, 200);
    assert.equal(v.json.certificate.holder, "learner");
    assert.equal(v.json.certificate.revokedAt, null);
    assert.equal(v.json.certificate.criteria.quizBestScore, 0.9);
    assert.doesNotMatch(v.text, /@example\.edu/);
    assert.equal((await anonymous.get("/api/certificates/0123456789abcdef0123456789abcdef")).status, 404);
    assert.equal((await teacher.post(`/api/certificates/${ids.certificate}/revoke`)).status, 403);
    assert.equal((await admin.post(`/api/certificates/${ids.certificate}/revoke`)).status, 204);
    assert.notEqual((await anonymous.get(`/api/certificates/${ids.certificate}`)).json.certificate.revokedAt, null);
    const audit = server.db.prepare("SELECT action FROM audit_events WHERE action LIKE 'certificate.%' ORDER BY created_at").all() as { action: string }[];
    assert.deepEqual(audit.map((a) => a.action), ["certificate.issued", "certificate.revoked"]);
  });
});

describe("privacy controls", () => {
  it("export returns the learner's own data as a download, and nobody else's", async () => {
    const r = await learner.get("/api/me/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="devforge-my-data.json"/);
    assert.equal(r.json.account.email, "learner@example.edu");
    assert.equal(r.json.submissions.length, 1);
    assert.ok(r.json.reviewsReceived.length >= 2, "reviews of the learner's work are part of their data");
    assert.equal(r.json.cohorts[0].name, "DevOps 2026");
    assert.doesNotMatch(r.text, /teacher@example\.edu|password_hash|scrypt/);
    assert.equal((await anonymous.get("/api/me/export")).status, 401);
  });

  it("deleting an account needs the password and the confirmation phrase, then removes everything", async () => {
    await server.createUser("leaver@example.edu", STRONG_PASSWORD);
    const leaver = await login("leaver@example.edu");
    const id = (server.db.prepare("SELECT id FROM users WHERE email = 'leaver@example.edu'").get() as { id: string }).id;
    assert.equal((await leaver.post("/api/cohorts/join", { code: ids.code })).status, 200);
    const sub = await leaver.request("PUT", `/api/me/submissions/project/${PROJECT}`, { repositoryUrl: "https://git.example.edu/leaver/p" });
    const rubric = (await teacher.get(`/api/reviews/submission/${sub.json.submission.id}`)).json.rubric as { criterion: string }[];
    await teacher.post(`/api/reviews/submission/${sub.json.submission.id}`, { scores: Object.fromEntries(rubric.map((x) => [x.criterion, "good"])), feedback: "ok", outcome: "accepted" });

    assert.equal((await leaver.post("/api/me/delete", { password: STRONG_PASSWORD, confirm: "yes" })).status, 400);
    assert.equal((await leaver.post("/api/me/delete", { password: "wrong password here", confirm: "delete my account" })).status, 403);
    const r = await leaver.post("/api/me/delete", { password: STRONG_PASSWORD, confirm: "delete my account" });
    assert.equal(r.status, 204);
    assert.equal(leaver.cookie, "", "the session cookie is cleared");
    for (const table of ["users", "sessions", "cohort_members", "submissions"]) {
      const col = table === "users" ? "id" : "user_id";
      assert.equal((server.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id) as { n: number }).n, 0, table);
    }
    assert.equal((server.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE target_id = ?").get(String(sub.json.submission.id)) as { n: number }).n, 0, "reviews of deleted work are removed");
    const again = new Client(server.url);
    assert.equal((await again.post("/api/auth/login", { email: "leaver@example.edu", password: STRONG_PASSWORD })).status, 401);
  });

  it("the last administrator cannot delete their own account", async () => {
    const r = await admin.post("/api/me/delete", { password: STRONG_PASSWORD, confirm: "delete my account" });
    assert.equal(r.status, 409);
  });
});
