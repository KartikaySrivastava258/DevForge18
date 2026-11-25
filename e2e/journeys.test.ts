import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { startHarness, type Harness } from "./harness.ts";

const SHOTS = join(import.meta.dirname, "..", "build", "screenshots");
mkdirSync(SHOTS, { recursive: true });
let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

const noProblems = (problems: string[]) => assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);

describe("discovery (anonymous visitor)", () => {
  it("home page renders the hero, all 18 map nodes and the 8 paths without console errors", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.match(await page.getByRole("heading", { level: 1 }).innerText(), /Learn the tools/);
    assert.equal(await page.locator(".map-node").count(), 18);
    assert.ok((await page.locator(".map-edge").count()) >= 20, "map draws connection edges");
    assert.equal(await page.locator(".split h3").count(), 8);
    assert.equal(await page.locator("h1").count(), 1);
    await page.screenshot({ path: join(SHOTS, "home-dark.png"), fullPage: true });
    noProblems(problems);
  });

  it("system map explains connections on hover and navigates on click", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/");
    await page.locator('.map-node[aria-label="Track 2: Docker"]').hover();
    const panel = page.locator(".map__panel");
    await panel.getByRole("heading", { name: "Docker" }).waitFor();
    assert.match(await panel.innerText(), /Kubernetes/);
    assert.match(await panel.innerText(), /container images/i);
    assert.ok((await page.locator('.map-edge[data-on="true"]').count()) >= 3);
    await page.screenshot({ path: join(SHOTS, "map-docker-focus.png") });
    await page.locator('.map-node[aria-label="Track 10: Apache Kafka"]').click();
    await page.waitForURL("**/tracks/kafka");
    await page.getByRole("heading", { level: 1, name: /Apache Kafka/ }).waitFor();
    noProblems(problems);
  });

  it("catalogue lists 18 tracks and filters by text, level and category (synced to the URL)", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks");
    await page.locator(".track-row").first().waitFor();
    assert.equal(await page.locator(".track-row").count(), 18);
    await page.getByLabel("Filter tracks by name or purpose").fill("kafka");
    assert.equal(await page.locator(".track-row").count(), 1);
    assert.match(page.url(), /q=kafka/);
    await page.getByLabel("Filter tracks by name or purpose").fill("");
    await page.getByLabel("Starting level").selectOption("intermediate");
    const n = await page.locator(".track-row").count();
    assert.ok(n > 0 && n < 18);
    await page.getByLabel("Filter tracks by name or purpose").fill("zzzz");
    await page.getByRole("button", { name: "Clear filters" }).click();
    assert.equal(await page.locator(".track-row").count(), 18);
    await page.screenshot({ path: join(SHOTS, "catalogue.png"), fullPage: true });
    noProblems(problems);
  });

  it("track page shows every required section, honest status and verification labels", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/docker");
    await page.getByRole("heading", { level: 1 }).waitFor();
    for (const name of ["Understand it", "How it connects", "Curriculum", "Lessons", "Labs", "Projects", "Official resources", "About this track"]) {
      assert.ok(await page.getByRole("heading", { level: 2, name }).isVisible(), name);
    }
    assert.match(await page.locator(".notice--warn").innerText(), /2 lessons are published/);
    assert.equal(await page.locator(".resource").count(), 3);
    assert.equal(await page.getByText("Link not yet verified").count(), 3);
    assert.ok(await page.getByRole("link", { name: "Images vs Containers" }).isVisible());
    await page.screenshot({ path: join(SHOTS, "track-docker.png"), fullPage: true });
    noProblems(problems);
  });

  it("Git lessons show tested-command notes, labelled expected output, and chain with next/previous links", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github");
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await page.locator(".lesson-list li").count(), 3);
    assert.match(await page.locator(".notice--warn").innerText(), /3 lessons are published/);
    await page.getByRole("link", { name: "Your first repository and commits" }).click();
    await page.getByRole("heading", { level: 1, name: "Your first repository and commits" }).waitFor();
    assert.match(await page.locator(".verified--executed").innerText(), /Tested commands\./);
    assert.ok((await page.locator(".code-block--output").count()) >= 8);
    assert.equal(await page.locator(".code-block--output .code-block__lang").first().innerText(), "Expected output");
    await page.locator(".pager").getByRole("link", { name: /Next lesson/ }).click();
    await page.getByRole("heading", { level: 1, name: "Sharing work with remotes, push and pull" }).waitFor();
    await page.locator(".pager").getByRole("link", { name: /Previous lesson/ }).waitFor();
    // Lessons confirmed against real services in CI show the tested label too.
    await page.goto("/tracks/docker/lessons/docker-images-vs-containers");
    await page.locator(".verified--executed").waitFor();
    await page.goto("/tracks/postgresql/lessons/postgresql-tables-and-constraints");
    assert.match(await page.locator(".verified--executed").innerText(), /Tested commands\..*PostgreSQL 16/);
    assert.ok((await page.locator('.code-block[data-lang="sql"]').count()) >= 8);
    noProblems(problems);
  });

  it("search handles abbreviations from the header box", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks");
    await page.locator("#search-header").fill("k8s");
    await page.locator("#search-header").press("Enter");
    await page.waitForURL("**/search?q=k8s");
    await page.locator(".results li").first().waitFor();
    assert.match(await page.locator(".results li a").first().innerText(), /Kubernetes/);
    noProblems(problems);
  });

  it("unknown pages show a helpful 404 inside the app shell", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/definitely/not/here");
    await page.getByRole("heading", { name: "Page not found" }).waitFor();
    await page.goto("/tracks/does-not-exist");
    await page.getByRole("heading", { name: "Page not found" }).waitFor();
    // Chrome logs the (expected) 404 API response as a console error; nothing else may appear.
    noProblems(problems.filter((p) => !p.includes("status of 404")));
  });
});

