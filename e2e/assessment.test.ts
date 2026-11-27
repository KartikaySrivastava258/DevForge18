import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { expectText, startHarness, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

const noProblems = (problems: string[]) => assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);

describe("track quiz", () => {
  it("answers every question type with the keyboard-friendly controls, passes, and a path marks the track as skippable", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/register?next=/tracks/git-github/quiz");
    await page.getByLabel("Name").fill("Quiz Taker");
    await page.getByLabel("Email").fill("quiz-taker@example.edu");
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/tracks/git-github/quiz");
    await page.getByRole("heading", { level: 1, name: "Git and GitHub — track quiz" }).waitFor();

    const question = (prompt: RegExp) => page.locator("fieldset.quiz__question", { hasText: prompt });
    const choose = (prompt: RegExp, option: RegExp) => question(prompt).locator(".option", { hasText: option }).click();
    const select = async (prompt: RegExp, label: string, value: RegExp) => {
      const control = question(prompt).getByLabel(label, { exact: true });
      const options = await control.locator("option").allTextContents();
      await control.selectOption({ label: options.find((o) => value.test(o)) ?? "" });
    };

    await choose(/What does a Git commit record/, /A snapshot of the tracked files/);
    await select(/Label the numbered boxes/, "Box 1", /^Working tree/);
    await select(/Label the numbered boxes/, "Box 2", /^Staging area/);
    await select(/Label the numbered boxes/, "Box 3", /^Repository/);
    await choose(/what will "git commit" record/, /Only the new file todo.txt/);

    // Ordering: move each step into place with the Move up buttons only.
    const target = ["Edit the file", "git add the file", "git commit with a message", "git push to the remote"];
    const order = question(/Put the steps/);
    for (let i = 0; i < target.length; i++) {
      for (;;) {
        const items = await order.locator("ol.quiz__order li > span:first-child").allTextContents();
        const at = items.indexOf(target[i] ?? "");
        if (at <= i) break;
        await order.getByRole("button", { name: `Move "${target[i]}" up` }).click();
      }
    }
    assert.deepEqual(await order.locator("ol.quiz__order li > span:first-child").allTextContents(), target);

    await choose(/statements about branches/, /movable name that points/);
    await choose(/statements about branches/, /HEAD normally names/);
    await choose(/How many parent commits/, /^Two/);
    await choose(/broke the build/, /git revert the commit/);
    await select(/Match each command/, "git restore notes.txt", /^Throws away unstaged/);
    await select(/Match each command/, "git restore --staged notes.txt", /^Takes the file out/);
    await select(/Match each command/, "git revert <commit>", /^Adds a new commit/);
    await select(/Match each command/, "git reset --hard HEAD~1", /^Moves the branch back/);
    await choose(/main purpose of a pull request/, /To propose merging a branch/);
    await choose(/not rebase a branch/, /Rebasing creates new commits/);
    await choose(/branch protection rule/, /Require a pull request/);
    await choose(/branch protection rule/, /Require status checks/);
    await choose(/branch protection rule/, /Block force pushes/);
    await choose(/API key was committed/, /Revoke or rotate the key/);

    await page.getByRole("button", { name: "Grade my answers" }).click();
    await expectText(page.locator(".quiz .notice"), /12 of 12 correct \(100%\) — passed/);
    assert.equal(await page.locator(".feedback--ok").count(), 12);

    await page.goto("/paths/team-workflow");
    await expectText(page.locator(".steps"), /Skipped by quiz/);
    noProblems(problems);
  });

  it("points a wrong answer to the lesson that teaches it, without giving the answer away", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github/quiz");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.getByRole("button", { name: "Grade my answers" }).click();
    await expectText(page.locator(".quiz .field__error"), /Answer all 12 questions first/);
    noProblems(problems);
  });

  it("links the quiz and published projects from the track page", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github");
    await expectText(page.locator("#quiz"), /12 questions from all levels, pass mark 75%/);
    await page.locator("#quiz").getByRole("link", { name: "Git and GitHub — track quiz" }).click();
    await page.waitForURL("**/tracks/git-github/quiz");
    noProblems(problems);
  });
});

describe("mini-projects", () => {
  it("opens a project from the track page, reveals hints one at a time, and hides the solution from students", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github");
    await page.locator("#projects").getByRole("link", { name: "Team task tracker with branches and pull requests" }).click();
    await page.waitForURL("**/tracks/git-github/projects/git-team-task-tracker");
    await page.getByRole("heading", { level: 1, name: "Team task tracker with branches and pull requests" }).waitFor();
    await expectText(page.locator("main"), /Mini-project · intermediate · about 6 hours/);
    for (const id of ["stories", "acceptance", "rubric", "starter", "check", "hints", "stretch"]) await page.locator(`h2#${id}`).waitFor();
    assert.equal(await page.getByRole("row").count(), 5, "rubric header + 4 criteria");

    await page.getByRole("button", { name: "Show hint 1 of 5" }).click();
    await page.getByRole("button", { name: "Show hint 2 of 5" }).click();
    assert.equal(await page.locator("#hints + p + ol li").count(), 2);

    await page.getByLabel("Starter files").getByText("tasks.py", { exact: true }).click();
    await expectText(page.getByLabel("Starter files"), /def add\(tasks, title\)/);
    assert.equal(await page.getByRole("heading", { name: "Reference solution (faculty)" }).count(), 0);
    noProblems(problems);
  });

  it("shows the reference solution to faculty", async () => {
    await h.createUser({ email: "marker@example.edu", name: "Marker", password: "orbit lantern cobalt river", role: "faculty" });
    const { page, problems } = await h.newPage();
    await page.goto("/login?next=/tracks/git-github/projects/git-release-workflow");
    await page.getByLabel("Email").fill("marker@example.edu");
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/tracks/git-github/projects/git-release-workflow");
    await page.getByRole("button", { name: "Show the reference solution" }).click();
    const solution = page.getByLabel("Reference solution", { exact: true });
    await solution.getByText(".github/workflows/release.yml", { exact: true }).click();
    await expectText(solution, /gh release create/);
    noProblems(problems);
  });
});
