/**
 * No dead internal links (release checklist). Crawls every track page, lesson, lab, simulation, quiz, project,
 * capstone, architecture, path and integration page — the list comes from the API, so new content is covered
 * without editing this file — plus the listing and signed-in pages that link to them, and checks every
 * same-origin link it finds, then the links on the pages those lead to, until no new page turns up.
 *
 * A link is alive when:
 *  - an app route renders a real page: an <h1> that is not "Page not found", no error or not-allowed state,
 *    no uncaught script error;
 *  - its #fragment names an element id that exists on the rendered target page;
 *  - anything the app does not route (/api/..., files with an extension such as downloads or /assets/...)
 *    answers HTTP 200.
 *
 * Pages are crawled as a signed-in student with real coursework (a cohort with one assignment of every kind,
 * a submission, bookmarks, a started lesson, a public portfolio), then the staff pages (and their links) as
 * faculty and as an administrator, because those roles see links students do not. External links are checked
 * by `npm run content:check-links`, not here. Links that only appear after an interaction (quiz feedback, a
 * selected map node) are not crawled; the quiz's review-lesson references are validated by the content build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { APIRequestContext, BrowserContext, Page } from "playwright";
import { defaultLimiters } from "../server/src/app.ts";
import { FixedWindowLimiter } from "../server/src/http/rate-limit.ts";
import { startHarness, type Harness } from "./harness.ts";

const PASSWORD = "copper meadow signal 7";
const CONCURRENCY = 6;
/** Generous: a page is normally ready in well under a second, but CI machines can be slow. */
const READY_TIMEOUT_MS = 20_000;

type Role = "student" | "faculty" | "admin";

interface Snapshot {
  status: number;
  /** API calls the page made that were rate limited (a test set-up problem, reported as such). */
  rateLimited: number;
  h1: string | null;
  /** The heading of an error or not-allowed state in <main>, if one is shown. */
  errorState: string | null;
  pageErrors: string[];
  ids: Set<string>;
  links: string[];
}

interface Target {
  /** Origin-relative path and query, without the fragment. */
  key: string;
  /** Pages linking here (any fragment). */
  sources: Set<string>;
  /** fragment (decoded, without "#") → pages linking to it. */
  fragments: Map<string, Set<string>>;
}

let h: Harness;
before(async () => {
  // The crawler is one client loading ~400 pages (several API calls each) in well under a minute, far past the
  // per-IP API guard (1200 a minute, ADR 0004), which would turn pages into "Too many requests" error states.
  // Only that guard is raised; rate limiting has its own tests.
  h = await startHarness({}, { limiters: { ...defaultLimiters(), api: new FixedWindowLimiter(1_000_000, 60_000) } });
});
after(() => h.close());

const headers = () => ({ "X-DevForge-CSRF": "1", Origin: h.url });