describe("learning journey (registered student)", () => {
  it("registers, completes a lesson via its self-check, bookmarks it and sees progress", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/docker/lessons/docker-images-vs-containers");
    await page.getByRole("heading", { level: 1, name: "Images vs Containers" }).waitFor();

    // Regression: page re-renders (scroll-spy, announcements) must not re-insert the lesson article.
    await page.evaluate(() => ((document.querySelector("article.article") as HTMLElement).dataset.marker = "original"));
    for (const y of [800, 1600, 2400, 0]) {
      await page.mouse.wheel(0, y);
      await page.waitForTimeout(120);
    }

    // Copy button on a code block
    await page.locator('.code-block[data-lang="bash"] [data-copy]').first().click();
    await page.locator('.code-block[data-lang="bash"] [data-copy][data-state="copied"]').first().waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /docker pull nginx:1\.27-alpine/);
    assert.equal(await page.evaluate(() => (document.querySelector("article.article") as HTMLElement).dataset.marker), "original");

    // Anonymous attempt: all correct but not saved
    const pick = async (n: number, text: RegExp) => page.locator(".check fieldset").nth(n).locator(".option", { hasText: text }).click();
    await page.getByRole("button", { name: "Check answers" }).click();
    assert.match(await page.locator(".check .field__error").innerText(), /Answer all 4 questions/);

    // Register from the lesson; should return here
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.getByLabel("Name").fill("Priya");
    await page.getByLabel("Email").fill("priya@example.edu");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.locator("#pw-err").waitFor();
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/tracks/docker/lessons/docker-images-vs-containers");
    await page.getByRole("button", { name: "Priya" }).or(page.getByRole("link", { name: "Priya" })).waitFor();

    // One wrong answer: no explanation for it, lesson not complete
    await pick(0, /own private writable layer/);
    await pick(1, /stopping keeps/);
    await pick(2, /keeps using the image/);
    await pick(3, /automatically updates/);
    await page.getByRole("button", { name: "Check answers" }).click();
    await page.getByText("3 of 4 correct.").waitFor();
    assert.equal(await page.locator(".feedback--no").count(), 1);
    assert.match(await page.locator(".feedback--no").innerText(), /Not quite/);

    // Fix it: lesson complete and saved
    await pick(3, /just the default tag name/);
    await page.getByRole("button", { name: /Check/ }).click();
    await page.getByText("Lesson complete.").waitFor();
    assert.equal(await page.locator(".feedback--ok").count(), 4);

    // Bookmark the lesson
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Saved" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "lesson-complete.png"), fullPage: true });

    // Dashboard reflects it
    await page.getByRole("link", { name: "My progress" }).first().click();
    await page.waitForURL("**/dashboard");
    await page.getByText("lessons completed").waitFor();
    assert.equal(await page.locator(".stat b").first().innerText(), "1");
    assert.match(await page.locator("#saved-h + ul").innerText(), /Images vs Containers/);
    await page.screenshot({ path: join(SHOTS, "dashboard.png"), fullPage: true });

    // Sign out
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    // The deliberate weak-password attempt returns 400, which Chrome logs; nothing else may appear.
    noProblems(problems.filter((p) => !p.includes("status of 400")));
  });

  it("protects the dashboard and rejects open redirects after login", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/dashboard");
    await page.waitForURL("**/login?next=%2Fdashboard");
    await page.goto("/login?next=//evil.example/");
    await page.getByLabel("Email").fill("priya@example.edu");
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    assert.ok(page.url().startsWith(h.url));
    noProblems(problems);
  });

  it("shows a clear error for wrong credentials", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill("priya@example.edu");
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("alert").getByText("Email or password is incorrect.").waitFor();
    // The 401 is expected; filter it out of the problem list.
    noProblems(problems.filter((p) => !/401|Failed to load resource/.test(p)));
  });
});

