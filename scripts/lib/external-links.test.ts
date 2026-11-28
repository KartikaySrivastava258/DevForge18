import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContentBundle } from "../../shared/content-schema.ts";
import { externalLinks } from "./external-links.ts";

describe("externalLinks", () => {
  it("collects listed resources with their declared status, sources, alternatives and links in bodies", () => {
    const bundle = {
      tracks: [
        {
          slug: "docker",
          resources: [{ url: "https://docs.docker.com/", verification: { status: "verified", checked_on: "2026-11-01" } }],
          alternatives: [{ name: "Podman", url: "https://podman.io/" }],
          alternatives_checked_on: "2026-11-01",
        },
      ],
      paths: [{ slug: "p1", modules: [] }],
      lessons: [
        {
          id: "l1",
          resources: [{ url: "https://docs.docker.com/", verification: { status: "unverified" } }],
          html: '<p>See <a href="https://git-scm.com/docs/git-reflog">reflog</a> and <a href="http://localhost:8080/">your app</a> and <a href="https://kafka.apache.org/x?a=1&amp;b=2">docs</a>.</p>',
        },
      ],
      simulations: [],
      case_studies: [{ id: "c1", claims: [{ source_url: "https://example.org/x", checked_on: "2026-11-01" }, { source_url: "https://blog.example.edu.in/a", checked_on: "2026-11-01" }] }],
      labs: [{ id: "lab1", html: '<a href="https://git-scm.com/docs/git-reflog">again</a>' }],
      quizzes: [],
      projects: [],
      capstones: [],
      integrations: [],
      architectures: [],
    } as unknown as ContentBundle;
    const links = externalLinks(bundle);
    const by = new Map(links.map((l) => [l.url, l]));
    assert.equal(by.get("https://docs.docker.com/")?.declared, "unverified", "the weakest declaration wins");
    assert.deepEqual(by.get("https://docs.docker.com/")?.usedBy, ["track docker", "lesson l1"]);
    assert.equal(by.get("https://podman.io/")?.declared, "verified");
    assert.deepEqual(by.get("https://git-scm.com/docs/git-reflog")?.usedBy, ["lesson l1", "lab lab1"]);
    assert.equal(by.get("https://git-scm.com/docs/git-reflog")?.declared, undefined, "links in prose declare nothing");
    assert.equal(by.has("http://localhost:8080/"), false, "local addresses are commands, not references");
    assert.equal(by.has("https://example.org/x"), false, "reserved example domains are left out");
    assert.equal(by.get("https://blog.example.edu.in/a")?.declared, "verified", "a case-study claim's checked_on counts as verified");
    assert.ok(by.has("https://kafka.apache.org/x?a=1&b=2"), "HTML entities in an href are decoded");
  });
});
