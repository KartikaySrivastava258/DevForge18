/**
 * Automated accessibility audit: axe-core (WCAG 2.0 and 2.1, levels A and AA) on every main page, in both colour
 * schemes the site supports (dark is the default; light follows prefers-color-scheme or the saved choice).
 *
 * No axe rule is disabled and no element is excluded. If an exclusion is ever unavoidable, add it to
 * EXCLUSIONS below with the reason, and record it in docs/accessibility.md.
 *
 * Automated checks find roughly a third to a half of WCAG problems; the manual screen-reader checklist in
 * docs/accessibility.md covers the rest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { request as playwrightRequest, type Page } from "playwright";
import { startHarness, type Harness } from "./harness.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Selectors excluded from the audit, each with the reason. Empty on purpose: fix the page instead. */
const EXCLUSIONS: { selector: string; reason: string }[] = [];

interface AuditedPage {
  name: string;
  path: string;
  /** Visible once the page's data has loaded (the audit must not run on a loading skeleton). */
  ready: string;
  /** true: a new student account; "faculty" or "admin": an account with that role (created in the database). */
  signedIn?: boolean | "faculty" | "admin";
  /** Creates the data the page shows (after signing in) and returns the path to audit instead of `path`. */
  setup?: (page: Page) => Promise<string>;
  /** Phone viewport (390 x 844), where the navigation collapses into a menu and the map into a list. */
  mobile?: boolean;
  /** Puts the page in the state to audit, after it has loaded (for example, opens the menu). */
  prepare?: (page: Page) => Promise<void>;
  /** Failed requests this page is meant to make (an API 404 for an id that does not exist); every other problem still fails the audit. */
  expectedProblems?: RegExp[];
}

const openMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#primary-nav").waitFor({ state: "visible" });
};

/** Sends the playground's default request (GET /api/health), so the response panel is audited too. */
const sendPlaygroundRequest = async (page: Page) => {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".playground__resp-body").waitFor();
};

