# ADR 0007 — Lesson figures as validated, inlined SVG

- **Status:** Accepted (2026-11-25)

## Context

REMAINING_WORK.md §4.2 asks for a picture in every "How it works" section and step-through diagrams for processes, in both themes, without weakening the Content-Security-Policy (`img-src 'self' data:`, no inline styles or scripts). The plan suggested copying SVG files to `build/web/media/` and showing them with `<img>`.

## Problem

An SVG shown through `<img>` is an isolated document: page CSS cannot reach it, so it cannot follow the site's theme toggle (dark/light is a user choice stored by the app, not only the OS preference), and a step-through cannot highlight or reveal its parts.

## Options considered

1. **`<img src>` with hashed files** (the original plan). Safe and simple, but no theming beyond `prefers-color-scheme` inside the SVG (wrong when the learner overrides the OS theme) and no step-throughs.
2. **Two files per figure (dark and light) swapped by CSS.** Doubles authoring work, still no step-throughs.
3. **Inline the SVG into the lesson HTML at build time, through a strict allowlist.** Page CSS styles it through classes, and the step-through component can toggle elements.
4. **Render diagrams from a DSL such as Mermaid at build time.** Adds a heavy dependency (a headless browser for mermaid-cli) and still needs theming; good for flowcharts, poor for the hand-laid-out teaching diagrams needed here.

## Decision

Option 3. `scripts/lib/svg.ts` parses each figure with a deliberately small XML subset and **rejects** (fails the build, it does not silently clean) anything outside an allowlist of elements, attributes and values. The output is re-serialised from the parsed tokens. In particular:

- no `<script>`, `<style>`, `<foreignObject>`, `<image>`, `<use>`, `<a>`, event handlers, `style` attributes, DOCTYPE, CDATA or unknown entities;
- references (`url(#…)`) may only point at ids inside the same figure; ids are prefixed per figure so several figures can share a page;
- no hard-coded colours: `fill`/`stroke` are `none`, `currentColor` or a local `url(#…)`; colour comes from a fixed class vocabulary (`f-box`, `f-accent`, …) styled from the design tokens in `components.css`;
- `data-step` / `data-until` attributes drive step-throughs.

No new dependency and no CSP change were needed. Photographs and screenshots, when added, will use `<img>` with hashed files as originally planned.

## Positive consequences

Figures follow the theme exactly, text in them is real, searchable text, step-throughs need no second copy of the drawing, and an unsafe or off-palette figure cannot reach learners.

## Negative consequences

- Authors must use the class vocabulary rather than any colour, and only a subset of SVG (enough for boxes, lines, paths, text).
- Inline SVG enlarges `content.json` slightly (about 2–4 KB per figure).

## Revisit when

Figures need features outside the subset (gradients, images inside SVG), or a diagram DSL becomes worth its weight.
