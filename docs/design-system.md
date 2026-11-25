# Design system

Tokens live in `web/src/styles/tokens.css`; components in `components.css`. Rationale: [ADR 0006](adr/0006-design-direction.md).

## Tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0E1526` | `#F5F7FB` | Page background |
| `--panel` / `--panel-2` | `#141D30` / `#1B2640` | `#FFFFFF` / `#EEF2F9` | Raised surfaces, hover |
| `--line` / `--line-strong` | `#2A3654` / `#3B4A70` | `#D8DFEB` / `#B9C4D8` | Hairlines, borders |
| `--text` / `--muted` / `--faint` | `#E7ECF5` / `#A3AEC4` / `#7C88A3` | `#121A2E` / `#4A566F` / `#66728C` | Text hierarchy |
| `--accent` | `#7AA2FF` | `#2C56D6` | Links, selection, primary buttons — the only accent |
| `--ok` / `--warn` / `--danger` | semantic | semantic | Status only, never decoration |

Type: Fira Sans 400/500/600 and italic; scale steps `--step--1` … `--step-5` (ratio 1.25). Body text 16–17 px with line-height 1.6–1.7, lines under 70 characters.

## Figure classes

Lesson figures are inline SVG ([ADR 0007](adr/0007-inline-svg-figures.md)) and may use only these classes (styled in `components.css` from the tokens above, so they work in both themes):

| Class | Draws |
|---|---|
| `f-box`, `f-box-accent`, `f-box-ok`, `f-box-warn`, `f-box-danger`, `f-box-faint` | Boxes: neutral; emphasised; success; warning; failure; planned or optional (dashed) |
| `f-line`, `f-line-accent`, `f-arrow`, `f-arrow-accent`, `f-dashed` | Lines and arrow shafts |
| `f-head`, `f-head-accent`, `f-dot`, `f-dot-accent` | Arrow heads (polygons) and small filled shapes |
| `f-text`, `f-muted`, `f-faint`, `f-accent`, `f-ok`, `f-warn`, `f-danger` | Text colours |
| `f-small`, `f-large`, `f-strong`, `f-mono` | Text size, weight and code font |

Status colours always come with a word or symbol in the figure or caption, never colour alone. In step-throughs the current step's boxes and arrows switch to the accent colour.

## Rules

- **One accent.** Colour means interaction or status. Categories are shown by grouping and position.
- **Labels in sentence case.** No all-caps eyebrows, no "A · B · C" metadata strings.
- **Structure carries meaning.** Numbers appear only for real sequences (path steps, lesson order) or real identifiers (track numbers 1–18).
- **Honest states.** Every data view has loading, error (with retry) and empty states; planned items say "Planned".
- **Motion answers actions** (hover, focus, expand). Nothing animates on its own; `prefers-reduced-motion` disables transitions.
- **Accessibility floor:** visible focus ring, skip link, one `h1` per page, labelled controls, focus moved to `<main>` after navigation, keyboard-reachable map nodes with a list alternative on small screens.
- **No inline scripts.** The CSP forbids them; style attributes set by React through the DOM are allowed.
