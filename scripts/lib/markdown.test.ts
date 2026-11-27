import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSafeHref, renderMarkdown, splitFrontMatter, type MediaResolver } from "./markdown.ts";

describe("renderMarkdown security", () => {
  it("escapes raw HTML instead of passing it through", () => {
    const { html } = renderMarkdown('Hello <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
  it("neutralises javascript: and data: links", () => {
    const { html } = renderMarkdown("[click](javascript:alert(1)) and [x](data:text/html,hi)");
    assert.ok(!/href="javascript/i.test(html));
    assert.ok(!/href="data/i.test(html));
  });
  it("marks external links as noopener and announces the new tab", () => {
    const { html } = renderMarkdown("[docs](https://docs.docker.com/)");
    assert.match(html, /rel="noopener noreferrer" target="_blank"/);
    assert.match(html, /opens in a new tab/);
  });
  it("escapes code and labels the language", () => {
    const { html } = renderMarkdown("```bash\necho '<b>'\n```");
    assert.ok(html.includes('data-lang="bash"'));
    assert.ok(!html.includes("<b>"));
  });
});

describe("renderMarkdown structure", () => {
  it("builds a table of contents from level-2 headings with unique ids", () => {
    const { toc, html } = renderMarkdown("## Setup\ntext\n## Setup\nmore\n### Detail");
    assert.deepEqual(toc, [
      { id: "setup", text: "Setup" },
      { id: "setup-1", text: "Setup" },
    ]);
    assert.ok(html.includes('id="detail"'));
  });
  it("makes code blocks keyboard-focusable, so lines wider than the screen can be scrolled without a mouse", () => {
    const { html } = renderMarkdown("```bash\necho hello\n```\n\n```text output\nhello\n```");
    assert.equal(html.match(/<pre tabindex="0">/g)?.length, 2);
    assert.ok(!html.includes("<pre>"));
  });
});

describe("helpers", () => {
  it("isSafeHref allows relative, anchors, http(s) and mailto only", () => {
    for (const ok of ["/tracks", "#top", "../x", "https://a.b", "mailto:a@b.c"]) assert.ok(isSafeHref(ok), ok);
    for (const bad of ["javascript:x", "JAVASCRIPT:x", "data:x", "vbscript:x", "//evil.example"]) assert.ok(!isSafeHref(bad), bad);
  });
  it("splitFrontMatter handles CRLF and missing front matter", () => {
    assert.deepEqual(splitFrontMatter("---\r\na: 1\r\n---\r\nbody"), { frontMatter: "a: 1", body: "body" });
    assert.equal(splitFrontMatter("no front matter"), null);
  });
});

describe("renderMarkdown media references", () => {
  const calls: string[] = [];
  const media: MediaResolver = {
    figure: (ref, alt, caption) => {
      calls.push(`figure ${ref} ${alt} ${caption}`);
      if (ref === "x/missing.svg") throw new Error("unknown figure media:x/missing.svg");
      return '<figure class="figure"></figure>\n';
    },
    stepDiagram: (ref) => {
      calls.push(`steps ${ref}`);
      return '<figure class="figure step-diagram"></figure>\n';
    },
    simulation: (id, scenario) => {
      calls.push(`simulation ${id} ${scenario}`);
      return '<div class="sim-embed"></div>\n';
    },
  };
  it("renders a figure on its own line as a block, without a wrapping paragraph", () => {
    const { html, problems, figures } = renderMarkdown('Before.\n\n![Alt text](media:git-github/a.svg "Caption")\n\nAfter.', { media });
    assert.deepEqual(problems, []);
    assert.equal(figures, 1);
    assert.ok(html.includes('<p>Before.</p>\n<figure class="figure"></figure>\n<p>After.</p>'), html);
    assert.ok(calls.includes("figure git-github/a.svg Alt text Caption"));
  });
  it("renders an empty diagram fence as a step-through", () => {
    const { html, problems } = renderMarkdown("```diagram steps=git-github/commit-cycle\n```", { media });
    assert.deepEqual(problems, []);
    assert.ok(html.includes("step-diagram"));
  });
  it("renders a simulation fence, with an optional scenario", () => {
    const { html, problems } = renderMarkdown("```simulation git-commit-graph scenario=first-commits\n```", { media });
    assert.deepEqual(problems, []);
    assert.ok(html.includes("sim-embed"));
    assert.ok(calls.includes("simulation git-commit-graph first-commits"));
    assert.match(renderMarkdown("```simulation Bad_Id\n```", { media }).problems[0] ?? "", /must be written/);
    assert.match(renderMarkdown("```simulation x scenario=\n```", { media }).problems[0] ?? "", /must be written/);
  });
  it("reports bad references instead of rendering them", () => {
    const check = (md: string, pattern: RegExp) => {
      const { problems } = renderMarkdown(md, { media });
      assert.ok(problems.some((p) => pattern.test(p)), `${md} → ${problems.join("; ")}`);
    };
    check("![a](media:x/missing.svg)", /unknown figure/);
    check("Text ![a](media:git-github/a.svg) inline.", /must be on a line of its own/);
    check("```diagram\n```", /must be written/);
    check("```diagram steps=git-github/x\nsteps: []\n```", /must be empty/);
    assert.match(renderMarkdown("![a](media:git-github/a.svg)").problems[0] ?? "", /resolved only when lessons are built by the content loader/);
  });
});