describe("accessibility, theming and responsiveness", () => {
  it("first Tab reaches the skip link, which moves focus to main content", async () => {
    const { page } = await h.newPage();
    await page.goto("/tracks");
    await page.locator(".track-row").first().waitFor(); // React has rendered the shell
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main");
  });

  it("map nodes are keyboard reachable and update the panel on focus", async () => {
    const { page } = await h.newPage();
    await page.goto("/");
    await page.locator('.map-node[aria-label="Track 4: PostgreSQL"]').focus();
    await page.locator(".map__panel").getByRole("heading", { name: "PostgreSQL" }).waitFor();
  });

  it("theme toggle switches to light and persists across reloads; light theme renders cleanly", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await page.locator(".map-node").first().waitFor();
    await page.screenshot({ path: join(SHOTS, "home-light.png"), fullPage: true });
    noProblems(problems);
  });

  it("respects the OS light preference on first visit", async () => {
    const { page } = await h.newPage({ colorScheme: "light" });
    await page.goto("/");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  });

  it("every page has exactly one h1 and every form control has a label", async () => {
    const { page } = await h.newPage();
    for (const path of ["/", "/tracks", "/tracks/redis", "/paths", "/paths/mlops", "/search?q=cache", "/login", "/register", "/tracks/docker/lessons/docker-images-vs-containers"]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(await page.locator("h1").count(), 1, path);
      const unlabeled = await page.evaluate(() =>
        [...document.querySelectorAll("input, select, textarea")]
          .filter((el) => el.getAttribute("type") !== "hidden")
          .filter((el) => !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest("label") && !el.getAttribute("aria-label"))
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      assert.deepEqual(unlabeled, [], path);
    }
  });

  it("mobile: no horizontal overflow, menu toggles, map becomes a list", async () => {
    const { page, problems } = await h.newPage({ mobile: true });
    for (const path of ["/", "/tracks", "/tracks/kubernetes", "/tracks/docker/lessons/docker-images-vs-containers", "/paths/devops-platform", "/dashboard"]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${path} overflows horizontally by ${overflow}px`);
    }
    await page.goto("/");
    await page.locator("h1").waitFor();
    assert.equal(await page.locator(".map__canvas").isVisible(), false);
    assert.ok(await page.locator(".map-list").isVisible());
    const nav = page.locator("#primary-nav");
    assert.equal(await nav.isVisible(), false);
    await page.getByRole("button", { name: "Open menu" }).click();
    await nav.waitFor({ state: "visible", timeout: 5000 });
    await nav.getByRole("link", { name: "Learning paths" }).click();
    await page.waitForURL("**/paths");
    // Wait for the state change rather than sampling one instant (slower CI machines need a moment).
    await nav.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    assert.equal(await nav.isVisible(), false, "menu closes after navigating");
    await page.screenshot({ path: join(SHOTS, "mobile-paths.png"), fullPage: true });
    await page.goto("/");
    await page.locator("h1").waitFor();
    await page.screenshot({ path: join(SHOTS, "mobile-home.png"), fullPage: true });
    noProblems(problems);
  });
});
