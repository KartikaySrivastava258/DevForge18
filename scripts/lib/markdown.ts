/**
 * Build-time Markdown → HTML rendering for lessons.
 *
 * Security model: lesson Markdown is authored in this repository and reviewed
 * through pull requests, but we still treat it defensively:
 *   - raw HTML in Markdown is escaped (rendered as visible text), never passed through;
 *   - links are restricted to https:, http:, mailto:, relative paths and #anchors;
 *   - images are restricted to https: and relative paths;
 *   - media: figures and ```diagram step-throughs are resolved by the content
 *     loader (scripts/lib/media.ts), whose SVGs pass a strict allowlist;
 *   - code is highlighted with highlight.js, which escapes its input.
 * Because the output is produced at build time, no Markdown parser ships to the browser.
 */
import { Marked, type Token, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import nginx from "highlight.js/lib/languages/nginx";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, dockerfile, groovy, ini, javascript, json, nginx, plaintext, python, sql, typescript, yaml } as const;
for (const [name, def] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, def);
const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  console: "bash",
  powershell: "plaintext",
  ps1: "plaintext",
  text: "plaintext",
  txt: "plaintext",
  js: "javascript",
  ts: "typescript",
  yml: "yaml",
  toml: "ini",
  hcl: "plaintext",
  py: "python",
  docker: "dockerfile",
  jenkinsfile: "groovy",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z0-9#]+;/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return !trimmed.startsWith("//");
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return /^(https?|mailto):/i.test(trimmed);
  return true; // relative path such as ../other-lesson
}

export interface RenderResult {
  html: string;
  toc: { id: string; text: string }[];
  wordCount: number;
  /** Problems with media references; the content loader turns them into build errors. */
  problems: string[];
  /** Number of figures and step-throughs rendered. */
  figures: number;
}

/** Turns media references into HTML; it throws an Error explaining any bad reference. */
export interface MediaResolver {
  figure(ref: string, alt: string, caption: string | null): string;
  stepDiagram(ref: string): string;
  /** An embedded simulation: ```simulation <id> [scenario=<scenario-id>] */
  simulation(id: string, scenario: string | null): string;
}

const isMediaImage = (t: Token) => t.type === "image" && (t as Tokens.Image).href.startsWith("media:");

export function renderMarkdown(source: string, options: { media?: MediaResolver } = {}): RenderResult {
  const toc: { id: string; text: string }[] = [];
  const usedIds = new Map<string, number>();
  const problems: string[] = [];
  let figures = 0;
  const media = (render: (m: MediaResolver) => string, what: string): string => {
    if (!options.media) {
      problems.push(`${what}: media references are resolved only when lessons are built by the content loader`);
      return "";
    }
    try {
      const html = render(options.media);
      figures++;
      return html;
    } catch (err) {
      problems.push((err as Error).message);
      return "";
    }
  };

  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(text);
      },
      heading({ tokens, depth }: Tokens.Heading): string {
        const inner = this.parser.parseInline(tokens);
        const plain = inner.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        const base = slugifyHeading(plain);
        const seen = usedIds.get(base) ?? 0;
        usedIds.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        if (depth === 2) toc.push({ id, text: plain });
        return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      paragraph({ tokens }: Tokens.Paragraph): string {
        // A figure is a block: render it without the surrounding <p>, which cannot contain <figure>.
        const content = tokens.filter((t) => !(t.type === "text" && t.raw.trim() === ""));
        if (content.length === 1 && content[0] && isMediaImage(content[0])) return this.parser.parseInline(content);
        if (content.some(isMediaImage)) problems.push("a media: figure must be on a line of its own");
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      code({ text, lang }: Tokens.Code): string {
        const words = (lang ?? "").trim().toLowerCase().split(/\s+/);
        if (words[0] === "simulation") {
          const [, id, opt] = (lang ?? "").trim().split(/\s+/);
          const scenario = opt ? /^scenario=([a-z0-9-]+)$/.exec(opt)?.[1] : null;
          if (!id || !/^[a-z0-9-]+$/.test(id) || scenario === undefined || words.length > 3) {
            problems.push(`a simulation fence must be written \`\`\`simulation <id> [scenario=<scenario-id>], found "${lang}"`);
            return "";
          }
          if (text.trim()) problems.push(`the simulation fence for ${id} must be empty`);
          return media((m) => m.simulation(id, scenario), `simulation ${id}`);
        }
        if (words[0] === "diagram") {
          const ref = /^steps=([a-z0-9-]+\/[a-z0-9-]+)$/.exec(words[1] ?? "")?.[1];
          if (!ref || words.length !== 2) {
            problems.push(`a diagram fence must be written \`\`\`diagram steps=<track>/<name>, found "${lang}"`);
            return "";
          }
          if (text.trim()) problems.push(`the diagram fence for ${ref} must be empty; steps live in content/media/${ref}.steps.yaml`);
          return media((m) => m.stepDiagram(ref), `diagram steps=${ref}`);
        }
        const requested = words[0] ?? "";
        const isOutput = words.includes("output");
        const language = isOutput ? "plaintext" : (ALIASES[requested] ?? (requested in LANGUAGES ? requested : "plaintext"));
        const label = isOutput ? "Expected output" : requested || "text";
        const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        return (
          `<div class="code-block${isOutput ? " code-block--output" : ""}" data-lang="${escapeHtml(isOutput ? "output" : label)}">` +
          `<div class="code-block__bar"><span class="code-block__lang">${escapeHtml(label)}</span>` +
          `<button type="button" class="code-block__copy" data-copy>Copy</button></div>` +
          `<pre><code class="hljs language-${language}">${highlighted}</code></pre></div>\n`
        );
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const inner = this.parser.parseInline(tokens);
        if (!isSafeHref(href)) return `<span>${inner}</span>`;
        const external = /^https?:/i.test(href);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const rel = external ? ` rel="noopener noreferrer" target="_blank"` : "";
        return `<a href="${escapeHtml(href)}"${titleAttr}${rel}>${inner}${external ? '<span class="sr-only"> (opens in a new tab)</span>' : ""}</a>`;
      },
      image({ href, title, text }: Tokens.Image): string {
        if (href.startsWith("media:")) return media((m) => m.figure(href.slice("media:".length), text, title ?? null), href);
        const ok = /^https:\/\//i.test(href) || (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//"));
        if (!ok) return escapeHtml(text);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy">`;
      },
    },
  });

  const html = marked.parse(source) as string;
  const wordCount = source
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return { html, toc, wordCount, problems, figures };
}

/** Split a Markdown file into YAML front matter and body (re-exported; it lives in front-matter.ts). */
export { splitFrontMatter } from "./front-matter.ts";
