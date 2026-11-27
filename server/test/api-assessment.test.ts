import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { QuizQuestion } from "../../shared/content-schema.ts";
import { Client, STRONG_PASSWORD, startTestServer, testContent, type TestServer } from "./helpers.ts";

const TRACK = "git-github";

let server: TestServer;
let student: Client;
let faculty: Client;
let anonymous: Client;
before(async () => {
  server = await startTestServer();
  await server.createUser("quiz@example.edu", STRONG_PASSWORD);
  await server.createUser("marker@example.edu", STRONG_PASSWORD, "faculty");
  student = new Client(server.url);
  faculty = new Client(server.url);
  anonymous = new Client(server.url);
  await student.post("/api/auth/login", { email: "quiz@example.edu", password: STRONG_PASSWORD });
  await faculty.post("/api/auth/login", { email: "marker@example.edu", password: STRONG_PASSWORD });
});
after(() => server.close());

/** The correct answer for any question type, read from the server-side content. */
function correctAnswer(q: QuizQuestion): string | string[] | Record<string, string> {
  switch (q.type) {
    case "single":
    case "output":
      return q.answer;
    case "multiple":
      return q.answers;
    case "ordering":
      return q.order;
    case "matching":
      return q.pairs;
    case "diagram":
      return q.answers;
  }
}

function allCorrect(): Record<string, string | string[] | Record<string, string>> {
  const quiz = testContent().getQuiz(TRACK);
  assert.ok(quiz);
  return Object.fromEntries(quiz.questions.map((q) => [q.id, correctAnswer(q)]));
}