async function call<T = unknown>(api: APIRequestContext, method: string, path: string, data?: unknown): Promise<T> {
  const res = await api.fetch(path, { method, headers: headers(), ...(data === undefined ? {} : { data }) });
  assert.ok(res.ok(), `${method} ${path}: HTTP ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? null : await res.json()) as T;
}

async function signedInContext(role: Role, email: string): Promise<BrowserContext> {
  const context = await h.browser.newContext({ baseURL: h.url, viewport: { width: 1360, height: 900 } });
  if (role === "student") {
    await call(context.request, "POST", "/api/auth/register", { email, displayName: "Link Checker", password: PASSWORD });
  } else {
    await h.createUser({ email, name: `Link Checker (${role})`, password: PASSWORD, role });
    await call(context.request, "POST", "/api/auth/login", { email, password: PASSWORD });
  }
  return context;
}

/** Every content page, from the API. Checked against build/content.json so nothing is silently left out. */
async function contentPages(api: APIRequestContext): Promise<string[]> {
  const bundle = JSON.parse(readFileSync(join(import.meta.dirname, "..", "build", "content.json"), "utf8")) as Record<string, unknown[]>;
  const pages: string[] = [];
  const counts = { tracks: 0, lessons: 0, labs: 0, simulations: 0, quizzes: 0, projects: 0, capstones: 0, architectures: 0, paths: 0, integrations: 0 };

  const { tracks } = await call<{ tracks: { slug: string }[] }>(api, "GET", "/api/tracks");
  for (const { slug } of tracks) {
    const t = await call<{
      lessons: { id: string }[];
      labs: { id: string }[];
      simulations: { id: string }[];
      projects: { id: string }[];
      quiz: unknown;
    }>(api, "GET", `/api/tracks/${slug}`);
    pages.push(`/tracks/${slug}`);
    counts.tracks += 1;
    for (const l of t.lessons) pages.push(`/tracks/${slug}/lessons/${l.id}`);
    for (const l of t.labs) pages.push(`/tracks/${slug}/labs/${l.id}`);
    for (const s of t.simulations) pages.push(`/tracks/${slug}/simulations/${s.id}`);
    for (const p of t.projects) pages.push(`/tracks/${slug}/projects/${p.id}`);
    if (t.quiz) pages.push(`/tracks/${slug}/quiz`);
    counts.lessons += t.lessons.length;
    counts.labs += t.labs.length;
    counts.simulations += t.simulations.length;
    counts.projects += t.projects.length;
    counts.quizzes += t.quiz ? 1 : 0;
  }
  const { capstones } = await call<{ capstones: { id: string }[] }>(api, "GET", "/api/capstones");
  for (const c of capstones) pages.push(`/capstones/${c.id}`);
  counts.capstones = capstones.length;
  const { architectures } = await call<{ architectures: { id: string }[] }>(api, "GET", "/api/architectures");
  for (const a of architectures) pages.push(`/architecture/${a.id}`);
  counts.architectures = architectures.length;
  const { paths } = await call<{ paths: { slug: string }[] }>(api, "GET", "/api/paths");
  for (const p of paths) pages.push(`/paths/${p.slug}`);
  counts.paths = paths.length;
  const graph = await call<{ edges: { integration: { id: string } | null }[] }>(api, "GET", "/api/graph");
  for (const e of graph.edges) if (e.integration) pages.push(`/integrations/${e.integration.id}`);
  counts.integrations = graph.edges.filter((e) => e.integration).length;

  for (const [kind, n] of Object.entries(counts)) {
    const inBundle = (bundle[kind] ?? []).length;
    assert.equal(n, inBundle, `the API lists ${n} ${kind} but build/content.json has ${inBundle}`);
  }
  return pages;
}

/** Waits until <main> shows the route's content (its h1, or an error state) with no loading skeleton left. */
const READY = `(() => {
  const main = document.querySelector("main");
  if (!main || main.querySelector(".skeleton-lines")) return false;
  return !!(main.querySelector("h1") || main.querySelector(".state[role=alert]"));
})()`;

const SNAPSHOT = `(() => {
  const main = document.querySelector("main");
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  for (const a of document.querySelectorAll("a[name]")) ids.push(a.getAttribute("name"));
  const links = [];
  for (const a of document.querySelectorAll("a")) {
    const raw = a.getAttribute("href") ?? a.getAttribute("xlink:href");
    if (raw === null) continue;
    try { links.push(new URL(raw, document.baseURI).href); } catch { links.push("invalid:" + raw); }
  }
  return {
    h1: main?.querySelector("h1")?.textContent?.trim() ?? null,
    errorState: main?.querySelector(".state[role=alert] h2")?.textContent?.trim() ?? null,
    ids,
    links,
  };
})()`;

async function snapshot(page: Page, path: string): Promise<Snapshot> {
  const pageErrors: string[] = [];
  const onError = (e: Error) => pageErrors.push(e.message);
  let rateLimited = 0;
  const onResponse = (r: { status: () => number }) => {
    if (r.status() === 429) rateLimited += 1;
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  try {
    // networkidle: the route's API calls (and any that depend on them) have finished, so late links are rendered.
    const res = await page.goto(path, { waitUntil: "networkidle" });
    const status = res?.status() ?? 0;
    if (status !== 200) return { status, rateLimited, h1: null, errorState: null, pageErrors, ids: new Set(), links: [] };
    await page.waitForFunction(READY, undefined, { timeout: READY_TIMEOUT_MS });
    const s = (await page.evaluate(SNAPSHOT)) as { h1: string | null; errorState: string | null; ids: string[]; links: string[] };
    return { status, rateLimited, h1: s.h1, errorState: s.errorState, pageErrors, ids: new Set(s.ids), links: s.links };
  } finally {
    page.off("pageerror", onError);
    page.off("response", onResponse);
  }
}

/** Why the page is not a real page, or null when it is. */
function deadReason(s: Snapshot): string | null {
  if (s.rateLimited) return `${s.rateLimited} API call(s) were rate limited (HTTP 429): the test's rate limiter is too low, not a dead link`;
  if (s.status !== 200) return `HTTP ${s.status}`;
  if (s.h1 === "Page not found") return "renders Page not found";
  if (s.errorState) return `renders the error state "${s.errorState}"`;
  if (!s.h1) return "renders no <h1>";
  if (s.pageErrors.length) return `script error: ${s.pageErrors.join("; ")}`;
  return null;
}

/** Paths the single-page app does not route: the API and files (anything whose last segment has an extension). */
const isFile = (pathname: string) => pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(pathname.split("/").pop() ?? "");

interface CrawlResult {
  pages: number;
  links: number;
  dead: string[];
}

/**
 * Visits the seeds and checks every same-origin link on them, with CONCURRENCY tabs in one context. When
 * `transitive`, the links on the pages they lead to are checked too, until no new page turns up.
 * Returns every dead link with the pages that link to it.
 */
async function crawl(context: BrowserContext, role: Role, seeds: string[], transitive: boolean): Promise<CrawlResult> {
  const origin = new URL(h.url).origin;
  const visited = new Map<string, Snapshot>();
  const targets = new Map<string, Target>();
  const files = new Map<string, number>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (key: string) => {
    if (!queued.has(key)) {
      queued.add(key);
      queue.push(key);
    }
  };
  const target = (key: string): Target => {
    let t = targets.get(key);
    if (!t) targets.set(key, (t = { key, sources: new Set(), fragments: new Map() }));
    return t;
  };
  const invalid: { href: string; source: string }[] = [];

  for (const s of seeds) enqueue(s);
  const seedSet = new Set(seeds);
  const tabs = await Promise.all(Array.from({ length: CONCURRENCY }, () => context.newPage()));
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (queue.length === 0 && active === 0) return resolve();
      while (queue.length && tabs.length) {
        const key = queue.shift() as string;
        const tab = tabs.pop() as Page;
        active += 1;
        snapshot(tab, key)
          .then((s) => {
            visited.set(key, s);
            if (deadReason(s)) return; // A dead page's links (the not-found page's) are not followed.
            if (!transitive && !seedSet.has(key)) return;
            for (const href of s.links) {
              if (href.startsWith("invalid:")) {
                invalid.push({ href: href.slice(8), source: key });
                continue;
              }
              const url = new URL(href);
              if (url.origin !== origin) continue; // External: checked by content:check-links.
              const k = url.pathname + url.search;
              const t = target(k);
              t.sources.add(key);
              if (url.hash.length > 1) {
                let fragment = url.hash.slice(1);
                try {
                  fragment = decodeURIComponent(fragment);
                } catch {
                  /* keep it raw: it will not match an id and is reported */
                }
                const set = t.fragments.get(fragment) ?? new Set<string>();
                set.add(key);
                t.fragments.set(fragment, set);
              }
              if (!isFile(url.pathname)) enqueue(k);
            }
          })
          .catch((err: unknown) => {
            visited.set(key, { status: -1, rateLimited: 0, h1: null, errorState: `did not finish loading (${(err as Error).message.split("\n")[0]})`, pageErrors: [], ids: new Set(), links: [] });
          })
          .finally(() => {
            active -= 1;
            tabs.push(tab);
            pump();
          })
          .catch(reject);
      }
    };
    pump();
  });
  await Promise.all(tabs.map((t) => t.close()));

  // Files and API links: fetched with the same cookies, eight at a time.
  const fileKeys = [...targets.keys()].filter((k) => isFile(new URL(k, origin).pathname));
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let k = fileKeys.shift(); k !== undefined; k = fileKeys.shift()) {
        const res = await context.request.get(k, { maxRedirects: 0 });
        files.set(k, res.status());
        await res.dispose();
      }
    }),
  );

  const dead: string[] = [];
  const from = (sources: Set<string>) => {
    const list = [...sources].sort();
    return list.slice(0, 15).map((s) => `      ${s}`).join("\n") + (list.length > 15 ? `\n      … and ${list.length - 15} more` : "");
  };
  for (const t of [...targets.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const fileStatus = files.get(t.key);
    let reason: string | null;
    let ids: Set<string> | undefined;
    if (fileStatus !== undefined) {
      reason = fileStatus === 200 ? null : `HTTP ${fileStatus}`;
    } else {
      const s = visited.get(t.key);
      reason = s ? deadReason(s) : "was never visited (crawler bug)";
      ids = s?.ids;
    }
    if (reason) {
      dead.push(`  ${t.key} — ${reason}\n    linked from:\n${from(t.sources)}`);
      continue;
    }
    for (const [fragment, sources] of t.fragments) {
      if (!ids?.has(fragment)) dead.push(`  ${t.key}#${fragment} — no element with id "${fragment}" on the page\n    linked from:\n${from(sources)}`);
    }
  }
  for (const { href, source } of invalid) dead.push(`  ${href} — not a valid URL\n    linked from:\n      ${source}`);
  // A seed that is itself dead is a broken page even if nothing links to it.
  for (const s of seeds) {
    const snap = visited.get(s);
    const reason = snap ? deadReason(snap) : "was never visited";
    if (reason && !targets.has(s)) dead.push(`  ${s} — ${reason}\n    (a seed page: listed by the API)`);
  }
  const fragments = [...targets.values()].reduce((n, t) => n + t.fragments.size, 0);
  console.log(
    `[internal links, ${role}] ${visited.size} pages rendered, ${targets.size} unique internal link targets ` +
      `(${files.size} files or API URLs) and ${fragments} unique #fragments checked, ${dead.length} dead`,
  );
  return { pages: visited.size, links: targets.size, dead };
}

