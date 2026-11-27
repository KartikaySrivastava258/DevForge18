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
import { after, before, describe, it } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { startHarness, type Harness } from "./harness.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Selectors excluded from the audit, each with the reason. Empty on purpose: fix the page instead. */
const EXCLUSIONS: { selector: string; reason: string }[] = [];

interface AuditedPage {
  name: string;
  path: string;
  /** Visible once the page's data has loaded (the audit must not run on a loading skeleton). */
  ready: string;
  signedIn?: boolean;
  /** Phone viewport (390 x 844), where the navigation collapses into a menu and the map into a list. */
  mobile?: boolean;
  /** Puts the page in the state to audit, after it has loaded (for example, opens the menu). */
  prepare?: (page: Page) => Promise<void>;
}

const openMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#primary-nav").waitFor({ state: "visible" });
};

const PAGES: AuditedPage[] = [
  { name: "home", path: "/", ready: ".map-node" },
  { name: "tracks catalogue", path: "/tracks", ready: ".track-row" },
  { name: "track", path: "/tracks/docker", ready: "h1" },
  { name: "lesson", path: "/tracks/docker/lessons/docker-images-vs-containers", ready: "article h2" },
  { name: "lab", path: "/tracks/docker/labs/docker-layer-cache-experiments", ready: "h1" },
  { name: "simulation", path: "/tracks/kubernetes/simulations/kubernetes-reconciliation", ready: "h1" },
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
async function signIn(page: Page): Promise<void> {
  accounts += 1;
  const res = await page.context().request.post("/api/auth/register", {
    headers: { "X-DevForge-CSRF": "1", Origin: h.url },
    data: { email: `axe-${accounts}@example.com`, displayName: "Axe Audit", password: "correct horse battery staple 42" },
  });
  assert.equal(res.status(), 201, `registration for the audit failed: ${await res.text()}`);
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
          if (target.signedIn) await signIn(page);
          await page.goto(target.path);
          await waitUntilReady(page, target.ready);
          if (target.prepare) await target.prepare(page);
          assert.equal(await page.locator("html").getAttribute("data-theme"), scheme, "the page uses the requested colour scheme");

          let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
          for (const { selector } of EXCLUSIONS) builder = builder.exclude(selector);
          const results = await builder.analyze();
          assert.ok(results.passes.length > 0, "axe ran its checks");
          assert.equal(results.violations.length, 0, `axe violations on ${target.path} (${scheme}):\n${describeViolations(results.violations)}`);
          assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);
        } finally {
          await context.close();
        }
      });
    }
  });
}