describe("track quiz API", () => {
  it("serves every question type without answers or explanations", async () => {
    const res = await anonymous.get(`/api/tracks/${TRACK}/quiz`);
    assert.equal(res.status, 200);
    const types = new Set(res.json.quiz.questions.map((q: { type: string }) => q.type));
    for (const t of ["single", "multiple", "ordering", "matching", "output", "diagram"]) assert.ok(types.has(t), t);
    assert.ok(!/"answers?"|"order"|"pairs"|"explanation"/.test(res.text), "no answer keys in the public quiz");
  });

  it("never sends items to order in their correct order, and includes the figure for diagram questions", async () => {
    const res = await anonymous.get(`/api/tracks/${TRACK}/quiz`);
    const quiz = testContent().getQuiz(TRACK);
    for (const q of quiz?.questions ?? []) {
      const served = res.json.quiz.questions.find((x: { id: string }) => x.id === q.id);
      if (q.type === "ordering") assert.notDeepEqual(served.items.map((i: { id: string }) => i.id), q.order, q.id);
      if (q.type === "diagram") assert.match(served.figureHtml, /<svg/);
    }
  });

  it("refuses to grade an incomplete attempt", async () => {
    const res = await anonymous.post(`/api/tracks/${TRACK}/quiz/grade`, { answers: { snapshot: "b" } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "validation_failed");
  });

  it("grades every type, explains correct answers and points wrong ones to a lesson", async () => {
    const answers = allCorrect();
    const right = await anonymous.post(`/api/tracks/${TRACK}/quiz/grade`, { answers });
    assert.equal(right.status, 200);
    assert.equal(right.json.score, 1);
    assert.equal(right.json.passed, true);
    assert.equal(right.json.saved, false);
    assert.ok(right.json.results.every((r: { explanation?: string }) => r.explanation));

    const wrong = await anonymous.post(`/api/tracks/${TRACK}/quiz/grade`, {
      answers: { ...answers, "share-order": ["push", "edit", "add", "commit"], "undo-match": { restore: "push", unstage: "unstaged", revert: "new-commit", "reset-hard": "move-back" } },
    });
    const order = wrong.json.results.find((r: { id: string }) => r.id === "share-order");
    assert.equal(order.correct, false);
    assert.equal(order.explanation, undefined, "no explanation (which would give the answer away) for a wrong answer");
    assert.equal(order.review.id, "git-remotes-push-pull");
    assert.equal(wrong.json.results.find((r: { id: string }) => r.id === "undo-match").correct, false);
  });

  it("passes or fails against the pass mark, and saves attempts for signed-in learners", async () => {
    const answers = allCorrect();
    const quiz = testContent().getQuiz(TRACK);
    // Get just enough wrong to fall below the pass mark.
    const wrongCount = Math.floor((quiz?.questions.length ?? 0) * (1 - (quiz?.pass_mark ?? 1))) + 1;
    const ids = Object.keys(answers).filter((id) => typeof answers[id] === "string").slice(0, wrongCount);
    const failing = { ...answers, ...Object.fromEntries(ids.map((id) => [id, "z"])) };
    const failed = await student.post(`/api/tracks/${TRACK}/quiz/grade`, { answers: failing });
    assert.equal(failed.json.passed, false);
    assert.equal(failed.json.saved, true);
    await student.post(`/api/tracks/${TRACK}/quiz/grade`, { answers });
    const mine = await student.get("/api/me/quizzes");
    assert.deepEqual(
      mine.json.quizzes.map((q: { track: string; attempts: number; passed: boolean; bestScore: number }) => [q.track, q.attempts, q.passed, q.bestScore]),
      [[TRACK, 2, true, 1]],
    );
  });

  it("lists the quiz on the track", async () => {
    const res = await anonymous.get(`/api/tracks/${TRACK}`);
    assert.equal(res.json.quiz.id, "git-github-quiz");
    assert.equal(res.json.quiz.questionCount, 12);
  });

  it("answers 404 for a track without a quiz yet and requires sign-in for personal results", async () => {
    const withoutQuiz = testContent().listTracks().find((t) => !testContent().getQuiz(t.slug));
    if (withoutQuiz) assert.equal((await anonymous.get(`/api/tracks/${withoutQuiz.slug}/quiz`)).status, 404);
    assert.equal((await anonymous.get("/api/me/quizzes")).status, 401);
  });
});

describe("mini-project API", () => {
  const PROJECT = "git-team-task-tracker";

  it("lists a track's published projects in level order, matching the track's plan", async () => {
    const res = await anonymous.get(`/api/tracks/${TRACK}/projects`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.json.projects.map((p: { id: string; level: string }) => [p.id, p.level]),
      [
        ["git-portfolio-repository", "beginner"],
        ["git-team-task-tracker", "intermediate"],
        ["git-release-workflow", "advanced"],
      ],
    );
    const track = await anonymous.get(`/api/tracks/${TRACK}`);
    const planned = track.json.track.projects.filter((p: { project?: string }) => p.project).map((p: { project: string }) => p.project);
    assert.deepEqual(planned, ["git-portfolio-repository", "git-team-task-tracker", "git-release-workflow"]);
  });

  it("serves the brief, criteria, rubric, starter files and check script, but never the solution", async () => {
    const res = await anonymous.get(`/api/projects/${PROJECT}`);
    assert.equal(res.status, 200);
    const p = res.json.project;
    assert.ok(p.acceptanceCriteria.length >= 3 && p.rubric.length >= 3 && p.hints.length >= 2);
    assert.ok(p.starterFiles.some((f: { path: string }) => f.path === "tasks.py"));
    assert.match(p.checkScript, /^#!\/usr\/bin\/env bash/);
    assert.match(p.html, /<h2 id="brief">/);
    assert.ok(!("solutionFiles" in p) && !res.text.includes("feature/list-open"), "nothing from the reference solution");
  });

  it("serves the reference solution to faculty only", async () => {
    assert.equal((await anonymous.get(`/api/projects/${PROJECT}/solution`)).status, 401);
    assert.equal((await student.get(`/api/projects/${PROJECT}/solution`)).status, 403);
    const res = await faculty.get(`/api/projects/${PROJECT}/solution`);
    assert.equal(res.status, 200);
    const paths = res.json.solution.files.map((f: { path: string }) => f.path);
    assert.ok(paths.includes("prepare.sh") && paths.includes(".github/CODEOWNERS"), paths.join(", "));
  });

  it("answers 404 for an unknown project, and checks the role before saying whether a solution exists", async () => {
    assert.equal((await anonymous.get("/api/projects/no-such-project")).status, 404);
    assert.equal((await anonymous.get("/api/projects/no-such-project/solution")).status, 401);
    assert.equal((await faculty.get("/api/projects/no-such-project/solution")).status, 404);
  });
});

describe("capstone API", () => {
  it("lists capstones and serves one with resolved milestone links and its architecture figure", async () => {
    const list = await anonymous.get("/api/capstones");
    assert.equal(list.status, 200);
    assert.ok(list.json.capstones.some((c: { id: string; letter: string }) => c.id === "capstone-b" && c.letter === "B"));
    const res = await anonymous.get("/api/capstones/capstone-b");
    assert.equal(res.status, 200);
    const c = res.json.capstone;
    assert.match(c.architectureHtml, /<svg/);
    assert.ok(c.milestones.length >= 3);
    const reuses = c.milestones.flatMap((m: { reuses: { kind: string; id: string; title: string }[] }) => m.reuses);
    assert.ok(reuses.length > 0 && reuses.every((r: { title: string }) => r.title), "every reuse resolves to a title");
    assert.deepEqual(c.paths, ["backend-foundations"]);
  });

  it("links the capstone from its learning path and answers 404 for an unknown one", async () => {
    const path = await anonymous.get("/api/paths/backend-foundations");
    assert.equal(path.json.capstone.id, "capstone-b");
    assert.equal((await anonymous.get("/api/capstones/capstone-z")).status, 404);
  });
});
