import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { startFakeGitHub, type FakeGitHub } from "../server/test/fake-github.ts";
import { expectText, startHarness, type Harness } from "./harness.ts";

const PASSWORD = "orbit lantern cobalt river";
let h: Harness;
let gh: FakeGitHub;
before(async () => {
  gh = await startFakeGitHub();
  h = await startHarness({ cms: { enabled: true, github: gh.settings } });
});
after(async () => {
  await h.close();
  await gh.close();
});

const noProblems = (problems: string[]) => assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);

async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
}

describe("administration screens", () => {
  it("lets an admin filter users, change a role and disable an account with confirmation, shows the last-admin refusal, and lists the audit log", async () => {
    await h.createUser({ email: "root@example.edu", name: "Root Admin", password: PASSWORD, role: "admin" });
    await h.createUser({ email: "sam@example.edu", name: "Sam Student", password: PASSWORD, role: "student" });
    const { page, problems } = await h.newPage();
    await signIn(page, "root@example.edu", "/admin");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Admin" }).waitFor();
    await page.getByRole("heading", { level: 1, name: "Administration" }).waitFor();

    const users = page.locator("section", { has: page.getByRole("heading", { name: "Users" }) });
    await page.getByLabel("Role", { exact: true }).selectOption("student");
    await expectText(users.locator("tbody"), /Sam Student/);
    // The filter is applied by a new request: wait until the admin's row has gone before counting, or a slow
    // machine counts the unfiltered table (seen in CI run 46139925723).
    await users.locator("tbody tr", { hasText: "Root Admin" }).waitFor({ state: "detached" });
    assert.equal(await users.locator("tbody tr").count(), 1);

    // Role change: nothing happens until confirmed.
    await page.getByLabel("Role of Sam Student").selectOption("faculty");
    await expectText(page.getByRole("dialog"), /Change Sam Student \(sam@example.edu\) from Student to Faculty\?/);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expectText(page.getByRole("status").filter({ hasText: "is now" }), /Sam Student is now Faculty\./);

    // The only admin cannot demote themselves: the 409 is shown as a sentence.
    await page.getByLabel("Role", { exact: true }).selectOption("");
    await page.getByLabel("Role of Root Admin").selectOption("student");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expectText(page.getByRole("alert"), /You cannot remove the last administrator\./);
    assert.equal(await page.getByLabel("Role of Root Admin").inputValue(), "admin", "the table still shows the real role");

    // Disable, with confirmation; an admin has no disable button for their own account.
    assert.equal(await users.getByRole("row", { name: /Root Admin/ }).getByRole("button").count(), 0);
    await page.getByRole("button", { name: "Disable Sam Student" }).click();
    await expectText(page.getByRole("dialog"), /signed out at once/);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expectText(users.getByRole("row", { name: /Sam Student/ }), /Disabled/);
    await page.getByRole("button", { name: "Enable Sam Student" }).waitFor();

    const audit = page.getByRole("table", { name: "Audit log" });
    await expectText(audit, /user\.disabled/);
    await expectText(audit, /user\.role_changed[\s\S]*"from":"student","to":"faculty"/);
    noProblems(problems.filter((p) => !/status of 409|Failed to load resource/.test(p)));
  });

  it("shows a clear not-allowed state to students and hides the admin and editor links", async () => {
    await h.createUser({ email: "pat@example.edu", name: "Pat Student", password: PASSWORD, role: "student" });
    const { page, problems } = await h.newPage();
    await signIn(page, "pat@example.edu", "/admin");
    await expectText(page.getByRole("alert"), /You are not allowed to use this page[\s\S]*only available to administrators/);
    const nav = page.getByRole("navigation", { name: "Primary" });
    assert.equal(await nav.getByRole("link", { name: "Admin" }).count(), 0);
    assert.equal(await nav.getByRole("link", { name: "Edit content" }).count(), 0);
    await page.goto("/content-editor");
    await expectText(page.getByRole("alert"), /for faculty and administrators/);
    noProblems(problems);
  });
});

describe("content editor", () => {
  it("lets faculty open a lesson from the default branch, see validation errors, fix them and open a pull request", async () => {
    await h.createUser({ email: "grace@example.edu", name: "Grace Hopper", password: PASSWORD, role: "faculty" });
    const { page, problems } = await h.newPage();
    await signIn(page, "grace@example.edu", "/dashboard");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Edit content" }).click();
    await page.getByRole("heading", { level: 1, name: "Edit content" }).waitFor();
    await expectText(page.locator(".lede"), /becomes a pull request/);

    await page.getByLabel("Type").selectOption("lesson");
    await page.getByLabel("Filter by path").fill("git-first");
    await page.getByLabel(/^File \(1 of/).selectOption("content/lessons/git-github/git-first-commits.md");
    await page.getByRole("button", { name: "Open file" }).click();
    await page.getByRole("heading", { name: /Editing content\/lessons\/git-github\/git-first-commits\.md/ }).waitFor();

    const editor = page.getByLabel("File content");
    const original = await editor.inputValue();
    assert.match(original, /^---\nid: git-first-commits\n/);
    assert.ok(await page.getByRole("button", { name: "Open pull request" }).isDisabled(), "nothing to submit before a change");

    // A schema error is reported with its field, before anything reaches GitHub.
    await editor.fill(original.replace(/^estimated_minutes: 30\n/m, ""));
    await page.getByRole("button", { name: "Check for errors" }).click();
    await expectText(page.getByRole("alert"), /1 problem found[\s\S]*estimated_minutes/);
    assert.equal(gh.pulls.length, 0);

    await editor.fill(original.replace("Your first repository and commits", "Your first repository and your first commits"));
    await page.getByRole("button", { name: "Check for errors" }).click();
    await expectText(page.getByRole("status").filter({ hasText: "No problems" }), /No problems found in this file\.[\s\S]*run in CI/);

    await page.getByLabel("Title of the change").fill("Clarify the lesson title");
    await page.getByLabel("Note for reviewers (optional)").fill("Requested by students in section B.");
    await page.getByRole("button", { name: "Open pull request" }).click();
    await expectText(page.getByRole("status").filter({ hasText: "Pull request" }), /Pull request #1 opened on branch cms\/git-first-commits-/);
    const link = page.getByRole("link", { name: "View it on GitHub" });
    assert.equal(await link.getAttribute("href"), "https://github.example/devforge-test/devforge18/pull/1");

    assert.equal(gh.pulls.length, 1);
    assert.match(gh.pulls[0]!.body, /Grace Hopper/);
    assert.ok(!gh.pulls[0]!.body.includes("grace@example.edu"));
    await expectText(page.getByRole("table"), /#1 Clarify the lesson title[\s\S]*git-first-commits\.md/);
    noProblems(problems);
  });
});
