/**
 * Cohorts, assignments, submissions, rubric reviews and portfolios in a real browser (REMAINING_WORK.md §6.3).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { expectText, startHarness, type Harness } from "./harness.ts";

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

const noProblems = (problems: string[]) => assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);
const PASSWORD = "orbit lantern cobalt river";

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
}

describe("cohorts and reviews", () => {
  it("a teacher sets an assignment, a learner submits, the teacher reviews against the rubric, and the learner publishes a portfolio", async () => {
    await h.createUser({ email: "prof@example.edu", name: "Prof Rao", password: PASSWORD, role: "faculty" });
    await h.createUser({ email: "asha@example.edu", name: "Asha", password: PASSWORD, role: "student" });

    // Teacher: create the cohort and an assignment.
    const teacher = await h.newPage();
    await signIn(teacher.page, "prof@example.edu", "/cohorts");
    await teacher.page.getByLabel("Name").fill("DevOps section B");
    await teacher.page.getByRole("button", { name: "Create cohort" }).click();
    await teacher.page.getByRole("heading", { level: 1, name: "DevOps section B" }).waitFor();
    const code = (await teacher.page.locator(".join-code").textContent())?.trim() ?? "";
    assert.match(code, /^[A-Z2-9]{10}$/);
    await teacher.page.getByLabel("Type").selectOption("project");
    await teacher.page.getByLabel("Item").selectOption({ label: "git-github · Personal developer portfolio repository" });
    await teacher.page.getByLabel("Due (your local time)").fill("2030-01-15T17:00");
    await teacher.page.getByRole("button", { name: "Add assignment" }).click();
    await expectText(teacher.page.locator("table").last(), /Personal developer portfolio repository/);

    // Learner: join with the code, see the assignment, submit from the project page.
    const learner = await h.newPage();
    await signIn(learner.page, "asha@example.edu", "/cohorts");
    await expectText(learner.page.locator("#join-privacy"), /can see your name, e-mail address and progress/);
    await learner.page.getByLabel("Code from your teacher").fill(code.toLowerCase());
    await learner.page.getByRole("button", { name: "Join" }).click();
    await learner.page.getByRole("heading", { level: 1, name: "DevOps section B" }).waitFor();
    await expectText(learner.page.locator("table"), /Not started/);
    await learner.page.getByRole("link", { name: "Personal developer portfolio repository" }).click();
    await learner.page.getByLabel("Link to your repository (https)").fill("https://git.example.edu/asha/portfolio");
    await learner.page.getByRole("button", { name: "Submit for review" }).click();
    await expectText(learner.page.getByRole("region", { name: "Submit your work" }), /Waiting for review/);

    // Teacher: review queue, rubric with one radio group per criterion, accept.
    await teacher.page.goto("/reviews");
    await teacher.page.getByRole("link", { name: "Personal developer portfolio repository" }).click();
    const groups = teacher.page.locator("fieldset.rubric-row");
    await groups.first().waitFor();
    const n = await groups.count();
    assert.ok(n >= 3, "one fieldset per rubric criterion");
    const accept = teacher.page.getByRole("button", { name: "Accept" });
    assert.equal(await accept.isDisabled(), true, "cannot save before every criterion is scored");
    for (let i = 0; i < n; i++) await groups.nth(i).getByRole("radio", { name: /^Excellent/ }).check();
    await teacher.page.getByLabel("Feedback for the learner").fill("Clear commits and a tidy .gitignore.");
    await accept.click();
    await expectText(teacher.page.locator("[role=status]").last(), /Review saved: accepted/);

    // Learner: sees the review on the project page, then publishes the portfolio from the dashboard.
    await learner.page.reload();
    await expectText(learner.page.locator("section[aria-labelledby='submit-h']"), /Clear commits and a tidy \.gitignore\./);
    await learner.page.goto("/dashboard");
    await expectText(learner.page.locator("section[aria-labelledby='assignments-h']"), /Done/);
    await learner.page.getByLabel("Address").fill("asha-devops");
    await learner.page.getByLabel("Make my portfolio public").check();
    await learner.page.getByRole("button", { name: "Save portfolio settings" }).click();
    await expectText(learner.page.locator("section[aria-labelledby='portfolio-h'] [role=status]"), /public/);

    // Anyone: the public portfolio shows the accepted work and never the e-mail address.
    const visitor = await h.newPage();
    await visitor.page.goto("/portfolio/asha-devops");
    await visitor.page.getByRole("heading", { level: 1, name: "Asha" }).waitFor();
    await expectText(visitor.page.locator("main"), /Personal developer portfolio repository/);
    assert.doesNotMatch((await visitor.page.locator("body").textContent()) ?? "", /@example\.edu/);

    noProblems(teacher.problems);
    noProblems(learner.problems);
    noProblems(visitor.problems);
  });

  it("a learner downloads their data and deletes their account", async () => {
    await h.createUser({ email: "leaving@example.edu", name: "Leaving", password: PASSWORD, role: "student" });
    const { page, problems } = await h.newPage();
    await signIn(page, "leaving@example.edu", "/dashboard");
    const download = page.getByRole("link", { name: "Download my data (JSON)" });
    assert.equal(await download.getAttribute("href"), "/api/me/export");
    const res = await page.request.get("/api/me/export");
    assert.equal((await res.json()).account.email, "leaving@example.edu");
    await page.getByText("Delete my account", { exact: true }).click();
    await page.getByLabel("Your password").fill(PASSWORD);
    const button = page.getByRole("button", { name: "Delete my account permanently" });
    assert.equal(await button.isDisabled(), true, "disabled until the phrase is typed");
    await page.getByLabel("Type “delete my account” to confirm").fill("delete my account");
    await button.click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.getByRole("link", { name: "Sign in" }).first().waitFor();
    noProblems(problems);
  });
});