const PAGES: AuditedPage[] = [
  { name: "home", path: "/", ready: ".map-node" },
  { name: "tracks catalogue", path: "/tracks", ready: ".track-row" },
  { name: "track", path: "/tracks/docker", ready: "h1" },
  { name: "track with a completed lesson (signed in)", path: "/tracks/git-github", ready: "#lessons .tag--done", signedIn: true, setup: completeFirstGitLesson },
  { name: "track at phone width", path: "/tracks/git-github", ready: "#practice", mobile: true },
  { name: "lesson", path: "/tracks/docker/lessons/docker-images-vs-containers", ready: "article h2" },
  { name: "lab", path: "/tracks/docker/labs/docker-layer-cache-experiments", ready: "h1" },
  { name: "simulation", path: "/tracks/kubernetes/simulations/kubernetes-reconciliation", ready: "h1" },
  { name: "request playground with a response (signed in)", path: "/tracks/postman/playground", ready: "#pg-path", signedIn: true, prepare: sendPlaygroundRequest },
  // After a dozen statements the event log scrolls, so it must be keyboard-reachable; also audits the timeline table with a wait and an error.
  {
    name: "simulation with a long event log",
    path: "/tracks/postgresql/simulations/postgresql-isolation-timeline?scenario=deposits",
    ready: ".iso-sim",
    prepare: async (page) => {
      await page.getByLabel("Isolation level (both transactions)").selectOption("repeatable read");
      for (const tx of ["T1", "T2", "T1", "T2", "T1"]) await page.getByRole("button", { name: `Run ${tx}`, exact: true }).click();
      await page.getByRole("button", { name: "Retry T2" }).click();
      for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Run T2", exact: true }).click();
    },
  },
  { name: "quiz (signed out)", path: "/tracks/git-github/quiz", ready: "h1" },
  { name: "quiz (signed in)", path: "/tracks/git-github/quiz", ready: "fieldset", signedIn: true },
  { name: "project", path: "/tracks/docker/projects/docker-notes-api", ready: "h1" },
  { name: "capstones", path: "/capstones", ready: "h1" },
  { name: "capstone", path: "/capstones/capstone-a", ready: "h1" },
  { name: "relationship graph", path: "/graph", ready: "h1" },
  { name: "architecture studio", path: "/architecture", ready: "h1" },
  { name: "architecture", path: "/architecture/web-app-with-cache", ready: "h1" },
  { name: "paths", path: "/paths", ready: "h1" },
  { name: "path", path: "/paths/backend-foundations", ready: "h1" },
  { name: "search", path: "/search?q=docker", ready: "h1" },
  { name: "sign-in", path: "/login", ready: "h1" },
  { name: "registration", path: "/register", ready: "h1" },
  { name: "dashboard (signed in)", path: "/dashboard", ready: "h1", signedIn: true },
  { name: "page not found", path: "/definitely/not/here", ready: "h1" },
  { name: "cohorts (signed in)", path: "/cohorts", ready: "#join-code", signedIn: true },
  { name: "cohort as its teacher", path: "/cohorts", ready: ".join-code", signedIn: "faculty", setup: (page) => teacherWithSubmission(page).then((r) => `/cohorts/${r.cohortId}`) },
  { name: "review queue", path: "/reviews", ready: "table", signedIn: "faculty", setup: async (page) => (await teacherWithSubmission(page), "/reviews") },
  { name: "review form with the rubric", path: "/reviews", ready: "fieldset.rubric-row", signedIn: "faculty", setup: (page) => teacherWithSubmission(page).then((r) => `/reviews/submission/${r.submissionId}`) },
  { name: "public portfolio", path: "/", ready: "h1", setup: publicPortfolio },
  { name: "certificate verification", path: "/", ready: "h1", setup: () => issuedCertificate() },
  { name: "revoked certificate", path: "/", ready: ".notice--danger", setup: () => issuedCertificate({ revoke: true }) },
  {
    name: "unknown certificate",
    path: "/certificates/0000000000000000",
    ready: "h1",
    expectedProblems: [/^HTTP 404 .*\/api\/certificates\/0000000000000000$/, /^console error: Failed to load resource: .* 404 \(Not Found\)$/],
  },
  { name: "administration", path: "/admin", ready: "table", signedIn: "admin" },
  { name: "content editor", path: "/content-editor", ready: "h1", signedIn: "faculty" },
  { name: "home at phone width, menu open", path: "/", ready: ".map-list", mobile: true, prepare: openMenu },
  { name: "lesson at phone width", path: "/tracks/docker/lessons/docker-images-vs-containers", ready: "article h2", mobile: true },
  { name: "quiz at phone width (signed in)", path: "/tracks/git-github/quiz", ready: "fieldset", signedIn: true, mobile: true },
  { name: "project at phone width", path: "/tracks/docker/projects/docker-notes-api", ready: "h1", mobile: true },
  { name: "dashboard at phone width, menu open (signed in)", path: "/dashboard", ready: "h1", signedIn: true, mobile: true, prepare: openMenu },
];

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

let accounts = 0;
async function signIn(page: Page, role: true | "faculty" | "admin" = true): Promise<void> {
  accounts += 1;
  if (role !== true) {
    const email = `axe-${role}-${accounts}@example.com`;
    await h.createUser({ email, name: `Axe ${role}`, password: "correct horse battery staple 42", role });
    const login = await page.context().request.post("/api/auth/login", { headers: { "X-DevForge-CSRF": "1", Origin: h.url }, data: { email, password: "correct horse battery staple 42" } });
    assert.equal(login.status(), 200, `sign-in for the audit failed: ${await login.text()}`);
    return;
  }
  const res = await page.context().request.post("/api/auth/register", {
    headers: { "X-DevForge-CSRF": "1", Origin: h.url },
    data: { email: `axe-${accounts}@example.com`, displayName: "Axe Audit", password: "correct horse battery staple 42" },
  });
  assert.equal(res.status(), 201, `registration for the audit failed: ${await res.text()}`);
}

