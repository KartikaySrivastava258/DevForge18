import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSvg } from "./svg.ts";

const wrap = (inner: string, rootAttrs = 'viewBox="0 0 100 50"') => `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${inner}</svg>`;

describe("sanitizeSvg accepts the figure vocabulary", () => {
  it("re-serialises allowed markup, prefixes ids and local references, and drops comments", () => {
    const out = sanitizeSvg(
      wrap('<!-- note --><defs><marker id="head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path class="f-head" d="M0 0 L10 5 L0 10 z"/></marker></defs><g data-step="2" data-until="3"><line class="f-arrow" x1="0" y1="0" x2="50" y2="0" marker-end="url(#head)"/><text class="f-mono f-small" x="1" y="2" text-anchor="middle">a &amp; b &lt;c&gt;</text></g>'),
      "fig",
    );
    assert.equal(out.viewBox, "0 0 100 50");
    assert.ok(out.inner.includes('id="fig-head"'));
    assert.ok(out.inner.includes('marker-end="url(#fig-head)"'));
    assert.ok(out.inner.includes("a &amp; b &lt;c&gt;"));
    assert.ok(!out.inner.includes("note"));
    assert.deepEqual(out.stepValues, [2]);
    assert.deepEqual(out.untilValues, [3]);
  });
  it("accepts an XML declaration before the root", () => {
    assert.ok(sanitizeSvg(`<?xml version="1.0" encoding="UTF-8"?>\n${wrap('<rect class="f-box" x="0" y="0" width="1" height="1"/>')}`, "p").inner.startsWith("<rect"));
  });
});

describe("sanitizeSvg rejects anything outside the allowlist", () => {
  const rejects = (svg: string, pattern: RegExp) => assert.throws(() => sanitizeSvg(svg, "p"), pattern);
  it("scripts, foreignObject, style elements and images", () => {
    rejects(wrap("<script>alert(1)</script>"), /<script> is not allowed/);
    rejects(wrap("<foreignObject><div>x</div></foreignObject>"), /<foreignObject> is not allowed/);
    rejects(wrap("<style>text{fill:red}</style>"), /<style> is not allowed/);
    rejects(wrap('<image href="https://evil.example/x.png"/>'), /<image> is not allowed/);
    rejects(wrap('<use href="#a"/>'), /<use> is not allowed/);
  });
  it("event handlers, inline styles and external references", () => {
    rejects(wrap('<rect class="f-box" onclick="alert(1)"/>'), /onclick is not allowed \(event handlers/);
    rejects(wrap('<rect onload="alert(1)"/>'), /onload is not allowed/);
    rejects(wrap("", 'viewBox="0 0 1 1" onload="alert(1)"'), /svg: attribute onload is not allowed/);
    rejects(wrap('<rect style="fill:red"/>'), /style is not allowed.*CSP/);
    rejects(wrap('<path d="M0 0" marker-end="url(https://evil.example/m.svg#a)"/>'), /marker-end=.* is not allowed/);
    rejects(wrap('<rect fill="url(#missing)"/>'), /url\(#missing\) points at an id that does not exist/);
    rejects(wrap('<a href="javascript:alert(1)"><text>x</text></a>'), /<a> is not allowed/);
  });
  it("hard-coded colours and unknown classes, so figures always follow the theme", () => {
    rejects(wrap('<rect fill="#ff0000"/>'), /fill="#ff0000" is not allowed \(colours come from classes/);
    rejects(wrap('<rect stroke="red"/>'), /stroke="red" is not allowed/);
    rejects(wrap('<rect class="f-box rainbow"/>'), /class="f-box rainbow" is not allowed \(allowed classes/);
  });
  it("DOCTYPE and entity tricks", () => {
    rejects(`<!DOCTYPE svg [<!ENTITY x "y">]>${wrap("")}`, /DOCTYPE/);
    rejects(wrap("<text>&x;</text>"), /unknown entity &x;/);
    rejects(wrap("<text><![CDATA[<script>]]></text>"), /CDATA/);
  });
  it("malformed or unexpected structure", () => {
    rejects('<g viewBox="0 0 1 1"></g>', /root element must be <svg>/);
    rejects(wrap("", ""), /needs a viewBox/);
    rejects(wrap("<g><rect></g>"), /does not match/);
    rejects(wrap("<rect x=1/>"), /malformed tag/);
    rejects(wrap('<rect id="a"/><rect id="a"/>'), /duplicate id "a"/);
    rejects(wrap('<rect transform="matrix(1,0,0,1,0,0)"/>'), /transform=.* is not allowed/);
    rejects(wrap("<g>loose text</g>"), /text is only allowed inside <text>/);
    rejects(wrap("") + "<svg></svg>", /content after the root|text outside/);
  });
});