describe("internal links", () => {
  it("every internal link on every page leads to a real page, an existing #fragment, or a file that loads", { timeout: 15 * 60_000 }, async () => {
    const started = Date.now();
    const student = await signedInContext("student", "links-student@example.com");
    const faculty = await signedInContext("faculty", "links-faculty@example.com");
    const admin = await signedInContext("admin", "links-admin@example.com");
    try {
      // Coursework, so the signed-in pages show the links they build: one assignment of every kind (the server
      // builds each item's href), a project submission, an architecture decision, bookmarks of every type,
      // a started lesson and a public portfolio.
      const { cohort } = await call<{ cohort: { id: string; joinCode: string } }>(faculty.request, "POST", "/api/cohorts", { name: "Link check cohort", description: "Every kind of assignment" });
      const { items } = await call<{ items: { kind: string; id: string; track: string | null }[] }>(faculty.request, "GET", "/api/assignable");
      const kinds = [...new Set(items.map((i) => i.kind))];
      for (const kind of kinds) {
        const item = items.find((i) => i.kind === kind);
        if (item) await call(faculty.request, "POST", `/api/cohorts/${cohort.id}/assignments`, { kind, itemId: item.id, dueAt: "2030-01-15T12:00:00Z", instructions: "" });
      }
      await call(student.request, "POST", "/api/cohorts/join", { code: cohort.joinCode });
      const project = items.find((i) => i.kind === "project");
      const capstone = items.find((i) => i.kind === "capstone");
      const architecture = items.find((i) => i.kind === "architecture");
      const lesson = items.find((i) => i.kind === "lesson");
      assert.ok(project && capstone && architecture && lesson, "the assignable list has projects, capstones, architectures and lessons");
      const { submission } = await call<{ submission: { id: string } }>(student.request, "PUT", `/api/me/submissions/project/${project.id}`, { repositoryUrl: "https://git.example.edu/learner/project", notes: "" });
      await call(student.request, "PUT", `/api/me/submissions/capstone/${capstone.id}`, { repositoryUrl: "https://git.example.edu/learner/capstone", notes: "" });
      await call(student.request, "PUT", `/api/me/decisions/${architecture.id}`, { title: "Cache reads", context: "Slow pages.", decision: "Add a cache.", consequences: "Stale reads.", status: "submitted" });
      await call(student.request, "POST", `/api/lessons/${lesson.id}/start`);
      await call(student.request, "PUT", `/api/me/bookmarks/lesson/${lesson.id}`);
      await call(student.request, "PUT", `/api/me/bookmarks/track/${lesson.track}`);
      const { paths } = await call<{ paths: { slug: string }[] }>(student.request, "GET", "/api/paths");
      if (paths[0]) await call(student.request, "PUT", `/api/me/bookmarks/path/${paths[0].slug}`);
      await call(student.request, "PUT", "/api/me/portfolio", { isPublic: true, slug: "link-checker", headline: "Checking links" });

      const listings = ["/", "/tracks", "/paths", "/capstones", "/architecture", "/graph", "/search?q=docker"];
      const content = await contentPages(student.request);
      const studentPages = [...listings, ...content, "/dashboard", "/cohorts", `/cohorts/${cohort.id}`, "/portfolio/link-checker"];
      const staffPages = ["/", "/dashboard", "/cohorts", `/cohorts/${cohort.id}`, "/reviews", `/reviews/submission/${submission.id}`, "/content-editor", project.track ? `/tracks/${project.track}/projects/${project.id}` : "/tracks"];

      const results = [
        // Students can open every content page, so the whole site is crawled as one.
        await crawl(student, "student", studentPages, true),
        // Staff see the same content plus pages of their own: check the links on those.
        await crawl(faculty, "faculty", staffPages, false),
        await crawl(admin, "admin", ["/admin", "/content-editor", "/reviews"], false),
      ];
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const dead = results.flatMap((r) => r.dead);
      console.log(`[internal links] ${results.reduce((n, r) => n + r.pages, 0)} page visits, ${results.reduce((n, r) => n + r.links, 0)} link targets checked in ${seconds} s`);
      assert.ok(results[0] && results[0].pages >= content.length, "every content page was crawled");
      assert.equal(dead.length, 0, `${dead.length} dead internal link(s):\n${dead.join("\n")}`);
    } finally {
      await Promise.all([student.close(), faculty.close(), admin.close()]);
    }
  });
});