/** A separate signed-in student (its own cookie jar) for pages that show another person's work. */
async function student(): Promise<{ post: (path: string, data: unknown, method?: string) => Promise<unknown>; dispose: () => Promise<void> }> {
  accounts += 1;
  const ctx = await playwrightRequest.newContext({ baseURL: h.url, extraHTTPHeaders: { "X-DevForge-CSRF": "1", Origin: h.url } });
  const reg = await ctx.post("/api/auth/register", { data: { email: `axe-student-${accounts}@example.com`, displayName: `Learner ${accounts}`, password: "correct horse battery staple 42" } });
  assert.equal(reg.status(), 201);
  return {
    post: async (path, data, method = "POST") => {
      const r = await ctx.fetch(path, { method, data });
      assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`);
      return r.json().catch(() => null);
    },
    dispose: () => ctx.dispose(),
  };
}

/** The signed-in teacher creates a cohort with an assignment; a student joins and submits the project. */
async function teacherWithSubmission(page: Page): Promise<{ cohortId: string; submissionId: string }> {
  const api = page.context().request;
  const headers = { "X-DevForge-CSRF": "1", Origin: h.url };
  const created = await (await api.post("/api/cohorts", { headers, data: { name: "Accessibility cohort", description: "Audit data" } })).json();
  const { id, joinCode } = created.cohort as { id: string; joinCode: string };
  const assigned = await api.post(`/api/cohorts/${id}/assignments`, { headers, data: { kind: "project", itemId: "docker-notes-api", dueAt: "2030-01-15T12:00:00Z", instructions: "Submit a link to your repository." } });
  assert.equal(assigned.status(), 201);
  const s = await student();
  await s.post("/api/cohorts/join", { code: joinCode });
  const sub = (await s.post("/api/me/submissions/project/docker-notes-api", { repositoryUrl: "https://git.example.edu/learner/notes-api", notes: "Ready for review." }, "PUT")) as { submission: { id: string } };
  await s.dispose();
  return { cohortId: id, submissionId: sub.submission.id };
}

/** The signed-in learner passes the first Git lesson's self-check, so the track page shows a completion tick. */
async function completeFirstGitLesson(page: Page): Promise<string> {
  const bundle = JSON.parse(readFileSync(join(import.meta.dirname, "..", "build", "content.json"), "utf8")) as { lessons: { id: string; self_check: { id: string; answer: string }[] }[] };
  const lesson = bundle.lessons.find((l) => l.id === "git-what-and-why");
  assert.ok(lesson, "the first Git lesson exists");
  const answers = Object.fromEntries(lesson.self_check.map((q) => [q.id, q.answer]));
  const res = await page.context().request.post(`/api/lessons/${lesson.id}/check`, { headers: { "X-DevForge-CSRF": "1", Origin: h.url }, data: { answers } });
  assert.equal(res.status(), 200, await res.text());
  assert.equal(((await res.json()) as { saved: boolean; passed: boolean }).passed, true);
  return "/tracks/git-github";
}

/** A student publishes a portfolio; the audit visits it signed out. */
async function publicPortfolio(): Promise<string> {
  const s = await student();
  const slug = `axe-portfolio-${accounts}`;
  await s.post("/api/me/portfolio", { isPublic: true, slug, headline: "Learning DevOps" }, "PUT");
  await s.dispose();
  return `/portfolio/${slug}`;
}

/**
 * A student earns the Kubernetes certificate; the audit visits its public verification page signed out.
 * Passing the quiz and verifying both labs through the browser would take minutes, so that evidence is seeded in
 * the database exactly as server/test/api-institution.test.ts does; the certificate itself is issued by the real API.
 */
async function issuedCertificate(opts: { revoke?: boolean } = {}): Promise<string> {
  accounts += 1;
  const ctx = await playwrightRequest.newContext({ baseURL: h.url, extraHTTPHeaders: { "X-DevForge-CSRF": "1", Origin: h.url } });
  const reg = await ctx.post("/api/auth/register", { data: { email: `axe-certified-${accounts}@example.com`, displayName: "Certified Learner", password: "correct horse battery staple 42" } });
  assert.equal(reg.status(), 201);
  const userId = ((await reg.json()) as { user: { id: string } }).user.id;
  const status = (await (await ctx.get("/api/me/certificates")).json()) as { tracks: { track: string; labs: { id: string }[] }[] };
  const k8s = status.tracks.find((t) => t.track === "kubernetes");
  assert.ok(k8s, "the Kubernetes track offers a certificate");
  const now = new Date().toISOString();
  h.db.prepare("INSERT INTO quiz_attempts (user_id, quiz_id, track_slug, score, passed, attempted_at) VALUES (?, 'kubernetes-quiz', 'kubernetes', 0.9, 1, ?)").run(userId, now);
  for (const lab of k8s.labs) {
    h.db.prepare("INSERT INTO lab_progress (user_id, lab_id, track_slug, evidence, completed_at) VALUES (?, ?, 'kubernetes', 'verified', ?)").run(userId, lab.id, now);
  }
  const issued = await ctx.post("/api/me/certificates/kubernetes");
  assert.equal(issued.status(), 201, await issued.text());
  const id = ((await issued.json()) as { certificate: { id: string } }).certificate.id;
  await ctx.dispose();
  if (opts.revoke) {
    const email = `axe-revoker-${accounts}@example.com`;
    await h.createUser({ email, name: "Axe Revoker", password: "correct horse battery staple 42", role: "admin" });
    const admin = await playwrightRequest.newContext({ baseURL: h.url, extraHTTPHeaders: { "X-DevForge-CSRF": "1", Origin: h.url } });
    assert.equal((await admin.post("/api/auth/login", { data: { email, password: "correct horse battery staple 42" } })).status(), 200);
    assert.equal((await admin.post(`/api/certificates/${id}/revoke`)).status(), 204);
    await admin.dispose();
  }
  return `/certificates/${id}`;
}

/** Waits for the page's own content, not just the app shell: the route's heading and, when given, its data. */
async function waitUntilReady(page: Page, ready: string): Promise<void> {
  await page.locator("main h1").first().waitFor();
  await page.locator(ready).first().waitFor();
  await page.waitForLoadState("networkidle");
  // Let entrance transitions (opacity, colour) finish, so contrast is measured on the final colours.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

function describeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.replace(/\n/g, "\n      ")}`)
        .join("\n");
      return `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s))\n${nodes}`;
    })
    .join("\n");
}

