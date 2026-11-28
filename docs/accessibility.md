# Accessibility

DevForge 18 aims for WCAG 2.1 level AA. This page records what is tested automatically, what the first audit found, and the manual checks that automation cannot do.

## Automated audit

`e2e/accessibility.test.ts` runs [axe-core](https://github.com/dequelabs/axe-core) through `@axe-core/playwright` (4.14.0, with axe-core 4.14.0 pinned by `overrides` in `package.json`) on the production build in headless Chromium. It is part of `npm run test:e2e`, so it runs in CI on every push.

- **Rules:** every axe rule tagged `wcag2a`, `wcag2aa`, `wcag21a` or `wcag21aa`. No rule is disabled and no element is excluded; any future exclusion must be added to `EXCLUSIONS` in the test with its reason, and listed here.
- **Colour schemes:** every page is audited twice, in the dark scheme (the default) and the light scheme (`prefers-color-scheme: light`); the test also checks that the page really switched (`<html data-theme>`).
- **When:** after the page's own data has loaded (its heading and a page-specific element are visible, the network is idle, and entrance animations have finished, so contrast is measured on final colours).
- **Pages (36, so 72 audits):**

| Page | URL |
|---|---|
| Home (system map) | `/` |
| Tracks catalogue | `/tracks` |
| Track | `/tracks/docker` |
| Lesson | `/tracks/docker/lessons/docker-images-vs-containers` |
| Lab (with an embedded simulation) | `/tracks/docker/labs/docker-layer-cache-experiments` |
| Simulation | `/tracks/kubernetes/simulations/kubernetes-reconciliation` |
| Request playground, signed in, after a real request (the response panel is audited too) | `/tracks/postman/playground` |
| Simulation after a dozen steps (long, scrolling event log; timeline with a lock wait and an error) | `/tracks/postgresql/simulations/postgresql-isolation-timeline?scenario=deposits` |
| Quiz, signed out and signed in (questions shown) | `/tracks/git-github/quiz` |
| Mini-project | `/tracks/docker/projects/docker-notes-api` |
| Capstones and one capstone | `/capstones`, `/capstones/capstone-a` |
| Relationship graph | `/graph` |
| Architecture studio and one architecture | `/architecture`, `/architecture/web-app-with-cache` |
| Learning paths and one path | `/paths`, `/paths/backend-foundations` |
| Search | `/search?q=docker` |
| Sign-in and registration | `/login`, `/register` |
| Dashboard (signed in) | `/dashboard` |
| Page not found | `/definitely/not/here` |
| Phone width (390 × 844): home with the menu open, lesson, quiz (signed in), project, dashboard with the menu open | as above |
| Cohorts (signed in) | `/cohorts` |
| Cohort as its teacher (learner table, assignments, join code) | `/cohorts/:id` |
| Review queue (teacher) | `/reviews` |
| Review form with rubric radio groups | `/reviews/submission/:id` |
| Public portfolio | `/portfolio/:slug` |
| Administration (admin) | `/admin` |
| Content editor (faculty) | `/content-editor` |
| Certificate verification (signed out; the certificate is issued by the real API after the quiz and lab evidence is seeded, as in the API tests) | `/certificates/:id` |

### Results

First run (2026-11-27, before fixes): 11 of 42 audits failed (the phone-width cases were added afterwards and found one more problem). Every problem was fixed in the interface; none was suppressed.

| axe rule (WCAG criterion) | Where | Cause | Fix |
|---|---|---|---|
| `label-content-name-mismatch` (2.5.3 Label in Name) | Home: all 18 system-map nodes, both schemes | The node's visible text ran together ("1Git +GitHub"), so the link name "Track 1: Git + GitHub" did not contain it | Spaces kept between the SVG text parts (`SystemMap.tsx`); the visible text now reads "1 Git + GitHub" |
| `nested-interactive` (4.1.2 Name, Role, Value) | `/graph`, both schemes | The diagram was `role="img"`, whose children are hidden from assistive technology, yet it contains keyboard-focusable links | `role="group"` with a name and the existing description (`Graph.tsx`); the links are now exposed |
| `color-contrast` (1.4.3 Contrast) | Light scheme: code-block language labels (4.34:1), status tags such as "Link checked …" on resources (`.tag--done`, 4.37:1) | `--faint` `#66728C` and `--ok` `#1D7A4A` were just under 4.5:1 on tinted backgrounds | Light `--faint` → `#5F6B84` (≥ 4.77:1 on every surface), light `--ok` → `#186D41` (≥ 4.94:1, also on its own tint). Dark `--faint` → `#8490AB`: it was 4.23:1 on `--panel-2`, not yet flagged only because no audited page put it there |
| `color-contrast` (1.4.3) | Lab and Docker simulation, both schemes: the "Add" button of a removed Dockerfile step (3.36:1 dark, 2.47:1 light) | The whole removed line was faded with `opacity: 0.55`, including its active button | Removed lines are dashed with a muted instruction; the buttons keep full contrast |
| `scrollable-region-focusable` (2.1.1 Keyboard) | Lesson at phone width: code blocks wider than the screen | A scrolling `<pre>` that cannot take focus cannot be scrolled with a keyboard | Code blocks are rendered with `tabindex="0"` (`scripts/lib/markdown.ts`, unit-tested), as are the scrolling starter files on project pages |
| — (test could not start: no `h1`) | Page not found | The 404 state used an `h2`, so the page had no top-level heading | The 404 state is the page's main content and now uses `h1` |

Found while checking the fixes visually (not an axe rule): a simulation embedded in a lab article kept its two-column layout, because the layout switched on the viewport width, so the Dockerfile editor was squeezed to about 250 px with one character per line. The layout now follows the simulation's own width (a CSS container query); a browser test guards it.

Final run (2026-11-27): **52 of 52 audits pass, 0 violations** (26 pages × 2 schemes). After the Milestone 11 pages were added (cohorts, reviews, portfolio, administration, content editor, each with real data created by the test): **66 of 66 pass, 0 violations**, nothing excluded, as part of `npm run test:e2e` (all browser tests pass). 2026-11-28, after adding the certificate page, the request playground and a simulation with a long event log: **72 of 72 pass** (the long-log audit found the event log of every simulation was not keyboard-reachable; fixed in `SimulationShell`).

### What the automated audit does not cover

Automated tools find only part of the WCAG failures: they cannot judge whether alternative text is meaningful, whether the reading and focus order make sense, whether announcements are timely, or whether a screen-reader user can actually complete a task. Interactive states are covered only where noted (menus open); the audit does not, for example, submit a quiz or fail a sign-in before auditing. Those states rely on the existing browser tests and the manual checklist below.

## Manual screen-reader pass (to do: owner)

**Not done yet.** This audit was automated only; nobody has used DevForge with a screen reader. Do it before institution-wide use, record the date, the screen reader and browser versions, and any problems found (as issues), here.

Suggested setups: Orca with Firefox on Linux (the owner's setup; steps below); NVDA with Firefox or Chrome on Windows; VoiceOver with Safari on macOS and on iOS; TalkBack with Chrome on Android. Test in both colour schemes and at 200 % and 400 % zoom.

### Orca on Linux, quick start

1. Orca is installed on most GNOME-based desktops (`orca --version`; otherwise `sudo apt install orca`). Run `orca -s` once and choose the **Laptop** keyboard layout: the Orca key is then **Caps Lock** (Desktop layout: **Insert**).
2. Start it with `orca &` (GNOME: Super+Alt+S toggles it); stop it with `pkill orca`.
3. Start DevForge (`npm run build && npm start`, or on another port with `PORT` and `PUBLIC_ORIGIN`) and open it in Firefox.
4. Keys (from the Orca help, checked 2026-11-28): Orca+H learn mode (Esc leaves); Tab/Shift+Tab controls; H/Shift+H headings, 1–6 a heading level, Alt+Shift+H list of headings; M landmarks (Alt+Shift+M list); K links (Alt+Shift+K list); F form fields; B buttons; T tables; Orca+A switches browse mode and focus mode; Say All is Orca+; (Laptop) or KP Plus (Desktop). The help pages do not list a key to stop speech; Ctrl usually stops it.
5. For each item below write ✅ or ❌ with one line on what was announced, and record the Orca and Firefox versions and the date here.

### Checklist

Global

- [ ] The page title announced on every route change describes the page.
- [ ] "Skip to content" is the first Tab stop and moves focus to the main content.
- [ ] Landmarks: one banner, navigation (named), main, contentinfo; the landmarks list makes sense.
- [ ] The heading list (H key / rotor) gives a usable outline: one `h1` per page, no skipped levels that confuse.
- [ ] Focus is always visible, never lost after navigation (focus moves to the new page, not stays on a removed link).
- [ ] The theme toggle announces its state; the mobile menu button announces expanded/collapsed and Escape closes it.
- [ ] Nothing important is conveyed by colour alone (verified/pending tags, simulation states, quiz results).
- [ ] At 400 % zoom (320 CSS px wide) no content is lost and there is no two-direction scrolling except code blocks and diagrams.

Pages

- [ ] Home: the system map's 18 nodes are reachable and announced as "Track N: name"; the text list version is available and equivalent.
- [ ] Tracks: filters are labelled; the number of results is announced when filters change.
- [ ] Lesson: code blocks can be reached and scrolled with the keyboard; "Copy" announces success; figures have useful text alternatives; step-through diagrams announce each step; the self-check announces correct/incorrect.
- [ ] Lab and simulation: every control has a clear name; the simulation's outcome (log, status, challenge solved) is announced or reachable; text mode is equivalent to the visual mode.
- [ ] Quiz: each question is a group with its legend; answer options are labelled; the score and per-question feedback after submitting are announced and reachable.
- [ ] Project and capstone: rubric tables have headers; hints reveal progressively and announce new content; starter files can be read.
- [ ] Graph and architecture pages: the diagram's links are announced with meaningful names; the text table of connections is equivalent.
- [ ] Search: results count and results are announced after typing.
- [ ] Sign-in and registration: every field is labelled; errors are announced and linked to their field; the password rules are read before submitting.
- [ ] Dashboard: progress figures are announced as text, not only as bars.
- [ ] Cohorts and reviews: the join-code field is labelled; the cohort's learner table has headers; each rubric criterion is a group whose options are announced with their level.
- [ ] Certificate page: the holder, track, issue date and status (valid or revoked) are read in order; the criteria list makes sense without the visual layout.

## Keeping it accessible

- New pages: add them to `PAGES` in `e2e/accessibility.test.ts`.
- New colours: define them as tokens in `web/src/styles/tokens.css` for both schemes and check 4.5:1 (text) and 3:1 (large text, non-text UI) on `--bg`, `--panel`, `--panel-2` and `--code-bg`.
- Do not fade active controls with `opacity`; do not put focusable content inside `role="img"`; give every scrolling region `tabindex="0"`.
