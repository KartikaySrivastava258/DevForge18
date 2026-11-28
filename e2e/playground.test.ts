/**
 * The Postman track's live request playground: real requests from the browser to this server, as the learner.
 * A 200, a write without the CSRF header (the server's real 403, explained), an anonymous request (401), and a
 * disallowed path that is refused before anything is sent.
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

/** Chromium logs every 4xx answer to fetch() as a console error; these tests cause them on purpose. */
const unexpected = (problems: string[], ...allowed: number[]) =>
  problems.filter((p) => !allowed.some((status) => p.includes(`status of ${status}`) || p.startsWith(`HTTP ${status} `)));

async function signIn(page: Page): Promise<void> {
  const res = await page.context().request.post("/api/auth/register", {
    headers: { "X-DevForge-CSRF": "1", Origin: h.url },
    data: { email: `playground-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`, displayName: "Playground Learner", password: "correct horse battery staple 42" },
  });
  assert.equal(res.status(), 201, await res.text());
}

describe("request playground (Postman track)", () => {
  it("is labelled as real requests, and sends a real GET that answers 200", async () => {
    const { page, problems } = await h.newPage();
    await signIn(page);
    await page.goto("/tracks/postman/playground");
    await page.getByRole("heading", { level: 1, name: "Request playground" }).waitFor();
    await expectText(page.locator(".playground__label"), /Playground — these are real requests to this DevForge server, as you\.[\s\S]*signed in as Playground Learner/);
    // The CSRF header is there from the start, visible and editable.
    assert.equal(await page.getByLabel("Header 1 name").inputValue(), "X-DevForge-CSRF");
    assert.equal(await page.getByLabel("Header 1 value").inputValue(), "1");

    // Keyboard only: type the path and press Enter.
    await page.getByLabel("Method").selectOption("GET");
    await page.getByLabel("Path", { exact: true }).fill("/api/tracks/postman");
    const response = page.waitForResponse((r) => r.url().endsWith("/api/tracks/postman"));
    await page.getByLabel("Path", { exact: true }).press("Enter");
    assert.equal((await response).status(), 200);
    const status = page.locator(".playground__result").getByRole("status");
    await expectText(status, /GET \/api\/tracks\/postman → 200 OK/);
    const result = page.locator(".playground__result");
    await expectText(result.locator(".playground__resp-headers"), /content-type\s+application\/json/);
    await expectText(result.locator(".playground__resp-body"), /"slug": "postman"/);
    await expectText(page.locator("#pg-remaining"), /19 of 20 requests left this minute/);

    // The learner's own data, with the session cookie.
    await page.getByRole("button", { name: "My bookmarks (401 if signed out)" }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expectText(status, /GET \/api\/me\/bookmarks → 200 OK/);
    noProblems(problems);
  });

  it("shows the server's real 403 when the learner removes the CSRF header, and explains it", async () => {
    const { page, problems } = await h.newPage();
    await signIn(page);
    await page.goto("/tracks/postman/playground");
    await page.getByRole("button", { name: "Bookmark the Postman track" }).click();
    assert.equal(await page.getByLabel("Method").inputValue(), "PUT");
    await page.getByRole("button", { name: "Remove header X-DevForge-CSRF" }).click();
    const response = page.waitForResponse((r) => r.url().endsWith("/api/me/bookmarks/track/postman"));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const res = await response;
    assert.equal(res.status(), 403, "the request really reached the server");
    assert.equal(res.request().headers()["x-devforge-csrf"], undefined);
    const status = page.locator(".playground__result").getByRole("status");
    await expectText(status, /PUT \/api\/me\/bookmarks\/track\/postman → 403 Forbidden/);
    await expectText(status, /What went wrong — 403 Forbidden: csrf_failed\.[\s\S]*X-DevForge-CSRF: 1/);
    await expectText(page.locator(".playground__resp-body"), /"code": "csrf_failed"/);

    // Put the header back: the same request now succeeds.
    await page.getByRole("button", { name: "Add header" }).click();
    await page.getByLabel("Header 1 name").fill("X-DevForge-CSRF");
    await page.getByLabel("Header 1 value").fill("1");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expectText(status, /PUT \/api\/me\/bookmarks\/track\/postman → 200 OK/);
    assert.deepEqual(unexpected(problems, 403), [], `browser problems:\n${problems.join("\n")}`);
  });

  it("sends an anonymous request when the cookie is turned off (401, explained)", async () => {
    const { page, problems } = await h.newPage();
    await signIn(page);
    await page.goto("/tracks/postman/playground");
    await page.getByRole("button", { name: "My bookmarks (401 if signed out)" }).click();
    await page.getByLabel("Send my session cookie").uncheck();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expectText(page.locator(".playground__result").getByRole("status"), /→ 401 Unauthorized[\s\S]*unauthenticated/);
    assert.deepEqual(unexpected(problems, 401), [], `browser problems:\n${problems.join("\n")}`);
  });

  it("refuses a disallowed path before sending anything", async () => {
    const { page, problems } = await h.newPage();
    await signIn(page);
    await page.goto("/tracks/postman/playground");
    await page.getByRole("heading", { level: 1, name: "Request playground" }).waitFor();
    await page.waitForLoadState("networkidle"); // the app's own start-up requests (session, bookmarks) are done
    const sent: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    for (const [method, path, reason] of [
      ["GET", "/api/admin/users", /Administration endpoints are never available/],
      ["POST", "/api/me/delete", /Account deletion is never available/],
      ["GET", "/api/../metrics", /no empty parts, dots or % escapes/],
      ["GET", "https://example.com/api/health", /must start with \/api\//],
    ] as const) {
      await page.getByLabel("Method").selectOption(method);
      await page.getByLabel("Path", { exact: true }).fill(path);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expectText(page.locator(".playground__result").getByRole("status"), new RegExp(`Not sent: .*${reason.source}`));
      assert.equal(await page.getByLabel("Path", { exact: true }).getAttribute("aria-invalid"), "true");
    }
    await expectText(page.locator("#pg-remaining"), /20 of 20 requests left/, "refused requests do not count");
    assert.deepEqual(sent, [], "nothing was sent");
    noProblems(problems);
  });

  it("is linked from the request builder simulation and from the HTTP lesson", async () => {
    const { page, problems } = await h.newPage();
    await page.goto("/tracks/postman/simulations/postman-request-builder");
    await page.locator(".req-sim").waitFor();
    await page.locator(".req-sim").getByRole("link", { name: "request playground" }).click();
    await page.waitForURL("**/tracks/postman/playground");
    await page.getByRole("heading", { level: 1, name: "Request playground" }).waitFor();
    await expectText(page.locator(".playground__label"), /You are not signed in/);
    await page.goto("/tracks/postman/lessons/postman-http-basics");
    await page.locator("article").getByRole("link", { name: "request playground" }).click();
    await page.waitForURL("**/tracks/postman/playground");
    noProblems(problems);
  });
});

function noProblems(problems: string[]): void {
  assert.deepEqual(problems, [], `browser problems:\n${problems.join("\n")}`);
}