for (const scheme of ["dark", "light"] as const) {
  describe(`accessibility audit, ${scheme} colour scheme (axe-core, WCAG 2.1 A and AA)`, () => {
    for (const target of PAGES) {
      it(`${target.name} (${target.path}) has no axe violations`, async () => {
        const { page, context, problems } = await h.newPage({ colorScheme: scheme, mobile: target.mobile });
        try {
          if (target.signedIn) await signIn(page, target.signedIn);
          const path = target.setup ? await target.setup(page) : target.path;
          await page.goto(path);
          await waitUntilReady(page, target.ready);
          if (target.prepare) await target.prepare(page);
          assert.equal(await page.locator("html").getAttribute("data-theme"), scheme, "the page uses the requested colour scheme");

          let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
          for (const { selector } of EXCLUSIONS) builder = builder.exclude(selector);
          const results = await builder.analyze();
          assert.ok(results.passes.length > 0, "axe ran its checks");
          assert.equal(results.violations.length, 0, `axe violations on ${path} (${scheme}):\n${describeViolations(results.violations)}`);
          const unexpected = problems.filter((p) => !target.expectedProblems?.some((re) => re.test(p)));
          assert.deepEqual(unexpected, [], `browser problems:\n${unexpected.join("\n")}`);
        } finally {
          await context.close();
        }
      });
    }
  });
}
