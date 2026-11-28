import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { expectText, samplePhases, startHarness, type Harness } from "./harness.ts";

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
    await expectText(page.getByRole("heading", { level: 1 }), /Learn the tools/);
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
    await expectText(panel, /Kubernetes/);
    await expectText(panel, /container images/i);
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
    for (const name of ["Understand it", "How it connects", "Curriculum", "Lessons", "Labs", "Projects", "Who uses this and why", "Alternatives and how to choose", "Official resources", "About this track"]) {
      assert.ok(await page.getByRole("heading", { level: 2, name }).isVisible(), name);
    }
    // The count comes from the API, so the test survives new lessons.
    const { lessons } = (await (await fetch(`${h.url}/api/tracks/docker`)).json()) as { lessons: unknown[] };
    assert.ok(lessons.length >= 2);
    await expectText(page.locator(".notice--warn"), new RegExp(`${lessons.length} lessons are published`));
    assert.equal(await page.locator(".resource").count(), 3);
    // Every Docker resource was reviewed after the link check (2026-11-25), so each shows its check date.
    assert.equal(await page.getByText(/^Link checked /).count(), 3);
    assert.equal(await page.getByText("Link not yet verified").count(), 0);
    assert.ok(await page.getByRole("link", { name: "Images vs Containers" }).isVisible());
    await page.screenshot({ path: join(SHOTS, "track-docker.png"), fullPage: true });
    noProblems(problems);
  });

  it("track page shows sourced case studies and alternatives with licences", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/kafka");
    await page.getByRole("heading", { level: 2, name: "Who uses this and why" }).waitFor();
    const studies = page.locator(".case-study");
    assert.ok((await studies.count()) >= 2);
    const linkedin = page.getByRole("article", { name: "LinkedIn" });
    await expectText(linkedin.locator("blockquote").first(), /^“We use Kafka for moving every type of data around/);
    assert.equal(await linkedin.getByRole("link", { name: "Running Kafka At Scale" }).first().getAttribute("href"), "https://engineering.linkedin.com/kafka/running-kafka-scale");
    assert.ok(await linkedin.getByText("Confirmed").first().isVisible());
    assert.ok(await page.getByRole("heading", { level: 2, name: "Alternatives and how to choose" }).isVisible());
    const pulsar = page.locator(".alternative", { has: page.getByRole("link", { name: "Apache Pulsar" }) });
    assert.ok(await pulsar.getByText("Choose it when").isVisible());
    assert.equal(await pulsar.getByRole("link", { name: "Apache-2.0" }).getAttribute("href"), "https://github.com/apache/pulsar/blob/master/LICENSE");
    // The table of contents links to both new sections.
    await page.getByRole("link", { name: "Alternatives", exact: true }).first().click();
    await page.waitForURL("**#alternatives");
    await page.screenshot({ path: join(SHOTS, "track-kafka-case-studies.png"), fullPage: true });
    noProblems(problems);
  });

  it("Git lessons show tested-command notes, labelled expected output, and chain with next/previous links", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github");
    await page.getByRole("heading", { level: 1 }).waitFor();
    // Counts come from the API, so the test survives new lessons.
    const { lessons: gitLessons } = (await (await fetch(`${h.url}/api/tracks/git-github`)).json()) as { lessons: unknown[] };
    assert.ok(gitLessons.length >= 3);
    assert.equal(await page.locator(".lesson-list li").count(), gitLessons.length);
    await expectText(page.locator(".notice--warn"), new RegExp(`${gitLessons.length} lessons are published`));
    await page.getByRole("link", { name: "Your first repository and commits" }).click();
    await page.getByRole("heading", { level: 1, name: "Your first repository and commits" }).waitFor();
    await expectText(page.locator(".verified--executed"), /Tested commands\./);
    assert.ok((await page.locator(".code-block--output").count()) >= 8);
    assert.equal(await page.locator(".code-block--output .code-block__lang").first().innerText(), "Expected output");
    await page.locator(".pager").getByRole("link", { name: /Next lesson/ }).click();
    await page.getByRole("heading", { level: 1, name: "Sharing work with remotes, push and pull" }).waitFor();
    await page.locator(".pager").getByRole("link", { name: /Previous lesson/ }).waitFor();
    // Lessons confirmed against real services in CI show the tested label too.
    await page.goto("/tracks/docker/lessons/docker-images-vs-containers");
    await page.locator(".verified--executed").waitFor();
    await page.goto("/tracks/postgresql/lessons/postgresql-tables-and-constraints");
    await expectText(page.locator(".verified--executed"), /Tested commands\..*PostgreSQL 16/);
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
    await expectText(page.locator(".results li a").first(), /Kubernetes/);
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
    await expectText(page.locator(".check .field__error"), /Answer all 4 questions/);

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
    await expectText(page.locator(".feedback--no"), /Not quite/);

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
    await expectText(page.locator("#saved-h + ul"), /Images vs Containers/);
    await page.screenshot({ path: join(SHOTS, "dashboard.png"), fullPage: true });

    // Sign out
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    // The deliberate weak-password attempt returns 400, which Chrome logs; nothing else may appear.
    noProblems(problems.filter((p) => !p.includes("status of 400")));
  });

  it("opens a lab from its track, and records a local lab as self-reported after every checkpoint", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/git-github");
    await page.getByRole("link", { name: "Resolve a merge conflict" }).click();
    await page.waitForURL("**/tracks/git-github/labs/git-resolve-a-merge-conflict");
    await page.getByRole("heading", { level: 1, name: "Resolve a merge conflict" }).waitFor();
    assert.ok(await page.getByText("On your machine").isVisible());
    assert.ok(await page.getByText("Tested steps.").isVisible());
    assert.ok(await page.locator('.code-block[data-lang="output"]', { hasText: "All checks passed" }).isVisible());
    // Anonymous visitors are asked to sign in; there is no button to press.
    assert.equal(await page.getByRole("button", { name: "Mark the lab as done" }).count(), 0);
    await page.locator("#lab-done-h ~ p a", { hasText: "create an account" }).click();
    await page.getByLabel("Name").fill("Lab Learner");
    await page.getByLabel("Email").fill("lab-learner@example.edu");
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/tracks/git-github/labs/git-resolve-a-merge-conflict");
    await page.getByRole("button", { name: "Mark the lab as done" }).click();
    await expectText(page.locator(".check .field__error"), /Tick every checkpoint/);
    for (const box of await page.locator(".check input[type=checkbox]").all()) await box.check();
    await page.getByRole("button", { name: "Mark the lab as done" }).click();
    await page.getByText(/Lab complete.*self-reported/).waitFor();
    await page.screenshot({ path: join(SHOTS, "lab-git-conflict.png"), fullPage: true });

    // A read-through lab is graded on the server and recorded as checked.
    await page.goto("/tracks/kubernetes/labs/kubernetes-debug-broken-deployments");
    await page.getByRole("heading", { level: 1, name: "Break a configuration and debug events and logs" }).waitFor();
    const answer = async (n: number, text: RegExp) => page.locator(".check fieldset").nth(n).locator(".option", { hasText: text }).click();
    await answer(0, /typo in the tag/);
    await answer(1, /logs --previous/);
    await answer(2, /out of disk|Delete the Pod/);
    await answer(3, /readiness and restart counts/);
    await page.getByRole("button", { name: "Check answers" }).click();
    await page.getByText("3 of 4 correct.").waitFor();
    await answer(2, /Lower the CPU request/);
    await page.getByRole("button", { name: "Check answers" }).click();
    await page.getByText(/Lab complete.*checked by DevForge/).waitFor();
    noProblems(problems);
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
    for (const path of ["/", "/tracks", "/tracks/redis", "/paths", "/paths/mlops", "/search?q=cache", "/login", "/register", "/tracks/docker/lessons/docker-images-vs-containers", "/tracks/airflow/simulations/airflow-scheduler-timeline", "/tracks/mlflow/simulations/mlflow-experiment-explorer", "/tracks/langchain-llamaindex/simulations/langchain-rag-pipeline", "/tracks/n8n/simulations/n8n-workflow-executor", "/tracks/jira/simulations/jira-sprint-board", "/tracks/docker/simulations/docker-layer-cache", "/tracks/postgresql/simulations/postgresql-query-planner", "/tracks/postgresql/simulations/postgresql-isolation-timeline", "/tracks/terraform/simulations/terraform-plan-diff", "/tracks/github-actions/simulations/github-actions-workflow-run", "/tracks/redis/simulations/redis-cache-load", "/tracks/nginx/simulations/nginx-location-matcher", "/tracks/postman/simulations/postman-request-builder", "/tracks/jenkins/simulations/jenkins-build-queue"]) {
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
    for (const path of ["/", "/tracks", "/tracks/kubernetes", "/tracks/docker/lessons/docker-images-vs-containers", "/tracks/git-github/lessons/git-first-commits", "/tracks/git-github/simulations/git-commit-graph", "/tracks/kubernetes/simulations/kubernetes-reconciliation", "/tracks/prometheus-grafana/simulations/prometheus-scrape-and-rate", "/tracks/opentelemetry/simulations/opentelemetry-trace-waterfall", "/tracks/kafka/simulations/kafka-consumer-groups", "/tracks/airflow/simulations/airflow-scheduler-timeline", "/tracks/mlflow/simulations/mlflow-experiment-explorer", "/tracks/langchain-llamaindex/simulations/langchain-rag-pipeline", "/tracks/n8n/simulations/n8n-workflow-executor", "/tracks/jira/simulations/jira-sprint-board", "/tracks/docker/simulations/docker-layer-cache", "/tracks/postgresql/simulations/postgresql-query-planner", "/tracks/postgresql/simulations/postgresql-isolation-timeline", "/tracks/terraform/simulations/terraform-plan-diff", "/tracks/github-actions/simulations/github-actions-workflow-run", "/tracks/redis/simulations/redis-cache-load", "/tracks/nginx/simulations/nginx-location-matcher", "/tracks/postman/simulations/postman-request-builder", "/tracks/jenkins/simulations/jenkins-build-queue", "/tracks/git-github/labs/git-resolve-a-merge-conflict", "/tracks/kubernetes/labs/kubernetes-self-healing-and-rollouts", "/tracks/kubernetes/labs/kubernetes-debug-broken-deployments", "/paths/devops-platform", "/dashboard"]) {
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
    // Regression (IMPLEMENTATION_STATUS.md): the menu must close in the same update as the tap, not one task
    // later — otherwise a test, or a user, can see the new page with the old menu still open.
    await page.getByRole("button", { name: "Open menu" }).click();
    await nav.waitFor({ state: "visible", timeout: 5000 });
    const phases = await samplePhases(
      page,
      () => (document.querySelector('#primary-nav a[href="/tracks"]') as HTMLElement).click(),
      () => !(document.querySelector("#primary-nav") as HTMLElement).checkVisibility(),
    );
    assert.deepEqual(phases, { afterMicrotasks: true, afterNextTask: true }, "menu hidden right after the tap's microtasks");
    await page.screenshot({ path: join(SHOTS, "mobile-paths.png"), fullPage: true });
    await page.goto("/");
    await page.locator("h1").waitFor();
    await page.screenshot({ path: join(SHOTS, "mobile-home.png"), fullPage: true });
    noProblems(problems);
  });
});

