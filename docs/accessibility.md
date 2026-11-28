# Accessibility

DevForge 18 aims for WCAG 2.1 level AA. This page records what is tested automatically, what the first audit found, and the manual checks that automation cannot do.

## Automated audit

`e2e/accessibility.test.ts` runs [axe-core](https://github.com/dequelabs/axe-core) through `@axe-core/playwright` (4.14.0, with axe-core 4.14.0 pinned by `overrides` in `package.json`) on the production build in headless Chromium. It is part of `npm run test:e2e`, so it runs in CI on every push.

- **Rules:** every axe rule tagged `wcag2a`, `wcag2aa`, `wcag21a` or `wcag21aa`. No rule is disabled and no element is excluded; any future exclusion must be added to `EXCLUSIONS` in the test with its reason, and listed here.
- **Colour schemes:** every page is audited twice, in the dark scheme (the default) and the light scheme (`prefers-color-scheme: light`); the test also checks that the page really switched (`<html data-theme>`).
- **When:** after the page's own data has loaded (its heading and a page-specific element are visible, the network is idle, and entrance animations have finished, so contrast is measured on final colours).
- **Pages (40, so 80 audits):**

| Page | URL |
|---|---|
| Home (system map) | `/` |
| Tracks catalogue | `/tracks` |
| Track | `/tracks/docker` |
| Track, signed in with a completed lesson (level groups, completion ticks) and at phone width | `/tracks/docker` |
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
| Certificate verification (signed out; the certificate is issued by the real API after the quiz and lab evidence is seeded, as in the API tests), also revoked (by an admin through the real API) and for an unknown id | `/certificates/:id` |

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

Final run (2026-11-27): **52 of 52 audits pass, 0 violations** (26 pages × 2 schemes). After the Milestone 11 pages were added (cohorts, reviews, portfolio, administration, content editor, each with real data created by the test): **66 of 66 pass, 0 violations**, nothing excluded, as part of `npm run test:e2e` (all browser tests pass). 2026-11-28, after adding the certificate page, the request playground and a simulation with a long event log: **76 of 76 pass** (with the two track-page states too; the long-log audit found the event log of every simulation was not keyboard-reachable; fixed in `SimulationShell`). Later that day, with the revoked-certificate and unknown-certificate states: **80 of 80 pass**.

### What the automated audit does not cover

Automated tools find only part of the WCAG failures: they cannot judge whether alternative text is meaningful, whether the reading and focus order make sense, whether announcements are timely, or whether a screen-reader user can actually complete a task. Interactive states are covered only where noted (menus open); the audit does not, for example, submit a quiz or fail a sign-in before auditing. Those states rely on the existing browser tests and the manual checklist below.

## Manual screen-reader pass

**Done 2026-11-28 by the project owner: 19 of 20 items pass, 0 failures; item 20 (certificate page) pending.** Orca 46.1 (Laptop layout) with Mozilla Firefox 161.0 on Linux, on a separate clone with its own database. Results, as the owner recorded them:

| # | Item | Result |
|---|---|---|
| 1–8 | Global: page title announced, "Skip to content", landmarks list, headings list (one main heading), visible focus, theme and menu buttons named, nothing by colour only, 400 % zoom | ✅ all work |
| 9 | Home: map nodes read as "Track N: name" | ✅ |
| 10 | Tracks: filters named, result count announced | ✅ |
| 11 | Lesson: Copy button, pictures, step diagrams, self-check | ✅ |
| 12 | Lab and simulation: buttons named, results can be heard | ✅ |
| 13 | Quiz: questions and options read, score announced | ✅ |
| 14 | Project and capstone: table headers, hints announced | ✅ |
| 15 | Graph and architecture: links named, text table exists | ✅ |
| 16 | Search: number of results announced | ✅ |
| 17 | Sign-in and registration: fields named, errors announced | ✅ |
| 18 | Dashboard: progress read as text | ✅ |
| 19 | Cohorts and reviews (admin account): fields named, table headers | ✅ |
| 20 | Certificate page | Not reached: no certificate had been earned in the test copy. `npm run demo:certificate -- --port 8091` now starts the real app on an in-memory database with a valid, a revoked and a not-yet-issued certificate (`scripts/certificate-demo.ts`); the automated audit covers all three certificate states (valid, revoked, unknown id) |

No problems were found, so nothing needed fixing.

### Orca's internal errors (an Orca bug, not a DevForge problem)

During the pass Orca printed 11 identical tracebacks; speech continued. The innermost error is `UnboundLocalError: cannot access local variable 'children'` in `_generateNumberOfChildren` (`orca/scripts/web/speech_generator.py`, line 488 in the installed 46.1). The `NameError`s before it (`newAncestors`, `numberOfChildren`) are Orca's normal lazy evaluation of its formatting strings, not errors in themselves.

- **Cause, from Orca's own source.** The function announces how many items a list, list box, description list or ARIA feed has. When the first child exposes no `setsize`, it computes the count from `children`, but assigns `children` only if the object is a description list (`isDescriptionList(obj)`) or the role is list or list box. When Orca's resolved role is "description list" or "feed" but that test does not hold for the object, `children` is never assigned and the line `setsize = len(children)` raises. Whatever page triggers it, the defect is that missing branch in Orca. The same code is on Orca's `gnome-46` branch. On `main`, the function (now `_generate_number_of_children`) is rewritten so that an unknown size returns nothing instead of raising. Both branches were read through the GitLab API on 2026-11-28. A search of Orca's issue tracker for `_generateNumberOfChildren` found no report.
- **DevForge's markup.** DevForge uses no `role="feed"`, no `role="list"` and no `aria-setsize`, so the elements that reach this code are its native `<ul>`, `<ol>` and `<dl>` lists. The automated audit runs axe's `list`, `listitem`, `definition-list` and `dlitem` rules (WCAG 1.3.1, tag `wcag2a`) on all 40 pages in both schemes with no violation, so those lists are well formed: list items only inside lists, and `<dl>` holding only `<dt>`/`<dd>` groups. The log does not name the element, and without Orca's debug log the 11 occurrences cannot be tied to a specific list.
- **Decision.** The markup is valid, so it is not changed to work around Orca. Orca users lose nothing but the item count of an affected list. Updating to an Orca release that contains the rewritten function should remove the errors. To tie an error to an element, run `orca --debug` and search the debug file for `_generateNumberOfChildren`.

### How to repeat the pass

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
