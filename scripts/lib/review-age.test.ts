import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadContent } from "./content-loader.ts";
import { githubWarning, monthsSince, overdueReview, overdueReviewSection, reviewAgeWarning, reviewCutoff } from "./review-age.ts";

// A fixed "today" for every test: the real clock never decides the outcome.
const today = new Date("2027-12-15T23:30:00Z");

describe("review age", () => {
  it("is overdue only when last_reviewed is more than 12 months before today (UTC)", () => {
    assert.equal(reviewCutoff(today), "2026-12-15");
    assert.equal(overdueReview("a.md", "2026-12-15", today), undefined, "exactly 12 months is still within the limit");
    assert.equal(overdueReview("a.md", "2027-06-01", today), undefined);
    assert.deepEqual(overdueReview("a.md", "2026-12-14", today), { file: "a.md", last_reviewed: "2026-12-14", months: 12 });
    assert.deepEqual(overdueReview("a.md", "2025-03-20", today), { file: "a.md", last_reviewed: "2025-03-20", months: 32 });
  });
  it("uses the UTC date, not the local one", () => {
    // 00:30 on 16 December in UTC+1 is still 15 December in UTC.
    assert.equal(reviewCutoff(new Date("2027-12-16T00:30:00+01:00")), "2026-12-15");
  });
  it("counts whole calendar months and handles month ends and leap days", () => {
    assert.equal(monthsSince("2026-11-30", new Date("2027-12-01T00:00:00Z")), 12);
    assert.equal(monthsSince("2026-12-02", new Date("2027-12-01T00:00:00Z")), 11);
    assert.equal(reviewCutoff(new Date("2028-02-29T12:00:00Z")), "2027-03-01", "29 February has no match a year earlier");
    assert.equal(reviewCutoff(new Date("2027-03-31T12:00:00Z")), "2026-03-31");
  });
  it("writes a warning that names the file, the date and the age", () => {
    const r = overdueReview("lessons/docker/x.md", "2026-01-10", today);
    assert.ok(r);
    assert.equal(reviewAgeWarning(r), "lessons/docker/x.md: last reviewed 2026-01-10, 23 months ago (more than 12) — check it against current documentation, then update last_reviewed");
  });
  it("escapes GitHub Actions annotations so a value cannot break out of the command", () => {
    assert.equal(githubWarning("plain"), "::warning::plain");
    assert.equal(
      githubWarning("50% done\nnext: line", { file: "content/a,b:c.md", title: "Old" }),
      "::warning file=content/a%2Cb%3Ac.md,title=Old::50%25 done%0Anext: line",
    );
  });
  it("lists overdue items oldest first in the audit, or says none", () => {
    assert.deepEqual(overdueReviewSection([]), ["## Reviewed more than 12 months ago (0)", "", "- none"]);
    const items = [overdueReview("b.md", "2026-02-01", today), overdueReview("a.md", "2025-12-01", today)].filter((x) => x !== undefined);
    assert.deepEqual(overdueReviewSection(items).slice(2), ["- a.md: last reviewed 2025-12-01 (24 months ago)", "- b.md: last reviewed 2026-02-01 (22 months ago)"]);
  });
});

describe("content build with an injected date", () => {
  const contentRoot = join(import.meta.dirname, "..", "..", "content");
  const temps: string[] = [];
  after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("warns (without failing) for each file reviewed more than 12 months before that date", () => {
    // A date far in the future, so no review date in the repository is ever "in the future" for this test.
    const now = new Date("2100-01-01T00:00:00Z");
    const dir = mkdtempSync(join(tmpdir(), "devforge-review-age-"));
    temps.push(dir);
    cpSync(contentRoot, dir, { recursive: true });
    const set = (file: string, date: string) => writeFileSync(file, readFileSync(file, "utf8").replace(/^last_reviewed: .*$/m, `last_reviewed: '${date}'`));
    const lesson = "lessons/docker/docker-images-vs-containers.md";
    const track = "tracks/redis/track.yaml";
    const quiz = "quizzes/docker/docker-quiz.yaml";
    set(join(dir, lesson), "2099-06-01"); // 7 months: fine
    set(join(dir, track), "2098-06-30"); // 18 months: overdue
    set(join(dir, quiz), "2099-01-01"); // exactly 12 months: fine
    const { errors, warnings, overdueReviews } = loadContent(dir, now);
    assert.deepEqual(errors, [], "an old review is a warning, never an error");
    const byFile = new Map(overdueReviews.map((r) => [r.file, r]));
    assert.equal(byFile.has(lesson), false);
    assert.equal(byFile.has(quiz), false);
    assert.deepEqual(byFile.get(track), { file: track, last_reviewed: "2098-06-30", months: 18 });
    assert.ok(warnings.includes(`${track}: last reviewed 2098-06-30, 18 months ago (more than 12) — check it against current documentation, then update last_reviewed`), warnings.join("\n"));
    // Everything else still carries its 2026 date, so every kind of content is checked: one warning per file.
    for (const kind of ["tracks/", "paths/", "simulations/", "lessons/", "labs/", "quizzes/", "projects/", "capstones/", "integrations/", "architectures/", "case-studies/"]) {
      assert.ok(overdueReviews.some((r) => r.file.startsWith(kind)), `no overdue ${kind} found`);
    }
    assert.equal(warnings.filter((w) => w.includes("months ago (more than 12)")).length, overdueReviews.length);
  });
});