describe("figures and step-through diagrams", () => {
  const LESSON = "/tracks/git-github/lessons/git-first-commits";
  const stepOf = async (fig: import("playwright").Locator) => (await fig.locator(".step-diagram__count").innerText()).trim();

  it("steps forward and back with buttons and arrow keys, keeping keyboard focus", async () => {
    const { page, problems } = await h.newPage();
    await page.goto(LESSON);
    const fig = page.locator(".step-diagram").first();
    await fig.locator(".step-diagram__caption").waitFor();
    assert.equal(await fig.getAttribute("data-enhanced"), "true");
    assert.match(await fig.locator(".figure__svg").getAttribute("aria-labelledby") ?? "", /-title$/);
    assert.match(await fig.locator(".figure__svg title").textContent() ?? "", /How a change becomes a commit/);
    assert.equal(await stepOf(fig), "Step 1 of 5");
    await expectText(fig.locator(".step-diagram__caption"), /untracked/);
    const hiddenAtStart = await fig.locator('[data-step-state="future"]').count();
    assert.ok(hiddenAtStart > 0, "later steps are hidden at step 1");
    assert.equal(await fig.getByRole("button", { name: "Previous" }).getAttribute("aria-disabled"), "true");

    const next = fig.getByRole("button", { name: "Next" });
    await next.focus();
    await page.keyboard.press("Enter");
    assert.equal(await stepOf(fig), "Step 2 of 5");
    assert.ok((await fig.locator('[data-step-state="future"]').count()) < hiddenAtStart, "the next step's elements appear");
    assert.equal(await fig.locator('[data-step-state="current"]').count() > 0, true, "the new step is highlighted");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    assert.equal(await stepOf(fig), "Step 5 of 5");
    await page.keyboard.press("ArrowRight");
    assert.equal(await stepOf(fig), "Step 5 of 5", "stops at the last step");
    assert.equal(await next.getAttribute("aria-disabled"), "true");
    assert.ok(await next.evaluate((el) => el === document.activeElement), "focus stays on Next at the last step");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await stepOf(fig), "Step 4 of 5");
    // The full text alternative is always available.
    await fig.locator(".step-diagram__all summary").click();
    assert.equal(await fig.locator(".step-diagram__all li").count(), 5);
    await fig.screenshot({ path: join(SHOTS, "step-diagram-dark.png") });
    noProblems(problems);
  });

  it("plays only when asked, and pauses", async () => {
    const { page, problems } = await h.newPage();
    await page.goto(LESSON);
    const fig = page.locator(".step-diagram").first();
    await fig.locator(".step-diagram__caption").waitFor();
    await page.waitForTimeout(3500);
    assert.equal(await stepOf(fig), "Step 1 of 5", "never advances on its own");
    await fig.getByRole("button", { name: "Play" }).click();
    await page.waitForFunction(() => document.querySelector(".step-diagram__count")?.textContent?.includes("Step 2"), null, { timeout: 6000 });
    await fig.getByRole("button", { name: "Pause" }).click();
    const paused = await stepOf(fig);
    await page.waitForTimeout(3500);
    assert.equal(await stepOf(fig), paused, "stays put after Pause");
    noProblems(problems);
  });

  it("offers no Play button and no transitions under reduced motion, and works in the light theme", async () => {
    const { page, problems } = await h.newPage({ colorScheme: "light" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(LESSON);
    const fig = page.locator(".step-diagram").first();
    await fig.locator(".step-diagram__caption").waitFor();
    assert.equal(await fig.getByRole("button", { name: /Play/ }).count(), 0);
    await fig.getByRole("button", { name: "Next" }).click();
    assert.equal(await stepOf(fig), "Step 2 of 5");
    const duration = await fig.locator("[data-step]").first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    assert.ok(duration < 0.01, `transition should be instant under reduced motion, got ${duration}s`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    await fig.screenshot({ path: join(SHOTS, "step-diagram-light.png") });
    noProblems(problems);
  });

  it("scrolls inside its frame on a phone instead of widening the page", async () => {
    const { page, problems } = await h.newPage({ mobile: true });
    await page.goto(LESSON);
    const fig = page.locator(".step-diagram").first();
    await fig.locator(".step-diagram__caption").waitFor();
    const box = fig.locator(".figure__scroll");
    assert.ok(await box.evaluate((el) => el.scrollWidth > el.clientWidth), "the figure keeps a readable minimum width");
    assert.equal(await box.getAttribute("tabindex"), "0", "the scrolling area is keyboard-focusable");
    await fig.screenshot({ path: join(SHOTS, "step-diagram-mobile.png") });
    noProblems(problems);
  });
});

describe("simulations", () => {
  it("Git: a signed-in learner solves a challenge with the keyboard; the server verifies and saves it", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/register?next=/tracks/git-github/simulations/git-commit-graph");
    await page.getByLabel("Name").fill("Arjun");
    await page.getByLabel("Email").fill("arjun@example.edu");
    await page.getByLabel("Password").fill("orbit lantern cobalt river");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/simulations/git-commit-graph");
    const sim = page.locator(".sim");
    await sim.waitFor();
    assert.ok(await sim.locator(".tag--sim", { hasText: "Simulation" }).isVisible(), "labelled as a simulation");
    await sim.getByText("A teaching model, not the real tool").click();
    await expectText(sim.locator(".sim__limits"), /no files/);

    // Keyboard only: choose the challenge, pick the command, run it.
    await sim.getByRole("button", { name: "Undo a pushed commit safely" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await sim.getByLabel("Scenario").inputValue(), "pushed-mistake");
    await sim.getByLabel("Command", { exact: true }).focus();
    await sim.getByLabel("Command", { exact: true }).selectOption("revert");
    assert.equal(await sim.locator(".git-sim__preview").innerText(), "git revert HEAD");
    await sim.getByRole("button", { name: "Run" }).focus();
    await page.keyboard.press("Enter");
    await sim.locator(".sim__status", { hasText: "Solved and saved to your progress." }).waitFor();
    await expectText(sim.locator(".sim__log li").first(), /Revert "Add broken link"/);
    await expectText(sim.locator(".git-sim__list"), /Revert "Add broken link"/);

    // Commands that cannot work are explained: in the form before running, or in the log when Git would refuse.
    await sim.getByLabel("Command", { exact: true }).selectOption("merge");
    await expectText(sim.locator(".sim__problem"), /no other branch yet/);
    await sim.getByLabel("Command", { exact: true }).selectOption("branch");
    await sim.getByLabel("New branch name").fill("main");
    await sim.getByRole("button", { name: "Run" }).click();
    await expectText(sim.locator('.sim__log li[data-refused="true"]').first(), /A branch named main already exists/);

    await page.reload();
    await sim.getByRole("button", { name: /Undo a pushed commit safely/ }).locator(".tag", { hasText: "Done" }).waitFor();
    await page.screenshot({ path: join(SHOTS, "simulation-git.png"), fullPage: true });
    noProblems(problems);
  });

  it("Kubernetes: Step, text mode and self-healing complete a challenge", async () => {
    const { page, problems } = await h.newPage({ colorScheme: "light" });
    await page.goto("/tracks/kubernetes/simulations/kubernetes-reconciliation");
    const sim = page.locator(".sim");
    await sim.locator(".k8s-sim").waitFor();
    assert.equal(await sim.locator(".k8s-pod").count(), 3);
    await expectText(sim.locator(".k8s-sim__summary"), /3 of 3/);
    await sim.locator(".k8s-pod__delete").first().click();
    await expectText(sim.locator(".k8s-sim__summary"), /2 of 3/);
    for (let i = 0; i < 4; i++) await sim.getByRole("button", { name: "Step" }).click();
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    await expectText(sim.locator(".k8s-sim__summary"), /3 of 3/);
    await expectText(sim.locator(".sim__log"), /ReplicaSet .* wants 3: created/);

    await sim.getByRole("button", { name: "Text mode" }).click();
    assert.equal(await sim.getByRole("button", { name: "Text mode" }).getAttribute("aria-pressed"), "true");
    await expectText(sim.locator(".sim__text"), /Deployment web wants 3 replica\(s\)/);
    await page.screenshot({ path: join(SHOTS, "simulation-kubernetes-light.png"), fullPage: true });
    noProblems(problems);
  });

  it("offers Step but not Play under reduced motion, and Play pauses", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/kubernetes/simulations/kubernetes-reconciliation");
    const sim = page.locator(".sim");
    await sim.locator(".k8s-sim").waitFor();
    await sim.getByRole("button", { name: "Play" }).click();
    await sim.getByRole("button", { name: "Pause" }).click();
    assert.ok(await sim.getByRole("button", { name: "Play" }).isVisible());

    const reduced = await h.newPage();
    await reduced.page.emulateMedia({ reducedMotion: "reduce" });
    await reduced.page.goto("/tracks/kubernetes/simulations/kubernetes-reconciliation");
    const rsim = reduced.page.locator(".sim");
    await rsim.locator(".k8s-sim").waitFor();
    assert.equal(await rsim.getByRole("button", { name: "Play" }).count(), 0);
    assert.ok(await rsim.getByRole("button", { name: "Step" }).isVisible());
    const duration = await rsim.locator(".k8s-pod").first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    assert.ok(duration < 0.01, `no transitions under reduced motion, got ${duration}s`);
    noProblems(problems);
    noProblems(reduced.problems);
  });

  it("Prometheus: rate(sum()) is wrong after a restart, sum(rate()) is right, and a lost le label is explained", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/prometheus-grafana/simulations/prometheus-scrape-and-rate");
    const sim = page.locator(".sim");
    await sim.locator(".prom-sim").waitFor();
    await sim.getByRole("button", { name: "Restart devforge-2" }).click();
    for (let i = 0; i < 2; i++) await sim.getByRole("button", { name: "Step" }).click();
    const wrong = Number((await sim.locator(".prom-sim__result li").innerText()).match(/([\d.]+) per second/)?.[1]);
    assert.ok(wrong > 15, `rate(sum()) overestimates after a restart (got ${wrong})`);
    await sim.getByLabel("Query", { exact: true }).selectOption("sum-rate");
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    await expectText(sim.locator(".prom-sim__result"), /\{\} 15 per second/);
    assert.equal(await sim.locator(".prom-sim__promql").innerText(), "sum(rate(devforge_http_requests_total[1m]))");

    await sim.getByLabel("Scenario").selectOption("latency");
    await sim.getByLabel("Aggregation").selectOption("none");
    await expectText(sim.locator(".prom-sim__result"), /removes the le label/);
    noProblems(problems);
  });

  it("OpenTelemetry: the slow span is found by its own time, and parallel calls shorten the critical path", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/opentelemetry/simulations/opentelemetry-trace-waterfall");
    const sim = page.locator(".sim");
    await sim.locator(".otel-sim__waterfall").waitFor();
    // The gateway's bar is the longest, but it is only waiting for its children.
    await sim.locator(".otel-sim__row", { hasText: "gateway Server" }).click();
    await expectText(sim.locator(".sim__status"), /Not solved/);
    await sim.locator(".otel-sim__row", { hasText: "payment Server" }).focus();
    await page.keyboard.press("Enter");
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("slow-database");
    await expectText(sim.locator(".otel-sim__summary"), /209 ms/);
    await sim.getByLabel("Database and payment calls").selectOption("parallel");
    await sim.getByRole("button", { name: "Send a checkout request" }).click();
    await expectText(sim.locator(".otel-sim__summary"), /: 145 ms/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    assert.equal(await sim.locator('.otel-sim__row[data-critical="true"]', { hasText: "SELECT cart (database)" }).count(), 1, "the slow database is now the critical path");
    noProblems(problems);
  });

  it("Kafka: uneven keys make two members too few; three drain the lag; a fifth member is idle", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/kafka/simulations/kafka-consumer-groups");
    const sim = page.locator(".sim");
    await sim.locator(".kafka-sim").waitFor();
    const lag = async () => Number((await sim.locator(".k8s-sim__summary").innerText()).match(/Total lag\s+(\d+)/)?.[1]);
    assert.equal(await lag(), 10);
    await sim.getByRole("button", { name: "Add a consumer" }).click();
    for (let i = 0; i < 3; i++) await sim.getByRole("button", { name: "Step" }).click();
    assert.ok((await lag()) > 10, "two members: one of them owns both busy partitions");
    await expectText(sim.locator(".kafka-sim__members"), /consumer-2: P1/);
    await sim.getByRole("button", { name: "Add a consumer" }).click();
    for (let i = 0; i < 20 && (await lag()) > 0; i++) await sim.getByRole("button", { name: "Step" }).click();
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("four-partitions");
    await sim.getByRole("button", { name: "Add a consumer" }).click();
    await expectText(sim.locator(".kafka-sim__members"), /consumer-5: idle — no partition/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Airflow: retries rescue a flaky week; a backfill only repairs the data once the task is safe to repeat", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/airflow/simulations/airflow-scheduler-timeline");
    const sim = page.locator(".sim");
    await sim.locator(".airflow-sim").waitFor();
    const runs = sim.locator(".airflow-sim__runs tbody tr");
    await sim.getByLabel("Retries").selectOption("1");
    for (let i = 0; i < 6; i++) await sim.getByRole("button", { name: "Step" }).click();
    assert.equal(await runs.count(), 7);
    await expectText(runs.nth(2), /success\s+scheduled · 2 tries/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("broken-week");
    await expectText(runs.nth(4), /failed/);
    await expectText(runs.nth(4), /6 \/ 13 — wrong/);
    // Re-running the failed dates while the task appends adds the rows on top of the half-written ones.
    await sim.getByLabel("Reprocess").selectOption("failed");
    await sim.getByRole("button", { name: "Create backfill" }).click();
    await expectText(runs.nth(4), /success\s+backfill/);
    await expectText(runs.nth(4), /19 \/ 13 — wrong/);
    assert.doesNotMatch(await sim.locator(".sim__status").innerText(), /^Solved/, "appending again is not a fix");
    await sim.getByLabel("Load task writes by").selectOption("replace");
    await sim.getByLabel("Reprocess").selectOption("completed");
    await sim.getByRole("button", { name: "Create backfill" }).click();
    assert.equal(await sim.locator(".airflow-sim__rows--wrong").count(), 0);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("MLflow: the most accurate run is too slow for the budget; filtering finds the best that fits", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/mlflow/simulations/mlflow-experiment-explorer");
    const sim = page.locator(".sim");
    await sim.locator(".mlflow-sim").waitFor();
    const rows = sim.locator(".mlflow-sim__runs tbody tr");
    assert.equal(await rows.count(), 10);
    await sim.getByLabel("Sort by").selectOption("rmse asc");
    await expectText(rows.first(), /boost-1000/);
    await sim.getByRole("button", { name: "Register boost-1000" }).click();
    await sim.getByRole("button", { name: "Make version 1 champion" }).click();
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("latency-budget");
    await sim.getByLabel("Max latency").selectOption("5");
    await sim.getByLabel("Sort by").selectOption("rmse asc");
    assert.equal(await rows.count(), 7);
    await expectText(rows.first(), /boost-300/);
    await sim.getByRole("button", { name: "Register boost-300" }).click();
    await sim.getByRole("button", { name: "Make version 1 champion" }).click();
    await expectText(sim.locator(".k8s-sim__summary"), /version 1: boost-300/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("RAG: big chunks bury the answer; small chunks and k=3 retrieve it within the budget", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/langchain-llamaindex/simulations/langchain-rag-pipeline");
    const sim = page.locator(".sim");
    await sim.locator(".rag-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await expectText(summary, /not retrieved/);
    await sim.getByLabel("k (chunks retrieved)").selectOption("3");
    await expectText(summary, /in the prompt/);
    await expectText(summary, /133 \/ 70 words/, "found, but the prompt is far too long");
    assert.doesNotMatch(await sim.locator(".sim__status").innerText(), /^Solved/);
    await sim.getByLabel("Chunk size (sentences)").selectOption("1");
    await expectText(summary, /65 \/ 70 words/);
    assert.equal(await sim.locator('.rag-sim__chunk[data-retrieved="true"]').count(), 3);
    await expectText(sim.locator(".rag-sim__prompt pre"), /file: operations\.md\nA cache entry expires when its TTL runs out/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("n8n: invalid items vanish until the false branch is connected; retries rescue a flaky service", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/n8n/simulations/n8n-workflow-executor");
    const sim = page.locator(".sim");
    await sim.locator(".n8n-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /Dropped silently\s+#2 #3 #4/);
    assert.doesNotMatch(await sim.locator(".sim__status").innerText(), /^Solved/);
    await sim.getByLabel("Valid? false output").selectOption("errorWorkflow");
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /Error workflow\s+#2 #3 #4/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("flaky-service");
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /Last execution\s+failed/);
    await sim.getByLabel("Check seats: retries").selectOption("1");
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /Saved\s+#1 #5/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Jira: starting everything misses the sprint goal; a WIP limit meets it; the lesson is marked docs-checked", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/jira/simulations/jira-sprint-board");
    const sim = page.locator(".sim");
    await sim.locator(".sprint-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await expectText(summary, /34 points/);
    for (let i = 0; i < 10; i++) await sim.getByRole("button", { name: "Step" }).click();
    await expectText(summary, /Sprint goal\s+missed/);
    await expectText(summary, /Points left\s+19\.0/);
    await sim.getByRole("button", { name: "Reset" }).click();
    await sim.getByLabel("In Progress WIP limit").selectOption("3");
    for (let i = 0; i < 10; i++) await sim.getByRole("button", { name: "Step" }).click();
    await expectText(summary, /Sprint goal\s+met/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    assert.equal(await sim.getByRole("button", { name: "Remove DEV-8 from the sprint" }).isDisabled(), true, "planning is over once the sprint starts");

    await page.goto("/tracks/jira/lessons/jira-work-items-and-workflows");
    await page.locator(".verified--docs-checked", { hasText: "Checked against official documentation." }).waitFor();
    noProblems(problems);
  });

  it("Docker: copying everything first reinstalls on a code change; reordering makes it a one-second build", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/docker/simulations/docker-layer-cache");
    const sim = page.locator(".sim");
    await sim.locator(".layer-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByRole("button", { name: "Edit the source code" }).click();
    await sim.getByRole("button", { name: "Build", exact: true }).click();
    await expectText(summary, /Last build\s+46 s/);
    await expectText(summary, /secrets\.env/);
    await sim.getByRole("button", { name: "Move COPY requirements.txt /app/ up" }).click();
    await sim.getByRole("button", { name: "Remove COPY . /app/" }).click();
    await sim.getByRole("button", { name: "Add COPY requirements.txt /app/" }).click();
    await sim.getByRole("button", { name: "Add COPY src/ /app/src/" }).click();
    await sim.getByRole("button", { name: "Build", exact: true }).click();
    await sim.getByRole("button", { name: "Edit the source code" }).click();
    await sim.getByRole("button", { name: "Build", exact: true }).click();
    await expectText(summary, /Last build\s+1 s/);
    assert.doesNotMatch(await summary.innerText(), /secrets\.env/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("PostgreSQL: an index on status is ignored; status and day together make the query touch 27 rows", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/postgresql/simulations/postgresql-query-planner");
    const sim = page.locator(".sim");
    await sim.locator(".planner-sim").waitFor();
    await sim.getByLabel("Scenario").selectOption("pending-day");
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByLabel("Index column 1").selectOption("status");
    await sim.getByRole("button", { name: "Create index" }).click();
    await sim.getByRole("button", { name: "Run EXPLAIN" }).click();
    await expectText(summary, /Seq Scan/);
    await expectText(summary, /100,000/);
    await sim.getByLabel("Index column 2").selectOption("day");
    await sim.getByRole("button", { name: "Create index" }).click();
    await sim.getByRole("button", { name: "Run EXPLAIN" }).click();
    await expectText(summary, /Index Scan using orders_status_day_idx/);
    await expectText(summary, /Rows touched\s+27 \(0\.03 %\)/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("PostgreSQL: a lost update at READ COMMITTED; REPEATABLE READ refuses it, and a retry keeps both deposits", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/postgresql/simulations/postgresql-isolation-timeline");
    const sim = page.locator(".sim");
    await sim.locator(".iso-sim").waitFor();
    assert.ok(await sim.locator(".tag--sim", { hasText: "Simulation" }).isVisible(), "labelled as a simulation");
    await sim.getByRole("button", { name: "Keep both deposits" }).click();
    assert.equal(await sim.getByLabel("Scenario").inputValue(), "deposits");
    const timeline = sim.locator(".iso-sim__timeline");
    const runT = (tx: string) => sim.getByRole("button", { name: `Run ${tx}`, exact: true }).click();
    // T1 reads, T2 reads, T1 writes, T2 writes (and waits for T1's row lock), T1 commits, T2 commits.
    for (const tx of ["T1", "T2", "T1", "T2"]) await runT(tx);
    await expectText(timeline, /waiting for the other transaction's row lock/);
    assert.equal(await sim.getByRole("button", { name: "Run T2", exact: true }).isDisabled(), true, "a waiting transaction cannot run");
    for (const tx of ["T1", "T2"]) await runT(tx);
    await expectText(sim.locator(".iso-sim__anomalies"), /Lost update: the committed changes add up to 130, but the balance is 80/);

    // Keyboard only: reset, choose REPEATABLE READ, run the same order; T2 fails and is retried.
    await sim.getByRole("button", { name: "Reset" }).focus();
    await page.keyboard.press("Enter");
    await sim.getByLabel("Isolation level (both transactions)").selectOption("repeatable read");
    for (const tx of ["T1", "T2", "T1", "T2", "T1"]) {
      await sim.getByRole("button", { name: `Run ${tx}`, exact: true }).focus();
      await page.keyboard.press("Enter");
    }
    await expectText(timeline, /ERROR: {2}could not serialize access due to concurrent update/);
    await sim.getByRole("button", { name: "Retry T2" }).click();
    for (let i = 0; i < 3; i++) await runT("T2");
    await expectText(sim.locator(".iso-sim__data"), /1\s*ana\s*130/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await page.screenshot({ path: join(SHOTS, "simulation-postgresql-isolation.png"), fullPage: true });
    // Text mode tells the same story.
    await sim.getByRole("button", { name: "Text mode" }).click();
    await expectText(sim.locator(".sim__text"), /T2: committed \(attempt 2\)/);
    await expectText(sim.locator(".sim__text"), /Committed accounts: 1\|ana\|130\./);
    noProblems(problems);
  });

  it("Terraform: a rename plans destroy and create until a moved block makes it a move; drift is reverted by apply", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/terraform/simulations/terraform-plan-diff");
    const sim = page.locator(".sim");
    await sim.locator(".tfplan-sim").waitFor();
    const planBox = sim.locator(".tfplan-sim__plan");
    await sim.getByRole("button", { name: "Rename", exact: true }).click();
    await expectText(planBox, /Plan: 1 to add, 0 to change, 1 to destroy/);
    await sim.getByRole("button", { name: "Add moved block (server.web → server.frontend)" }).click();
    await expectText(planBox, /Plan: 0 to add, 0 to change, 0 to destroy/);
    await expectText(planBox, /has moved to server\.frontend/);
    await sim.getByRole("button", { name: "terraform apply" }).click();
    await expectText(planBox, /No changes/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();

    await sim.getByLabel("Scenario").selectOption("drift");
    await expectText(planBox, /size changed outside Terraform: medium → large/);
    await sim.getByRole("button", { name: "terraform apply" }).click();
    await expectText(planBox, /No changes/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("GitHub Actions: removing needs that are not real cuts the run to 12 minutes", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/github-actions/simulations/github-actions-workflow-run");
    const sim = page.locator(".sim");
    await sim.locator(".ghrun-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /22 min/);
    const row = (job: string) => sim.locator(".ghrun-sim__needs tbody tr", { has: page.locator(`th:text-is("${job}")`).or(page.locator("th", { hasText: new RegExp(`^${job}`) })) });
    for (const [job, on] of [["build", "lint"], ["e2e", "unit"], ["e2e", "build"], ["docs", "e2e"], ["deploy", "docs"], ["deploy", "unit"], ["deploy", "e2e"]]) await row(job!).getByLabel(on!, { exact: true }).click();
    await sim.getByRole("button", { name: "Run the workflow" }).click();
    await expectText(summary, /12 min/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Redis: the hot key's expiry stampedes the database until single flight is on", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/redis/simulations/redis-cache-load");
    const sim = page.locator(".sim");
    await sim.locator(".cache-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByRole("button", { name: "Run the rest of the minute" }).click();
    await expectText(summary, /272 \/ s/);
    await sim.getByRole("button", { name: "Reset" }).click();
    await sim.getByLabel("Single flight").check();
    await sim.getByRole("button", { name: "Run the rest of the minute" }).click();
    await expectText(summary, /9 \/ s/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Nginx: a regex beats a plain prefix; ^~ serves the docs statically", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/nginx/simulations/nginx-location-matcher");
    const sim = page.locator(".sim");
    await sim.locator(".ngx-sim").waitFor();
    await sim.getByRole("button", { name: "Send request" }).click();
    await expectText(sim.locator(".ngx-sim__log"), /\/api\/docs\/index\.html → location ~ \\\.html\$ \(app\)/);
    await sim.getByLabel("Add a location").selectOption("api-docs-stop");
    await sim.getByRole("button", { name: "Add", exact: true }).click();
    await sim.getByRole("button", { name: "Send request" }).click();
    await expectText(sim.locator(".ngx-sim__log"), /location \^~ \/api\/docs\/ \(static\)/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Postman: sign in with the CSRF header, bookmark with the cookie, read it back", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/postman/simulations/postman-request-builder");
    const sim = page.locator(".sim");
    await sim.locator(".req-sim").waitFor();
    const send = async (endpoint: string, body: string, csrf: boolean, cookie: boolean) => {
      await sim.getByLabel("Request", { exact: true }).selectOption({ label: endpoint });
      await sim.getByLabel("Body").selectOption(body);
      await sim.getByLabel("X-DevForge-CSRF header").setChecked(csrf);
      await sim.getByLabel("Send the session cookie").setChecked(cookie);
      await sim.getByRole("button", { name: "Send", exact: true }).click();
      return sim.locator(".req-sim__response").innerText();
    };
    assert.match(await send("POST /api/auth/login", "valid login", false, false), /→ 403/);
    assert.match(await send("POST /api/auth/login", "valid login", true, false), /→ 200/);
    assert.match(await send("PUT /api/me/bookmarks/track/kafka", "none", true, true), /→ 200/);
    assert.match(await send("GET /api/me/bookmarks", "none", false, true), /kafka/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("Jenkins: builds wait for an agent with their label; two docker executors keep the queue short", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/jenkins/simulations/jenkins-build-queue");
    const sim = page.locator(".sim");
    await sim.locator(".queue-sim").waitFor();
    const summary = sim.locator(".k8s-sim__summary");
    await sim.getByRole("button", { name: "Run the half hour" }).click();
    await expectText(summary, /Longest wait\s+30 min/);
    await sim.getByRole("button", { name: "Reset" }).click();
    await sim.getByLabel("Executors").selectOption("2");
    await sim.getByRole("button", { name: "Add agent" }).click();
    await sim.getByRole("button", { name: "Run the half hour" }).click();
    await expectText(summary, /Longest wait\s+0 min/);
    await sim.locator(".sim__status", { hasText: /^Solved/ }).waitFor();
    noProblems(problems);
  });

  it("is embedded in its lessons and listed on the track page with a working link", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/kubernetes/lessons/kubernetes-services-and-rollouts");
    const embed = page.locator(".sim-embed .sim");
    await embed.locator(".k8s-sim").waitFor();
    assert.equal(await embed.getByRole("heading", { level: 3, name: "The reconciliation loop" }).count(), 1);
    assert.equal(await embed.getByLabel("Scenario").inputValue(), "broken-release");
    await expectText(embed.locator(".k8s-sim__summary"), /4 of 5/, "same stalled state as the real cluster in the lesson");
    assert.equal(await page.locator(".sim-embed__fallback").isVisible(), false);

    await page.goto("/tracks/kubernetes");
    await page.getByRole("heading", { level: 2, name: "Simulations" }).waitFor();
    await page.locator("#simulations").getByRole("link", { name: "The reconciliation loop" }).click();
    await page.waitForURL("**/tracks/kubernetes/simulations/kubernetes-reconciliation");
    await page.getByRole("heading", { level: 1, name: "The reconciliation loop" }).waitFor();
    // A track without a simulation says so (found through the API, so the test survives new simulations).
    const { tracks } = (await (await fetch(`${h.url}/api/tracks`)).json()) as { tracks: { slug: string }[] };
    for (const { slug } of tracks) {
      const { simulations } = (await (await fetch(`${h.url}/api/tracks/${slug}`)).json()) as { simulations: unknown[] };
      if (simulations.length) continue;
      await page.goto(`/tracks/${slug}`);
      await expectText(page.locator("#simulations"), /No simulation is published for this track yet/);
      break;
    }
    noProblems(problems);
  });

  it("stacks its side panel when embedded in an article, so the stage keeps the article's width", async () => {
    // Regression: a viewport media query kept two columns inside a ~630 px lab article, squeezing the Dockerfile
    // editor to ~250 px with one character per line. The layout now follows the simulation's own width.
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/docker/labs/docker-layer-cache-experiments");
    const embed = page.locator(".sim-embed .sim");
    await embed.locator(".layer-sim__file").waitFor();
    const simWidth = (await embed.boundingBox())?.width ?? 0;
    const stageWidth = (await embed.locator(".sim__stage").boundingBox())?.width ?? 0;
    assert.ok(stageWidth > simWidth * 0.8, `stage is ${stageWidth}px of a ${simWidth}px simulation`);
    const line = embed.locator(".layer-sim__line code").first();
    assert.ok(((await line.boundingBox())?.height ?? 999) < 40, "FROM alpine:3.20 fits on one line");
    noProblems(problems);
  });
});
