# Implementation status

Last updated: 2026-11-27 (UTC) · Milestones **9 and 10 done** (content complete; closing once CI is green) · Next: Milestone 11 — institutional features and hardening (REMAINING_WORK §6.3–6.4), then the release checklist

## Session handoff

- **Where I stopped:** Milestone 9 (18 quizzes, 54 mini-projects with executable checks) and Milestone 10 (capstones A–G, 17 integrations, 10 reference architectures, learner ADRs, relationship graph) are written, executed locally and pushed. Last fixes: a stale unused-media warning test, and a race in the Kafka campus-activity check (the first consumer could finish all swipes before the second joined; the check now starts both copies and lets the swipes arrive over about 4 s).
- **Next:** confirm CI green for the last push, then Milestone 11 in the order of REMAINING_WORK §6.3 (admin and faculty screens, cohorts and assignments, project/ADR review against rubrics, portfolio, certificates, CMS that opens pull requests) and §6.4.
- **Disk:** keep at least 5 GB free; checks remove their containers with `-v` and the images they build.
- **How to work fast:** `npm run new:quiz|new:project -- <track> <id>`; `DEVFORGE_DOCKER_TEST=1 DEVFORGE_CHANGED_FILES=<file> node --test scripts/lib/projects.test.ts` (or `lesson-runner.test.ts`); Docker project checks run in the CI "Mini-project checks" job (four shards), the others in the verify job.

This file is the handover record required by the blueprint (Part XI §15). Update it after every substantial milestone. Claims here are limited to what was actually run and observed; anything not run is marked **untested**.

## Summary

| Area | State |
|---|---|
| All 18 tracks present, searchable, with reviewed explanation and full curriculum outline | ✅ Done, tested |
| 8 learning paths | ✅ Done, tested |
| Lessons | ✅ 133 published; 131 **executed**, 2 Jira lessons **docs-checked** (Jira's own screens). Every track has 5–9 lessons, beginner to advanced — the full Milestone 8 plan in REMAINING_WORK §5 |
| Executable lessons (commands run in CI, output compared) | ✅ Done, tested |
| Accounts, sessions, roles, progress, bookmarks | ✅ Done, tested |
| Frontend: home + system map, catalogue, track, lesson, paths, search, auth, dashboard | ✅ Done, tested in a browser |
| Figures and step-through diagrams | ✅ 132 figures (every lesson has at least one), 22 of them step-throughs — at least one in every track; tested |
| Simulations | 🟡 Framework done and tested; all 18 tracks have one, with server-verified challenges |
| Case studies and alternatives | ✅ 36 sourced case studies (2 per track, 108 claims, each with a verbatim quote, its source and the date checked) and 89 alternatives with licences; tested |
| Labs | ✅ 36 labs, 2 per track: 18 local (each with a check script that must also fail in an empty folder), 17 simulation (server-verified challenges), 1 read-through (server-graded); 19 have their commands executed by the tests; lab progress records self-reported or verified completion |
| Quizzes | ✅ Six question types graded on the server (answers never sent before grading), attempts saved, paths show "skipped by quiz"; all 18 track quizzes written |
| Mini-projects | 🟡 Project pages (brief, stories, criteria, rubric, starter files, progressive hints, faculty-only solution) and executable acceptance checks (fail on the starter, pass on the solution); all 54 written, Docker-based checks in their own four-shard CI job |
| Capstones, integrations, architecture studio, relationship graph | ✅ 7 capstones (A–G), 17 integrations between related tracks, 10 reference architectures with learner decision records; API and browser tests |
| Admin / faculty screens, cohorts, CMS | ⬜ API foundation only |
| CI | ✅ Runs on GitHub: a verify job (typecheck, lint, build, unit/API and browser tests) and executed lessons in three parallel shards, about 17 minutes in all. Docker Compose / production Nginx config still untested |

## Verified results (last run 2026-11-25)

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors (strict; server, shared, scripts, tests) |
| `npm run build` | ✅ 18 tracks, 8 paths, 1 lesson validated; JS 254.5 KB, CSS 25.6 KB (minified, before gzip) |
| `npm test` | ✅ 131 passing, 8 skipped, 0 failing (139 tests). The 8 skips are the PostgreSQL, Redis, Nginx and Docker lessons: none of these tools exists in the build environment; they run in CI. |
| `npm run test:e2e` | ✅ 24 / 24 passing (headless Chromium 1243) |
| `npm run lessons:record` | ✅ No-op on matching lessons; repaired a deliberately corrupted output block to a byte-identical file; wildcard lines preserved |
| SQL lesson plumbing (`sql run` → psql in a throwaway database) | ✅ Tested with stub `psql`/`createdb`/`dropdb`; ⚠️ never run against a real PostgreSQL server yet |
| `npm start` + curl smoke test | ✅ health, SPA routes with CSP, 18 tracks via API, CSRF rejection, `/metrics` |
| `db:migrate` (twice), `user:create` (success + 3 rejection cases), `db:backup` + restore check | ✅ behave as documented |
| `npm run typecheck:web` | ✅ **Passed with the real `@types/react`** on the owner's machine (Ubuntu, Node 22.23.2), 2026-11-25 — 0 errors. |
| `npm run content:check-links` | ✅ 55 unique links, 0 broken (CI *Link check* and locally, 2026-11-25); every resource reviewed and marked verified — see Milestone 1 below |
| Docker build / Compose / Nginx config | ⚠️ **Untested.** YAML validated; Dockerfile and `nginx.conf` not executed. |
| GitHub Actions workflows | ⚠️ **Untested.** YAML validated. |

## Completed work

### Phase 0 — foundation

- **Repository and tooling**: strict TypeScript (TS 6) run natively by Node 22's type stripping; esbuild frontend bundle with hashed assets; `node:test` for unit, integration and browser tests.
- **Content pipeline** (`scripts/lib/content-loader.ts`, `shared/content-schema.ts`): zod schemas for tracks, paths and lessons; cross-reference checks (exactly 18 tracks numbered 1–18, prerequisites, related tracks, prerequisite cycles, path modules, lesson ids/order, future review dates, https-only links, duplicate links); build-time Markdown rendering that escapes raw HTML and blocks unsafe links; highlight.js code highlighting.
- **Content**: 18 `track.yaml` files with mental model, plain explanation, problem solved, what-it-is-not, architecture position, products, prerequisites, related tracks (each with a reason), syllabus by level, 4 labs (with mode) and 3 projects each, official resources from the blueprint; 8 learning paths with capstone, prerequisites and alternate routes; 1 complete lesson with 4 graded self-check questions.
- **Server**: typed router, security headers and CSP, CSRF protection, JSON body limits and validation, structured logs, Prometheus metrics, static serving with traversal protection and SPA fallback; SQLite with versioned, checksummed, transactional migrations.
- **Auth**: scrypt (N=2¹⁷) with in-hash parameters and transparent rehash; hashed session tokens; session fixation prevention; timing-equalised login; per-account lockout; roles; audit log; CLI-only admin creation.
- **API**: tracks, paths, lessons (answers stripped), search, lesson start/check (server-side grading), progress, bookmarks, admin users/roles/audit, faculty overview.
- **Frontend**: design system (tokens, Fira Sans self-hosted, dark/light), app shell with skip link and mobile menu, interactive system map (the signature element), catalogue with URL-synced filters, track page with scroll-spy navigation, lesson reader with copy buttons and self-check, paths, search, sign-in/registration with open-redirect protection, dashboard.
- **Ops**: `db:migrate`, `user:create`, `db:backup` (online, integrity-checked), `content:check-links`; CI and weekly link-check workflows; Dockerfile (non-root, read-only), Compose with Nginx.
- **Docs**: README, architecture, 6 ADRs, security, deployment, content authoring, design system, testing, contributing.

### Bugs found and fixed during verification

1. Lesson article was re-inserted by React on every page re-render (scroll-spy, announcements), losing text selection and "Copied" state → memoised `LessonBody`; regression test asserts the article node survives scrolling and copying.
2. Mobile menu button visible on desktop (CSS specificity) → fixed.
3. System map labels truncated ("LangChain + LL…") and text rendered at ~9 px → larger geometry, two-line labels for paired tracks, minimum canvas width with horizontal scroll.
4. Article headings offset 5 px left of body text by the hidden anchor → anchor absolutely positioned; measured offset now 0 px.
5. Docker track status said "Curriculum outline" despite a published lesson → corrected.
6. YAML parses unquoted dates as `Date` objects → schema normalises them.
7. E2E harness created the app before knowing its origin, which would have failed every browser POST → fixed by binding the port first.

### Phase 1 — progress so far

- **Executable lessons** (`scripts/lib/lesson-runner.ts`): ```` ```bash run ```` blocks are executed in an isolated sandbox (temporary `HOME`, fixed dates for reproducible commit IDs), prerequisite lessons are replayed first, and real output must match the lesson's ```` ```text output ```` blocks (with `…` wildcards). Build rule: lessons declare `verification.method` (`executed` / `docs-checked`), shown to learners above each lesson.
- **Git track lessons 1–3**: *What Git is, and setting it up*; *Your first repository and commits*; *Sharing work with remotes, push and pull* (fully offline using a bare repository and a simulated teammate). Every command and output is reproduced by the tests. Expected outputs were captured from real Git runs, never typed by hand.
- Git track status → *Lessons in progress*.
- **SQL in executable lessons**: ```` ```sql run ```` blocks run through psql against a throwaway database; CI now starts a PostgreSQL 16 service. New `pending` verification state and `npm run lessons:record` (snapshot-style recording of real output).
- **PostgreSQL lessons 1–2**: *Tables, rows and constraints* (types, identity keys, NOT NULL/UNIQUE/CHECK with real error messages, identity gaps); *Relationships, joins and grouping* (linking table, foreign keys, composite keys, JOIN, LEFT JOIN, GROUP BY, count(column) vs count(*)). Marked **pending**: expected tables were produced with a formatter following psql's aligned-output rules and error messages were written from PostgreSQL 16 behaviour, but no real server was available to confirm them. `INSERT oid count` semantics were confirmed against the official INSERT documentation.
- **HTTP practice server for executable lessons** (`scripts/lib/practice-server.ts`): a real DevForge server with an in-memory database, started in a **child process** (found during development: running it in-process deadlocks, because the runner executes bash synchronously and blocks the event loop). Lessons address it as `$API`.
- **Postman lessons 1–2**: *HTTP requests and responses* (anatomy, status families, headers, query strings, methods, debugging 403 → 415 → 401 → 400 step by step; then the same in Postman); *Sessions, chained requests and API tests* (session cookies, chaining, sign-out revocation, shell assertions; Postman environments, cookie jar, `pm.test` scripts, Collection Runner, Postman CLI/Newman, secrets). All curl output executed and compared; Postman UI steps and `pm.test` API confirmed against Postman's Learning Center (2026-11-25), not executed.
- **Redis in executable lessons**: ```` ```redis run ```` blocks piped to `redis-cli --no-raw`; CI adds a Redis 7 service. Safety gate: lessons start with `FLUSHDB`, so they run only with `DEVFORGE_REDIS_TEST=1` (set in CI), and the runner refuses otherwise — tested with stub executables.
- **Redis lessons 1–2** (**pending**): *Keys, values and Redis data structures* (strings, atomic counters, expiry and TTL -1/-2, hashes, lists as queues, sets, sorted-set leaderboard); *Caching and rate limiting with Redis* (cache-aside in shell functions, hits/misses, invalidation, fixed-window limiter, why DevForge's in-memory limiter needs Redis when scaled out, the INCR/EXPIRE gap and `EXPIRE … NX`). The `NX` option's Redis 7.0 availability was confirmed against the official command reference.
- **Nginx in executable lessons**: Nginx runs unprivileged with a per-lesson prefix on port 8088; CI installs Nginx 1.24. The runner now composes a single EXIT trap for all cleanup (database drop, stopping a leftover Nginx), tested by killing a background process after a failing block. (Found while testing: a killed process can remain a zombie until reaped; the test treats that as stopped.) The practice server can bind a fixed port (8080 for Nginx lessons).
- **Nginx lessons 1–2** (**pending**): *Nginx configuration and static files* (contexts and directives, `nginx -t`, unprivileged start/stop with `-p`, static serving, content types, `server_tokens off`, reading the access log); *Reverse proxy, 502 errors and load balancing* (proxying to DevForge with forwarding headers, which headers come from where, diagnosing a 502 from `error.log`, round-robin across two demo backends, trusting `X-Forwarded-For` only behind your proxy, `PUBLIC_ORIGIN` when browsing through a proxy).
- **Docker lessons executable in CI**: safety gate `DEVFORGE_DOCKER_TEST=1` (fixed container/volume names are force-removed), set in CI. Lesson 1 *Images vs Containers* converted from docs-checked to **pending** executable form (content version 2) and its image tag pinned to `nginx:1.27-alpine`, consistent with the lesson's own advice against moving tags; an explained `sleep 1` avoids a race after `docker start`.
- **Docker lesson 2** (**pending**): *Keeping data with volumes and bind mounts* (data loss without a volume, named volumes shared by short-lived containers, inspecting volumes, live-editing through a read-only bind mount, a blocked write proving `:ro`, cleanup and why `docker rm` keeps volumes).
- **GitHub Actions workflow checker** (`scripts/lib/workflow-check.ts`): structure, pinned actions, declared permissions, script-injection detection. Applied to DevForge's own workflows and to every workflow in lessons, including a deliberately invalid example that must be flagged for its intended rules.
- **CI action versions corrected**: DevForge's workflows used `actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4` (from out-of-date knowledge). Web verification on 2026-11-25 found checkout v7.0.0 (official release page), setup-node v6 and upload-artifact v6 (Node.js 24); workflows updated.
- **GitHub Actions lessons 1–2** (**executed**): *Your first workflow* (events/jobs/steps/runners, exit codes, a check script proven to pass and fail locally, the workflow committed and pushed to the practice remote, then GitHub UI steps); *Pull requests, required checks and safe workflows* (branch, push, fast-forward merge, required status checks, a matrix, and four safety rules with an invalid example and its fix). Local commands executed; GitHub-side behaviour documented from GitHub Docs and release notes, not run. Real outputs filled by `npm run lessons:record`.
- **Bug caught by the checker during authoring**: an example `run: echo "Thanks for: $TITLE"` was invalid YAML (colon-space in a plain scalar) — GitHub would have rejected it, and the "invalid" example was being flagged for the wrong reason. Fixed, and the test now requires invalid examples to parse.
- **Cross-lesson fix**: the PostgreSQL lesson's Docker command now stores data in a named volume (`devforge-pgdata`), so a learner's database survives removing the container (content version 2).

### Terraform track (Path 2)

- CI installs **Terraform 1.15.6**, verified against HashiCorp's published SHA-256 checksums (1.15.0 released 2026-04-29; 1.15.6 confirmed on HashiCorp's announcements forum).
- **Terraform lesson 1** *Your first configuration — init, plan, apply, destroy* (**pending**) and **lesson 2** *Variables, validation, outputs and state* (**pending**): `hashicorp/local` provider (no cloud account), `fmt -check`, `validate`, plan/apply/destroy, idempotent re-plan, typed variables with validation (a rejected value), update-versus-replace in plans, state contents in plain text and how teams protect state, licence context (BSL since 1.6; OpenTofu fork from 1.5, 2023).
- **Risks:** HCL formatting must match `terraform fmt` exactly (written to its alignment rules); the provider downloads need network (CI has it).

### Kubernetes track (Path 2)

- CI installs **kind v0.32.0** and **kubectl v1.36.1**, both checksum-verified (kubectl per the official procedure). kind v0.32.0's release notes give the default node image `kindest/node:v1.36.1@sha256:3489c767…`, pinned by digest in the lessons.
- Runner: kind clusters created by a lesson are deleted in the cleanup trap even on failure (tested with a stub). CI job timeout raised to 40 minutes.
- **Kubernetes lesson 1** *Deployments, Pods and self-healing* (**pending**) and **lesson 2** *Services, rolling updates and rollback* (**pending**): desired state and controllers, `kubectl wait`, a Deployment of three replicas, deleting a Pod and watching it be replaced, scaling to five, a ClusterIP Service reached via port-forward, a rolling update, a deliberately broken release that stalls while four old Pods keep serving (maxUnavailable 25% of 5 → 1), rollback, rollout history, cluster deletion.
- **Risks:** the kind release asset `kind-linux-amd64.sha256sum` is assumed to exist (CI will show if not); expected kubectl output was written from documentation, with wildcards for ages, names and progress lines.

### CI run #2 (2026-11-25): ✅ all green

All jobs passed in 2 m 24 s — typechecks, docs lint, build, 139 unit/API/lesson tests (every lesson against real services), 16 browser tests. The mobile-menu fix held on GitHub's runner.

### Jenkins track (Path 2)

- **Jenkinsfile checker** (`scripts/lib/jenkinsfile-check.ts`): comment- and string-aware brace balancing, `pipeline`/`agent`/`stages` structure, stages that do something, hard-coded secrets in `environment`, and credentials interpolated by Groovy in double-quoted strings (the leak Jenkins itself warns about). 8 tests, including all lesson Jenkinsfiles.
- **Runner**: per-lesson time limit (Jenkins 300 s); Docker gating now detected from a lesson's commands, not only its track; groovy syntax highlighting.
- **Jenkins lesson 1** *Jenkins in Docker — controller, agents and first start* (**pending**): pinned `jenkins/jenkins:2.580.2-lts-jdk21` (current LTS per the official LTS changelog, 2026-10-28; LTS now requires Java 21 or 25), a status-code-aware readiness loop with a time limit, `X-Jenkins` version header, unlocking, why builds should not run on the built-in node, cleanup. Runs a real Jenkins in CI. **Risk:** the exact Docker tag follows Jenkins' naming convention but was not confirmed to exist; if the pull fails, CI will say so.
- **Jenkins lesson 2** *Pipeline as code with a Jenkinsfile* (**executed**): a Jenkinsfile running the same `check-notes.sh` as the GitHub Actions lesson, committed in the practice repository (real output recorded with `lessons:record`), running it as a Pipeline job (UI steps, not executed), credentials with an invalid and a safe example, and a Jenkins vs GitHub Actions comparison.

### First GitHub CI run (2026-11-25, ubuntu-24.04 runner, Node 22.23.5)

- Docs lint, both typechecks and the build passed.
- `npm test`: **139 passed, 0 failed, 0 skipped.** The seven lessons that had been `pending` — PostgreSQL ×2, Redis ×2, Docker ×2, Nginx lesson 2 — ran against real services (PostgreSQL 16.16, Redis 7.4.12 via redis-cli 7.0.15, Nginx 1.24.0, Docker API 1.48) and reproduced their documented output exactly; the PostgreSQL service log shows the predicted errors and identity gaps. All seven promoted to `executed`, with the confirmed versions in their verification notes. **No lesson is pending any more.**
- `npm run test:e2e`: 15 passed, 1 failed — *mobile menu closes after navigating*. **Diagnosed**: the menu closed in a separate, later React update (an effect after the route change), leaving a window where the URL had changed but the menu was still open; Playwright's `waitForURL` resolves inside that window, so a slow machine could sample it. Shown deterministically by sampling the menu state across event-loop phases (old: still open after the navigation's microtask flush, closed only on the next task; new: closed in the same flush). A plain 8× CPU-throttling experiment did **not** reproduce it locally — recorded for honesty. **Fixed** in the app (the menu closes in the tap's own update) and in the test (waits for the hidden state).
- Docker Hub pulls for `postgres:16` and `redis:7` succeeded without login; the rate-limit risk did not materialise in this run.

### First run on the owner's machine (2026-11-25, Ubuntu, Node 22.23.2)

- `npm install`, `npm run build`, `npm run user:create`: worked.
- `npm start` crashed with an unhandled `EADDRINUSE` because another program uses port 8080 → **fixed**: a busy or forbidden port now produces a clear message with the command to find the other program and a suggested free port (reproduced and verified).
- `npm run typecheck:web`: **0 errors with the real React types** — closes the largest open risk.
- `npm test`: 132 passed, 6 skipped. **Nginx lesson 1 ran against a real Nginx and passed** → promoted from `pending` to `executed`. Nginx lesson 2 failed only because port 8080 was occupied → the test now **skips** with the reason and the command to find the program, instead of failing (verified with a blocked port).
- `npm audit`: 8 findings (5 high, 3 low) → **fixed**:
  - **zod** (runtime, request validation; memory exhaustion on oversized collections; impact already limited by the 64 KB body limit) → upgraded to `^4.6.7`. All code now imports the Zod 4 API from `"zod/v4"`, which Zod documents as permanently available in both 3.25+ and 4.x, so the code was tested here (Zod 4 API bundled in 3.25.76) and runs on 4.6.7. Zod 4 changed `.default()` to skip transforms, which would have turned `TRUST_PROXY` **on** by default; the config now avoids `.default()` on transformed values and a test asserts the safe default.
  - **js-yaml** (build-time content parsing) → `^4.2.0`, and all YAML is parsed through one function using `CORE_SCHEMA` (plain data only: no merge keys, no timestamps, no JS types). All 43 YAML documents in the repository parse identically with js-yaml 3.15.1 and 4.2.0 (compared programmatically).
  - **markdown-it, smol-toml, katex** (inside the docs linter) → `markdownlint-cli2` `0.23.3`.
  - **To confirm on the owner's machine:** delete `node_modules` and `package-lock.json`, run `npm install`, then `npm audit` should report 0 vulnerabilities.

### Milestone 1 — open verification closed (2026-11-25)

- **Repository recovered first.** The working copy had been moved to the desktop Trash, and the Jenkins/Terraform/Kubernetes work existed only in an unpacked archive without `.git`. The repository was restored to `~/Desktop/devforge18`, the archive's files were applied on top (keeping the repository's `package.json` with the katex audit override, and `package-lock.json`), reviewed, and committed (`4b892a0`). `npm audit`: 0 vulnerabilities.
- **Local baseline before any change:** `npm run verify` — typechecks 0 errors, docs lint 0 issues, build OK (JS 254.8 KB), `npm test` 154 tests (142 pass, 12 skipped for tools that run only in CI, 0 fail). The browser tests first failed in their setup hook because this machine's cached Playwright browser was build 1194 and the installed Playwright needs 1243; `npx playwright install chromium` fixed it (environment, not code) → 16/16.
- **CI run 45643638519 (2026-11-25, 5 m 0 s): ✅ green, 154/154 tests with 0 skipped, 16/16 browser tests.** Jenkins 1 (jenkins/jenkins:2.580.2-lts-jdk21), Terraform 1–2 (Terraform v1.15.6) and Kubernetes 1–2 (kind v0.32.0, kubectl v1.36.1, Kubernetes 1.36.1) ran against the real tools and matched their documented output on the first run, so no output needed fixing. All checksum verifications (Terraform, kind `.sha256sum` asset, kubectl) passed. All five promoted to `executed` with the confirmed versions and run ID in `verification.details`.
- **Link check workflow fixed.** Its first run (45643655123) reached every link but crashed writing `build/link-report.json`, because that workflow has no build step and `build/` did not exist. `scripts/check-links.ts` now creates the folder; reproduced and verified in a fresh checkout without `build/` (exit 0, report written).
- **Every resource reviewed (55 unique URLs, 72 entries).** All returned HTTP 200. Each page's title was compared with the resource's title and purpose, then marked `verified` with `checked_on: 2026-11-25`. Corrected while reviewing:
  - moved pages, updated to their destination: GitHub Skills → `learn.github.com/skills` (the old site now meta-refreshes there); Git downloads → `git-scm.com/install/`; Docker Get started → `docs.docker.com/learn/`; GitHub Actions quickstart → `/en/actions/get-started/quickstart`; LlamaIndex docs and examples → `developers.llamaindex.ai/python/…`; n8n courses → `learn.n8n.io` (n8n Academy); Postman overview → `/docs/getting-started/overview/`;
  - wrong target: the PostgreSQL lesson's "Constraints" resource linked to the manual's front page → now `docs/current/ddl-constraints.html`; the MLflow "classic ML tutorials" link now opened the general platform landing page → now `ml/tutorials-and-examples/`.
  - Kept as is after inspection: `kafka.apache.org/documentation/` (official entry point; redirects by script to the current versioned docs) and `university.redis.io` (Redis University, hosted on the Flockjay platform, hence its page title).
- Browser test updated for the new honest state: the Docker track now shows three "Link checked" labels and no "Link not yet verified" label (was hard-coded to three unverified links).

### Milestone 2 — visual learning system (2026-11-25)

- **CI run 45650635699: ✅ green** — 171/171 unit, API, checker and lesson tests with 0 skipped (every lesson against its real tool), 20/20 browser tests.

- **Media pipeline** (REMAINING_WORK.md §4.2): `content/media/<track>/<name>.svg` with a `.yaml` sidecar (alt text, caption, credit, licence; third-party media need `source_url`), referenced as `![](media:<track>/<name>.svg)`; step-throughs as `<name>.steps.yaml`, embedded with an empty ```` ```diagram steps=<track>/<name> ```` fence. `data-step` reveals and highlights elements; `data-until` hides them.
- **Design change, recorded in ADR 0007:** SVGs are validated against a strict allowlist and **inlined**, not shown with `<img>`, because an `<img>` SVG cannot follow the app's theme toggle or be stepped through. The validator rejects scripts, `foreignObject`, `style` elements and attributes, event handlers, external references, DOCTYPE/CDATA/unknown entities and hard-coded colours, and re-serialises only what it parsed. No CSP change, no new dependency.
- **`StepDiagram`** (`web/src/components/StepDiagram.tsx`): Previous/Next, arrow keys, user-started Play and Pause (Play is not offered under `prefers-reduced-motion`, and transitions are disabled), a live caption, and the full step list as the text alternative. `aria-disabled` instead of `disabled` keeps keyboard focus at the first and last steps (a disabled button would drop focus to the page).
- **Content:** all 21 ASCII diagrams replaced by 22 SVG figures (the caching lesson's diagram covered two ideas, so it became a step-through and a figure). Step-throughs: Git commit cycle, Docker image → containers, Kubernetes rolling update (labelled simplified), PostgreSQL join, Terraform plan/apply, GitHub Actions workflow run, Redis cache-aside, Jenkins controller/agents, Nginx request routing, Postman session. Every caption and label was taken from the lesson's own text or verified output; where a figure shows a subset of the lesson's data (the PostgreSQL join), it says so.
- **Build rule:** a lesson with a "How it works" section must contain a figure or step-through; unused media files are reported as warnings.
- **Tests:** 8 SVG allowlist tests (attacks and malformed input), 3 renderer tests, 8 loader tests (real content renders; unsafe SVG, missing sidecar, mismatched steps, unknown references, third-party media without source, and a missing figure are rejected), and 4 browser tests (buttons, arrow keys and focus at the ends; Play/Pause and no autoplay; reduced motion and the light theme; phone width scrolls inside the figure, not the page). The mobile overflow sweep now includes a lesson with a step-through.
- **Looked at:** every figure in the dark and light themes and the step-through on a 390 px phone viewport; four layout problems (overlapping labels and clipped table text) found that way and fixed.
- **Sizes:** JS 257.2 KB (+2.4 KB), CSS 29.0 KB (+3.0 KB); `content.json` 559 KB with the inline SVGs.
- **Not done in this milestone (still planned):** moving-element animations with the Web Animations API (§4.2 level 3) — step-throughs with Play cover the "watch the process" goal for now; photographs and screenshots (`<img>` pipeline) until there is a real screenshot to add.

### Milestone 3 — simulation framework, Git and Kubernetes (2026-11-25)

- **CI run 45655582859: ✅ green** — 221/221 unit, API, model and lesson tests with 0 skipped (including the Git model compared with real Git on the runner), 24/24 browser tests.

- **Framework** (REMAINING_WORK.md §4.3): `shared/simulations/types.ts` defines the model contract — pure and deterministic (`next = step(state, action)`), with `init`, invariants, named challenge checks and a text description — plus `replay()`. Model logic has no dependencies; each model's zod schemas live in `schema.ts` (server and build only) with compile-time checks that they match the model's types (proved to catch a deliberate mismatch).
- **Git commit graph** (§5.1): commit, branch, switch, merge (default / `--no-ff` / `--ff-only`), rebase, `reset --hard`, revert, with origin/main for pushed history and a warning when a reset rewrites it. Real Git 2.43 behaviour was observed first (merge messages, `--ff-only` refusal, revert message, rebase); **seven command sequences are run through real Git in the tests and must produce the same graph**, including `Merge branch 'main' into feature`.
- **Kubernetes reconciliation** (§5.3): kubelet, Deployment controller (maxSurge rounds up, maxUnavailable rounds down, both 0 refused or resolved to 1 unavailable, unhealthy old Pods removed first), ReplicaSet controller and scheduler; delete Pod, drain/uncordon, scale, set image, strategy, rollout undo (reuses the old ReplicaSet with a new revision). A property test checks every strategy combination at 1–8 replicas (availability never below `replicas − maxUnavailable`, never more than `replicas + maxSurge` Pods, completes). **A broken image with 5 replicas stalls at 4 available, matching the real kind cluster's output in CI for the lesson.** A first draft of the surge invariant was wrong (it fired right after a manual scale-down, which Kubernetes also allows until the controller's next pass); it was narrowed to rolling updates, which the property test covers.
- **Content:** `content/simulations/` with scenarios, challenges, simplifications (each saying what the real tool does) and text alternatives; 3 challenges each. The build replays every challenge's reference solution and fails unless it passes, and unless the check fails at the start.
- **Server-verified progress (ADR 0008):** migration `0002_simulation_progress`; `GET /api/simulations/:id` (no solutions); `POST …/challenges/:challenge/verify` validates each action with the model's strict schema, limits a run to 400 actions and 3,000 ticks, replays it and saves only passing runs for signed-in learners, once.
- **UI:** `SimulationShell` (Simulation badge, simplifications, scenario picker, Reset, Step, Play/Pause and speed for time-based models — no Play under reduced motion; paused off-screen and in background tabs — text mode, event log, challenges with hints and live status), the Git graph view (lanes, branch/HEAD/origin labels, unreachable commits dimmed, commit list, command form with the exact `git` command) and the cluster view (nodes, Pod chips with written phases, drain/uncordon, ReplicaSets, controls with the exact `kubectl` command). Simulation pages at `/tracks/<track>/simulations/<id>`, a **Simulations** section on every track page, and embeds in 3 lessons (`git-first-commits`, both Kubernetes lessons).
- **Code splitting** (§6.2): simulations load as separate chunks (Git 15 KB, Kubernetes 17 KB, shared 9 KB); the main bundle is 259.6 KB (+2.4 KB). The first build put zod with all its locales (454 KB) into the simulation chunk; separating model logic from schemas removed it.
- **Accessibility found while testing:** form fields that wrapped a `<select>` in its `<label>` gave the select an accessible name including every option's text; they now use a `Field` component with `htmlFor`. The Git form showed a branch-naming error when no other branch existed; it now says so.
- **Tests:** 20 Git model tests (7 against real Git), 13 Kubernetes model tests, 6 loader tests, 2 renderer tests, 10 API tests, 4 browser tests (keyboard-only challenge saved through the server and shown as Done after reload; Step, self-healing and text mode in the light theme; reduced motion; lesson embed and track-page link). Mobile overflow sweep includes both simulation pages.
- **Looked at:** both simulations in dark, light and on a 390 px phone; the Git graph now keeps its natural size and scrolls in its frame on phones (a global `svg { max-width: 100% }` was shrinking it to unreadable size).
- All 21 lessons' `content_version` incremented (new figures in milestone 2; simulation embeds in three).

### Milestone 4 — Path 2, part 1: Prometheus + Grafana (2026-11-25)

- **CI run 45668986449: ✅ green** — Prometheus 3.16.0 and Grafana 13.3.2 installed and checksum-verified on the runner; all three lessons ran against them (not skipped); 237/237 tests, all browser tests passed.

- **Versions** from the projects' GitHub releases (2026-11-25): Prometheus **3.16.0** (2026-11-05) and Grafana **13.3.2** (2026-11-24). Both are installed in CI from the official archives, checksum-verified (Prometheus `sha256sums.txt`; Grafana's `.sha256`, which holds the hash only).
- **Decision: native binaries, not containers.** DevForge listens on `127.0.0.1`, which a container on Docker's default network cannot reach; `--network host` works on Linux but needs extra setup in Docker Desktop. The official binaries behave the same on every OS, so beginners avoid networking problems; the lessons mention containers for later.
- **Lesson 1** *Metrics, labels and the /metrics endpoint* — DevForge's own metrics: HELP/TYPE lines, counters, gauges, histogram buckets, one series per label set, why the route label holds a pattern. Runs with curl against a practice server (no extra tools), so it runs locally and in CI.
- **Lesson 2** *Running Prometheus — scraping and your first PromQL* — config checked with `promtool`, readiness, `up`, label matchers, `sum by`, `rate()`, `histogram_quantile()`, and a real parse error. Waits for conditions with a PromQL comparison instead of sleeping; sorts results because Prometheus does not promise an order. A self-check option first contained `rate(sum(...)[5m])`, which is not valid PromQL; replaced.
- **Lesson 3** *Grafana — a data source and a dashboard from files* — provisioning files, `GF_` environment variables, `/api/health`, dashboard search, data source health, a 401 without credentials.
- **All three recorded against the real tools on this machine** (`npm run lessons:record`, Prometheus and Grafana from the verified archives): lesson 1 and 3 matched as written; lesson 2 had one difference (no leading space in promtool's error), now recorded. Facts checked against prometheus.io and grafana.com pages on 2026-11-25 (metric types, naming, rate(), jobs and instances, management API, promtool, Grafana configuration, sign-in and provisioning).
- **Runner:** `lessonNeeds()` now holds the per-track rules (practice server, port, time limit) shared by the tests and `lessons:record`; background jobs a lesson starts (`prometheus … &`) are stopped by the cleanup trap even if a later block fails (tested); `GRAFANA_HOME` is passed through.
- **Simulation** *Scrape, rate and percentiles* (§5.7): two instances, scrape interval, range, restarts, `rate`, `sum(rate)`, `rate(sum)` (as a real subquery) and `histogram_quantile` aggregated three ways. rate()'s reset rule and histogram_quantile's interpolation follow the documentation (worked examples in the tests); it says that real rate() also extrapolates. Three server-verified challenges. 11 model tests; a browser test shows `rate(sum())` overestimating after a restart and `sum(rate())` giving the true 15/s. Embedded in lesson 2.
- Figures: the anatomy of a metric line, the scrape loop (step-through), how Grafana, Prometheus and DevForge fit together.

### Milestone 4 — Path 2, part 2: OpenTelemetry (2026-11-25)

- **CI run 45675259630: ✅ green** — the Collector and Jaeger installed and checksum-verified on the runner; all six Path 2 lessons ran against their real tools; 249/249 tests with 0 skipped, 26/26 browser tests. (Run 45674074140 for the OpenTelemetry commit passed its 249 tests and was then cancelled by the next push.)

- **CI run 45670107268 (a docs-only commit) failed** on a timing race in an older runner test, *cleanup stops a background process*: it checked the process the instant the trap sent `kill`, and signals are delivered asynchronously. It had passed in earlier runs. The failure went unnoticed for one commit because that run was not watched; the test now allows the process up to three seconds to exit (the property under test is unchanged).

- **Versions** from the projects' GitHub releases and the npm registry (2026-11-25): Collector **0.166.0** (the core `otelcol` distribution), Jaeger **2.23.0**, OpenTelemetry JavaScript **3.1.1** with `@opentelemetry/sdk-node` **0.301.2** (its dependency list pins core 3.1.1; it requires Node.js ≥ 22.15.0, which DevForge's own minimum already meets). CI installs the Collector (archive checked against its `.sha256`) and Jaeger (its checksum file lists the programs *inside* the archive, so CI verifies after unpacking).
- **Lesson 1** *Traces, spans and context* — a Collector with the `debug` exporter, a hand-written two-span trace in OTLP/JSON (the W3C Trace Context specification's own example IDs), the `traceparent` format, a rejected malformed ID.
- **Lesson 2** *Instrumenting a Node.js service* — the SDK loaded with `node --import`, two services (frontend → backend), and following the propagated `traceparent` to the exact spans it connects. Found while trying it: ES-module services are not instrumented by `--import` alone (they need an extra loader hook), so the services are CommonJS, as in the official getting-started example.
- **Lesson 3** *The Collector pipeline and Jaeger* — receiver, `batch` processor and `otlp` exporter in front of Jaeger; Jaeger's OTLP ports moved with `--set` and its UI bound to 127.0.0.1 (by default it listens on all interfaces); traces looked up through `/api/v3`, which Jaeger documents as stable (its older `/api/traces` is marked internal); the resource attributes (host name, command line) the SDK adds by itself.
- **Found while recording:** stopping the Collector together with the services delayed their exit (the SDK's final export had nowhere to go), which could leave ports busy for the next lesson in a chain. The lessons now stop the services first, wait for them to exit, then the Collector — verified with two complete runs back to back.
- **Facts** checked against primary sources on 2026-11-25: the OpenTelemetry Node.js guide and JS 3.0.0 release notes, the W3C Trace Context Recommendation, `trace.proto` (span kinds), the Collector configuration page and batch processor README, and Jaeger's getting-started and API pages. The OTLP specification page returned a server error, so the lessons call 4317/4318 "OTLP's usual ports" (as Jaeger's API page lists them) rather than quoting the specification.
- **Runner:** optional tools (prometheus, promtool, grafana, otelcol, jaeger) are detected from a lesson's and its prerequisites' commands by `toolsUsed()` (tested), replacing per-tool special cases.
- **Simulation** *Trace waterfall* (§5.15): gateway → api → cache, database, payment; added latency, cache hit/miss, sequential or parallel calls; self time and critical path. 8 model tests with hand-worked timings (109 ms sequential, 84 ms parallel or cached, 209 ms with a slow database). Two challenges: find the slow span (largest own time — the long parent bars are only waiting), and get checkout under 150 ms without touching the database's latency (the check enforces that condition, which the first draft only stated). Embedded in lesson 1; a browser test covers both challenges and the critical path moving to the database.

### Milestone 5 — Kafka (2026-11-25)

- **Version:** Apache Kafka **4.4.0** (2026-10-22, the latest release on Apache's download site), run from the official `apache/kafka:4.4.0` image pinned by its multi-architecture digest `sha256:833b867a…`, as Kafka's own quickstart does. A container (not a native install) because Kafka needs Java; the tools run inside the container, so the localhost problem that ruled out containers for Prometheus does not arise.
- **Lessons:** *Events, topics and partitions* (KRaft broker, a 3-partition topic, keyed events landing in one partition each, per-partition order); *Consumer groups, offsets and lag* (committed offsets, lag rising and falling, `__consumer_offsets`, replay with `--reset-offsets`); *Scaling consumers and rebalancing* (four members for three partitions — one idle — and a rebalance when one leaves, with the newer KIP-848 protocol).
- **Behaviour found by running 4.4.0 first, and taught accordingly:** `--property` and `--consumer-property` are deprecated (now `--reader-property`, `--formatter-property`, `--command-property`); without `--execute`, `--reset-offsets` warns that Kafka 5.0 will require `--dry-run` or `--execute`; a reset is refused for an active group with an exact message; group membership takes seconds to settle, so lesson 3 waits for a settled group and summarises it (member IDs are random) — and its leaving member's timeout was raised from 20 s to 45 s after the group took 17 s to settle locally.
- **Facts** checked against the Kafka 4.4 documentation on 2026-11-26 (local date; content dated 2026-11-25 to match UTC): keys and ordering, the default partitioner, one consumer per partition per group, 168-hour default retention and that reading does not delete, the removal of ZooKeeper, KIP-848 GA but opt-in. Two points the pages read did not state (the `__consumer_offsets` name, idle members) are shown from real output instead of asserted.
- **Runner:** Docker gating now also looks at prerequisite lessons (lessons 2–3 use a `kafka` function defined in lesson 1), in both the tests and `lessons:record`; containers a lesson starts with `docker run --name` are removed by the cleanup trap (tested with a stub).
- **Simulation** *Partitions and consumer groups* (§5.10): lag, uneven keys (two members are not enough because one owns both busy partitions), idle members, crashes, added partitions moving keys, and resets refused while members are active. 9 model tests; three server-verified challenges; a browser test; embedded in lesson 3.
- Figures: a topic's partitions, offsets and lag (step-through), a group's assignment.
- **CI:** confirmed in run 45681887774 (262 tests, 27 browser journeys), after a fix: lesson 1's first `docker run` printed pull progress on a cold cache, so it now pulls quietly first (checked locally after removing the image).

### Milestone 5 — Airflow (2026-11-25)

- **Version:** Apache Airflow **3.4.0**, from the official `apache/airflow:slim-3.4.0-python3.12` image pinned by digest `sha256:2d3e42b9…`, run as `airflow standalone` (the quick start's development mode: every component plus SQLite). The REST API is used with a token from `/auth/token`, using the password the simple auth manager generates in the container.
- **Lessons:** *DAGs, tasks and runs* (a TaskFlow DAG, a run triggered through the REST API, task states, an XCom value); *Schedules, logical dates and catchup* (five catch-up runs for 1–5 January, none without catchup); *Retries, failures and safe re-runs* (a task that succeeds on try 2, a failure that leaves its downstream task `upstream_failed`, and why tasks must be safe to repeat).
- **Behaviour found by running 3.4.0 first:** the scheduler is healthy after about 15 s; a manual run finishes in about 9 s; with `@daily`, start 1 January, end 5 January and catchup, there are 5 runs whose data interval starts and ends at the logical date (the trigger timetable); without catchup, none. A new DAG file was picked up within seconds although `refresh_interval` defaults to 300 s — the lessons wait for the DAG instead of assuming a delay.
- **A correction from the documentation:** the first draft said that without catchup "past times are skipped". The timetables page says the trigger timetable runs the **most recent** schedule time straight away; the lesson's DAG gets no run only because its `end_date` is in the past. Lesson 2, its self-check and the figure caption now say so.
- **Facts** checked against the Airflow 3.4 documentation on 2026-11-25 (UTC): the architecture (task code reports through the API server and never reaches the metadata database; the DAG processor is a separate process; the executor runs inside the scheduler), logical dates and data intervals, `catchup_by_default=False`, `upstream_failed` and the `all_success` default, XComs for small data, the best-practice that tasks produce the same outcome on every re-run, and backfill reprocess behaviours (`none`, `failed`, `completed`).
- **Runner:** an Airflow lesson may take up to 420 s (pull, start-up and catch-up; the three ran in 3 m 20 s from a cold image cache locally).
- **Simulation** *Scheduler timeline and backfills* (§5.16): a daily DAG whose load task appends or replaces each day's rows; catchup on deployment, a flaky source, retries, clears and backfills with the three reprocess behaviours; the table shows each day's rows against the right number, so a successful run with duplicated data is visible. 17 model tests; three server-verified challenges (get through a flaky week; fill in missed days; backfill a broken week without duplicates — re-running failed dates while the task appends is shown to be wrong); a browser test; embedded in lessons 2 and 3. A browser test caught that the backfill range kept the first scenario's dates after switching scenarios; it now follows the scenario until the learner picks dates.
- Figures: the parts of Airflow 3, catchup on and off, the payments run (step-through).
- **CI:** confirmed in run 45686715121 (282 tests, 28 browser journeys; all three Airflow lessons executed).
- **A race found later by a local run:** lesson 2 asked for the no-catchup DAG's runs as soon as the catch-up runs had finished; once, that DAG had not been parsed yet, so the API answered "not found". The step now waits for the DAG and also shows `next_dagrun_run_after: null` (no future schedule time), which is better evidence than an empty run list; it then passed twice in a row.

### Milestone 5 — MLflow (2026-11-25)

- **Version:** MLflow **3.18.0** (released 2026-11-04, the latest on GitHub), from the official `ghcr.io/mlflow/mlflow:v3.18.0` image pinned by digest `sha256:257204c7…`. The image also contains Python 3.11, scikit-learn 1.9.1 and pandas, so the lessons train real models without installing anything; scripts are fed to the container's Python with `docker exec -i … python -`, so no files are written into the learner's folder by the container.
- **Lessons:** *Experiments, runs, parameters and metrics* (a tracking server, a Ridge model on scikit-learn's bundled diabetes data logged as runs, the runs read back through the REST API); *Comparing and searching runs* (a sweep of Ridge and Lasso settings, `search_runs` sorted and filtered, the best run tagged with the reason); *Models, signatures and the registry* (two registered versions, the `champion` alias moved between them with the serving script unchanged, a signature refusing input without `bmi`).
- **Determinism:** the data ships with scikit-learn and the split uses a fixed seed, so the printed metrics (rounded to two decimals) are the same on every run; where the REST API returns full precision, the lesson shows the leading digits and `…`. Two settings documented in MLflow's environment-variable reference keep the output stable: `MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT` (the run URL contains a random ID) and `MLFLOW_LOGGING_LEVEL=WARNING` (registration logs a timestamped line); `GIT_PYTHON_REFRESH=quiet` silences GitPython's warning that the container has no Git. A second recording on a fresh container changed nothing.
- **Found by running it:** the best run of the sweep is a Lasso run (RMSE 52.48), not a Ridge one; the lessons say so, and lesson 3 explains why it registers Ridge models anyway (one setting differs between versions).
- **Facts** checked against the MLflow documentation on 2026-11-25: runs and experiments, the tracking server's defaults and stores, aliases and `models:/<name>@<alias>`, signature enforcement when a model is loaded as pyfunc, `name=` in MLflow 3's `log_model`. Not stated on the pages read, so shown from real output instead of asserted: the filter syntax (`params.model = 'lasso'`), the REST `runs/search` endpoint, and the exact error for a missing input. The lessons avoid claiming that model stages are deprecated, which the pages read did not say.
- **Simulation** *Experiment explorer and model registry* (§5.18): ten runs of three kinds with invented error and latency (labelled as invented), sorting and filtering, a scatter plot with the latency budget, registering versions and moving `@champion`, with the trade-off spelled out in the event log. 8 model tests; three server-verified challenges (the most accurate model; the best model within 5 ms; roll back a too-slow promotion by moving the alias); a browser test; embedded in lessons 2 and 3.
- **Tests made stricter:** Playwright's `hasText: "Solved"` matches "Not solved yet" too (case-insensitive substring), so the simulation browser tests waited for nothing. They now match `/^Solved/`; all ten still pass, so every earlier "solved" was real.
- Figures: what tracking records and where, searching runs (a step-through built from the recorded sweep), versions and an alias.

### Milestone 5 — LangChain + LlamaIndex (2026-11-25)

- **No real model is called, anywhere.** As REMAINING_WORK.md §5.8 requires, the lessons use deterministic stand-ins: LangChain's `FakeListChatModel` (its docstring: "Fake chat model for testing purposes"), a hand-made keyword embedding labelled as a teaching model, and LlamaIndex's `MockLLM`, which returns the prompt it receives — so the third lesson shows the exact prompt a RAG query builds. Using a real model is described (a provider package and the learner's own key, which costs money) but never run.
- **Versions:** `python:3.12-slim` pinned by digest `sha256:191083cd…`; langchain-core **1.8.4** (2026-11-19), numpy **2.5.5** (2026-11-15, needed by `InMemoryVectorStore` — found when the first recording failed), llama-index-core **0.14.26** (2026-11-13), all exact versions from PyPI. Only the top-level packages are pinned; their own dependencies are resolved by pip at install time (see risks).
- **Lessons:** *Prompts, models and output parsers* (a prompt template, `prompt | model | parser` as a RunnableSequence, JSON output validated with Pydantic — accepted, not JSON, and valid JSON with a disallowed value); *Embeddings and similarity, with small vectors* (a four-topic keyword embedding, cosine similarity by hand, `InMemoryVectorStore`, and a question with no known words whose zero vector makes the search fail — the case for learned embeddings); *Chunking, retrieval and the prompt a RAG system builds* (LlamaIndex `SentenceSplitter` at two chunk sizes, retrieval with sources, the assembled prompt, clean-up).
- **Found by running it:** with 60-token chunks, the best match for "What happens when the TTL of a cache entry runs out?" is a 13-word chunk that mentions TTLs but does not answer; the answering sentence is in the second hit. The first draft claimed the opposite. Lesson 3 now teaches exactly this (similarity is "about the same thing", not "answers the question") and retrieves with k=2.
- **Facts:** checked against the langchain-core 1.8.4 and llama-index-core 0.14.26 source and docstrings (Runnable, fake chat models, the Embeddings interface, `InMemoryVectorStore` using cosine similarity, `chunk_size` in tokens, the default text-QA prompt) and the LangChain and LlamaIndex embeddings pages (both verbatim). Not verified from an official source, so not stated: when and by whom the two projects were started.
- **Simulation** *A RAG pipeline, end to end* (§5.8): three documents of four sentences with hand-made vectors; chunk size 1–4 and k 1–6; every chunk ranked by cosine similarity, the retrieved ones highlighted, the answering sentence marked, and the assembled prompt with its length against a budget. 9 model tests, including that each challenge has exactly one solution: the TTL question needs one-sentence chunks and k=3 (big chunks bury the answer among Kafka and Docker sentences), the why-cache question needs two-sentence chunks (the answer needs its neighbour's context). A browser test; embedded in lesson 3.
- Figures: the parts of a chain, cosine similarity (a step-through whose vectors are computed from the lesson's own sentences), the RAG pipeline.
- **CI:** the first run after this commit (45699232410) failed — not in these lessons but in the runner's own test that background jobs are stopped by the cleanup trap: a background `sleep` survived and held the output pipe until the 60 s timeout. It never failed locally (0 survivors in 200 runs). The trap read the job list inside a `$(…)` subshell; it now reads it in the lesson shell, kills those jobs, then falls back to `pkill -P $$`, and every step ends in `|| true`. With that fix, run 45701836727 passed (305 tests, 30 browser journeys, including these three lessons).

### Milestone 5 — n8n (2026-11-25)

- **Version:** n8n **2.49.6** — the latest stable release (2026-11-25; 2.50.x and 3.4.0 are pre-releases), from the official `n8nio/n8n:2.49.6` image pinned by digest `sha256:a1a9955a…`, with `N8N_DIAGNOSTICS_ENABLED=false`.
- **No editor clicks needed:** workflows are written as JSON in the lessons (exactly what the editor stores) and loaded with n8n's own CLI — `import:workflow`, `execute --id`, `publish:workflow` (n8n 2 replaced activate/deactivate with publish/unpublish, per its CLI documentation) — so every step is visible and executable.
- **Lessons:** *Workflows, nodes and items* (a manual trigger, a Code node returning three items, a Filter; the items of every node read from n8n's own execution record); *Webhooks and expressions* (404 before publishing, a published webhook answering with fields built by expressions); *Validating input and handling errors* (an If node answering 400 with a reason, an HTTP Request node whose error output answers 502 while the seat service is down, and 200 once a three-line Node.js seat service runs; clean-up).
- **Found by running it:** `n8n execute` inside the running container collides with the server's task-broker port (so the lessons move it with `N8N_RUNNERS_BROKER_PORT`); the first import right after start-up can hit the database while n8n initialises (so imports retry); a published webhook takes a moment to register (so the lessons wait for it); and the Filter node's execution record also lists the item it dropped, which the lesson shows rather than hides.
- **Facts** checked against the n8n documentation on 2026-11-25: nodes, trigger nodes and items; the Code node; test and production webhooks and publishing; Respond to Webhook and response codes; Retry On Fail, On Error (Continue using error output) and error workflows with the Error Trigger; the CLI; the encryption key for credentials. Not found in the documentation pages read, so not stated: the `{{ }}` syntax being JavaScript (shown working instead) and the terms of n8n's licence.
- **Simulation** *Workflow executor* (§5.17): five form submissions through Form → Valid? (If) → Check seats → Save; the learner chooses the checks, where the false branch goes, On Error and Retry On Fail, runs the batch and sees every node's outputs and every item's outcome (saved, error workflow, dropped silently, or not saved because the execution failed). 9 model tests; three server-verified challenges (report invalid submissions instead of dropping them; complete the checks; survive a flaky service — where an error output alone would report a valid submission instead of saving it, and a retry is the fix); a browser test; embedded in lesson 3.
- **Cold cache:** all three lessons pass after removing the image (4 m 32 s including the 1.3 GB pull).
- **CI:** confirmed in run 45704707925 (317 tests, 31 browser journeys; all three n8n lessons executed).
- **A flaky first execution:** once, in a full local run, lesson 1's first `n8n execute` produced no JSON and the reason was hidden (the helper discarded stderr); it did not happen in five fresh starts. The `items` helper now retries `execute` up to five times, parses only from the line where the JSON starts, and prints n8n's own output if it still fails, so a future failure explains itself.
- Figures: items through the Big orders workflow, one webhook request (step-through), the branches of the validated sign-up.

### Milestone 5 — Jira (2026-11-25)

- **Following §5.12: a real Jira site is never required.** Jira is a hosted service, so lessons 1 and 2 are **docs-checked** (marked on the page, dated), and lesson 3 is **executed with Git only**.
- **Lessons:** *Work items, types and workflows* (Atlassian's own definitions of epics, stories, tasks, bugs and subtasks; keys; workflows; writing a story with checkable acceptance criteria; a read-through lab with a checklist); *Sprints, boards and work-in-progress limits* (backlog, planning against capacity, the sprint goal, the last column as "done", where unfinished work goes, column constraints, burndown and cumulative flow); *Linking work items to branches and commits* (keys in branch names, commits and pull request titles; `git log --grep`, a key count for release notes, and a check that catches a lower-case key that would link to nothing).
- **Facts:** the work types are quoted from Atlassian's "What are work types?" page; development references, completing a sprint, column constraints and the burndown come from Atlassian's support pages (their bodies were read partly as summaries, so the lessons only state what those summaries and search results agree on). The "issues" → "work items" naming change is cited from Atlassian's developer-community announcement. Atlassian's user-story and acceptance-criteria articles could not be read, so the story format is presented as common practice, not as Atlassian's guidance, and those pages are not cited.
- **Simulation** *Sprint board* (§5.12): a three-person, ten-day sprint over an eight-story backlog (34 points) with two blockers on fixed days; plan, set the In Progress WIP limit, play day by day with a burndown and the board. Starting more stories than developers costs focus (10 % each, down to half — labelled as a simplification). Calibrated so that: with everything committed, WIP 8 misses the sprint goal (19 points left) while WIP 2–4 meets it; WIP 1 is worse than 2–4 because a blocked story then stops the team; and even WIP 3 leaves 6 points unfinished until the plan is cut. 9 model tests; two server-verified challenges (meet the sprint goal; finish everything committed); a browser test, which also covers the docs-checked label; embedded in lesson 2.
- Figures: the work-item hierarchy and a workflow, a sprint from planning to completion (step-through), keys linking code to a work item.

### Milestone 5 — Docker, lesson 3 and simulation (2026-11-25)

- **Lesson** *Writing a Dockerfile — layers, cache and .dockerignore* (executed): a well-ordered Dockerfile (dependency list, install, then code) where a code change reuses layers 1–3 and rebuilds only the last; the same project copied all at once, where the slow install reruns and `secrets.env` lands in the image; `.dockerignore` keeping it out. A `RUN sleep 2` stands in for installing dependencies, so only `alpine:3.20` is downloaded.
- **Builder differences:** this machine has no buildx, so `docker build` uses the legacy builder and prints a deprecation notice; CI has Docker Buildx 0.39.0 (BuildKit). The lesson therefore keeps the builder's messages in a log (shown only on failure) and compares the image's **layer digests**, not build output. CI is the first run on BuildKit.
- **Facts** checked against Docker's documentation on 2026-11-25 (quoted: "Once a layer changes, then all downstream layers need to be rebuilt as well"; order "from less frequently changed to more frequently changed"; `.dockerignore` removes files from the build context). Corrected before publishing: the draft said COPY's cache compares file *contents* (the documentation says a checksum from file metadata, modification time excluded) and that CMD "adds no layer" as a documented rule (the documentation describes every instruction as a layer; the lesson now states only what it counts: CMD adds no *file* layer). An unsourced claim about deleted files persisting in earlier layers was removed.
- **Simulation** *Layer cake and cache* (§5.2): a Dockerfile of six possible steps to switch on, off and reorder; edit the code or the dependency list; build and see each step reused or rebuilt, the time, the size and the files in the image; impossible orders fail with the reason (installing before the dependency list is copied). 9 model tests; two server-verified challenges (a code change in one second; keep the secret out); a browser test; embedded in lesson 3.
- Figure: layers and the build cache (step-through).
- **Tests made content-driven:** three tests (two API, one browser) hard-coded that the Docker track has 2 lessons; they now read the count from the content or the API, so adding lessons to the Path 1 tracks does not break them. The Docker lesson time limit was raised to 120 s (lesson 3 with its two prerequisites took 27 s locally; CI's first BuildKit build may be slower).

### Milestone 5 — Kubernetes lesson 3 (2026-11-26)

- **Lesson** *Probes, requests and limits* (executed on kind, kindest/node v1.36.1 pinned by digest): a readiness probe on a missing path keeps both Pods `0/1` and their Service endpoints not ready, then fixing the path makes them ready; the documentation's liveness example restarts its container once the file is gone; a Pod requesting 100 CPUs stays Pending with "Insufficient cpu"; a container over its 64 MiB limit is OOMKilled; the cluster is deleted.
- **Recorded locally for the first time:** Kubernetes lessons had only ever run in CI. This time kind v0.32.0 and kubectl v1.36.1 — the versions CI pins, checksum-verified — were downloaded into a scratch folder (not installed on the machine) to record the output. Two outputs were timing-dependent in that recording (the number of "Waiting for rollout" lines, and an old Pod's endpoint still listed for a moment); the progress lines are now a wildcard and the step waits until exactly the two new endpoints remain. A long event message is reduced to its stable start.
- **Facts** checked against the Kubernetes documentation on 2026-11-25: what readiness, liveness and startup probes do, that the scheduler places Pods by their requests and leaves unschedulable ones Pending, and that memory limits are enforced by the kernel's OOM killer ("may terminate") while CPU limits throttle. Some of these pages were read partly through summaries, so the lesson shows the behaviour from real output and uses the documentation's cautious wording.
- Figure: probes, requests and limits (step-through).

### Milestone 5 — PostgreSQL lesson 3 and simulation (2026-11-26)

- **Lesson** *Indexes and EXPLAIN ANALYZE* (executed against PostgreSQL 16): 100,000 generated orders; a sequential scan returning 20 rows with `Rows Removed by Filter: 99980`; an index turning it into a bitmap scan that reads only 20 pages; an index on a column that matches nine rows in ten, which the planner does not use; index sizes. Plans are shown with `COSTS OFF` and `TIMING OFF`, so only plan shapes and real row counts appear.
- **Corrected by running it:** the draft claimed the planner ignores an index for a condition matching half the table; PostgreSQL actually used it (a bitmap scan over all 637 pages). That case is also a near tie that could flip with `ANALYZE`'s random sample, so the data now has nine shipped orders in ten, where the sequential scan wins clearly, and the text describes the bitmap scan the planner really chose. Three more recordings on fresh databases changed nothing.
- **Recorded** against a disposable `postgres:16` container on port 55432; the machine's own PostgreSQL on 5432 belongs to another project and was not used.
- **Facts** checked against the PostgreSQL 16 documentation on 2026-11-25 (EXPLAIN and its options, scan types, `Rows Removed by Filter`, B-tree as the default, the cost of keeping indexes in sync, ANALYZE statistics, multicolumn indexes and leading columns).
- **Simulation** *Query planner and indexes* (§5.4): three queries on 100,000 orders with known distributions; create and drop one- or two-column B-tree indexes; EXPLAIN compares a sequential scan with every usable index (leading columns only) by an invented, labelled cost model and shows rows touched. 8 model tests; two server-verified challenges (touch fewer than 1 % of rows for the customer query; for the pending-on-day query, where an index on status alone is not used); a browser test; embedded in lesson 3.
- Figure: sequential scan or index (step-through).

### Milestone 5 — Terraform lesson 3 and simulation (2026-11-26)

- **Lesson** *Modules, reuse and safe refactoring* (executed with Terraform 1.15.6 and hashicorp/local): one file resource; the same file moved into a child module, where the plan wants to destroy and re-create it because its address changed; a `moved` block that turns that into "has moved to" with 0 to add, change or destroy; a second call of the module adding one file; clean-up. Recorded locally with CI's Terraform version (checksum-verified, in a scratch folder); a second recording changed nothing.
- **Facts** checked against HashiCorp's documentation on 2026-11-26 (modules, root and child modules, local `source` paths and `terraform init`, the default destroy-and-create on a changed address, `moved` blocks and keeping them, `path.module` vs `path.root` — the module writes under `path.root` because the documentation advises against `path.module` for writes — plan symbols, planning modes and drift). The documentation pages are the latest (1.17) versions; the behaviour shown is from 1.15.6.
- **Simulation** *Configuration, state and the real world* (§5.5): an invented "server" resource (name forces replacement, size updates in place); edit the configuration, change or delete real objects "by hand", rename addresses, add moved blocks and apply; the plan refreshes from the real world, shows drift, and lists each change with its symbol. 11 model tests; two server-verified challenges (rename without destroying; resolve drift); a browser test, which caught that the moved block was built from the already-renamed address — it now records the last rename; embedded in lesson 3.
- Figure: a module called twice and a moved block.

### Milestone 5 — GitHub Actions, Redis, Nginx and Postman (2026-11-26)

- **GitHub Actions** — *Caching and artifacts* (executed locally; the workflow is validated by the workflow checker, its behaviour on GitHub checked against GitHub Docs): `actions/cache@v6` keyed on the lockfile's hash, `upload-artifact@v7` / `download-artifact@v8` between jobs, and a local stand-in for `hashFiles` showing when the key changes. Simulation *Workflow run visualiser*: jobs, needs, a matrix and failures; challenges cut a 22-minute chain to 12 minutes without breaking real dependencies, and test three Node versions as a matrix.
- **Redis** — *Memory limits and eviction policies* (executed against Redis 7): `noeviction` refusing writes with OOM, `allkeys-lru` evicting, `volatile-lru` behaving like `noeviction` when no key has a TTL, and restoring the defaults (CI's Redis is shared by lessons). Counts that depend on memory overhead are shown as `…` with yes/no checks instead. Simulation *A cache under load*: cache-aside, TTL and single flight under a traffic spike; a hot key expiring mid-spike sends 240–272 queries in one second, and single flight keeps the peak at 9–41.
- **Nginx** — *Location matching rules in depth* (executed with Nginx 1.24 on port 8089): nine paths answered by seven labelled locations, then a regex swapped to show that only regex order matters. The runner's assumption that every Nginx lesson after the first proxies to an API on port 8080 was narrowed to lesson 2 (tested). Simulation *Location matcher*: locations from a fixed palette (no user-supplied regular expressions are compiled on the server); its tests assert the same answers real Nginx gave, and a real `nginx -t` confirmed the duplicate-location rule it applies.
- **Postman** — *Collections, environments and Newman* (executed against a real DevForge server with Newman 6.2.3): a v2.1 collection with `{{variables}}` and `pm.test` checks, an environment file, `--env-var` overrides, and a failing run with its exit code. Simulation *Request builder*: a model of part of DevForge's own API with its real status and error codes (checked against the live server). Deviation from §5.13, which suggests a live playground: challenges are verified by replaying actions on the server, which needs a deterministic model; the lesson sends the real requests.
- **Facts** checked on 2026-11-26 against GitHub Docs, the Redis documentation, nginx.org and Postman's documentation and the Newman README; points those pages did not state (Newman's exit code on failure, Redis's default policy) are shown from real output rather than asserted.

### Milestone 5 — Jenkins (2026-11-26)

- **Lesson** *Parallel stages, artefacts and test reports* (executed in the practice repository; every Jenkinsfile checked by the Jenkinsfile checker; running it in Jenkins checked against the Jenkins documentation, not executed): a test script that writes JUnit XML, and a Jenkinsfile with parallel stages, `archiveArtifacts` with fingerprints, and `junit` in `post { always }`.
- **Simulation** *Build queue and executors* (§5.11): 12 builds needing `docker` or `linux` agents over 30 minutes; with only a Linux agent the docker builds never start and more Linux capacity changes nothing; one docker executor leaves a 12-minute wait, two keep it at zero. 4 model tests, two server-verified challenges, a browser test. The documentation pages read describe executors and labels but not the queue itself, so the queue rule is labelled as the model's.

### Milestone 5 — done

Every track has at least three beginner lessons and a simulation (54 lessons, 18 simulations). Deviations recorded above: the Postman simulation models the API instead of sending live requests; Kubernetes needed a third lesson that §7 did not list. Owner decisions still open: the project licence; whether to delete the redundant copy in `~/Downloads/devforge18`.

### Milestone 5 — CI

Commit 9e1d0b0 (GitHub Actions, Redis, Nginx, Postman, Jenkins): CI run 45765786888.

### Milestone 6 — real-world context (2026-11-26)

- **Content types.** `content/case-studies/<id>.yaml` (schema `CaseStudySchema`): organisation, tracks, summary, claims, lessons learned, an optional caveat. Every claim has the verbatim `quote` that supports it, `source_url`, `source_title`, `publisher`, `published` (a date, or "not stated" when the page shows none), `checked_on` and `kind` — **confirmed** when the organisation or its own staff say it, **inferred** when it is someone else's account (usually the vendor's customer-story page). `content/tracks/<slug>/alternatives.yaml`: name, category, homepage, licence, where the licence was read, an optional status note, when to choose it and when to look elsewhere.
- **Loader checks.** Unknown tracks, dates in the future, a claim published after it was checked, an id that does not match its file, duplicate alternatives, non-https links. The link checker now covers every case-study source, alternative homepage and licence source.
- **Content.** 36 case studies (two per track) and 89 alternatives. Research was done in three parallel passes: each source page was downloaded and every quote checked by script as an exact substring of the page text (all 133 checks matched, which include all 108 claims used here). Licences were read from each project's LICENSE file or official licence page; hosted commercial services say "Not checked". Figures and savings claims on vendor pages are deliberately not used.
- **Editorial decisions.** Neptune was dropped from the MLflow alternatives: its hosted service ended on 2026-03-05 (docs.neptune.ai/transition_hub). Where REMAINING_WORK listed more than five alternatives, the extra ones were left out (Trello, cloud load balancers, Docker Compose, managed PostgreSQL) or merged (Thanos/Cortex/Mimir; Kinesis/Pub/Sub). Recent licence changes are flagged on the page (Redpanda, Dragonfly). Jaeger client libraries and Grafana Beyla are shown with their status (deprecated; donated to OpenTelemetry as OBI). HashiCorp's own case studies could not be read (HTTP 429/500), so Terraform uses Slack's and LiveRamp's engineering blogs.
- **Track page.** New sections *Who uses this and why* (claims with tags, quotes, source links and dates, "What to take from it", caveats) and *Alternatives and how to choose* (cards, not a table, so they work on a phone), both in the page's table of contents.
- **Tests.** 4 loader tests (every track has at least two case studies and two alternatives; each claim has a quote, an https source and a check date; bad case studies and alternatives are rejected), an API assertion, a browser test (Kafka: LinkedIn quote, source link, Confirmed tag, Apache Pulsar licence link, TOC link), and the required-sections and mobile-overflow tests now include the new sections.
- **Link check (2026-11-26).** 314 links: Azure Pipelines returned 503 and Uber's blog 406 to the automated checker (both load in a browser); every other link resolved. Redirected lesson resources were updated to their new addresses (Kubernetes probes, GitHub Actions artefacts, Postman environments).

### Milestone 6 — CI fix (2026-11-26)

CI run 45767962549 failed on the Redis memory lesson: the lesson claimed the key written last survives `allkeys-lru`, but in CI it was evicted. Redis's LRU is approximate (sampled keys, a one-second clock), so keys written in one burst look equally old. The check was removed and the lesson now explains this; the lesson passed three times in a row locally.

### Milestone 7 — labs (2026-11-26)

- **Lab system.** `content/labs/<track>/<id>.md` (schema `LabMetaSchema`): mode `local`, `simulation` or `read-through`; objectives, checkpoints, `## Goal` and `## Reset` sections. Track lab entries link to lab pages (`lab: <id>`); the loader checks links, levels, modes, simulation challenge ids and that every lab is listed. Local labs: steps run by the test suite after replaying prerequisite lessons, and exactly one check script (```` ```bash run check ````) that is also run in an empty folder, where it must report FAIL. `npm run lessons:record` records labs too. Workflow and Jenkinsfile checkers cover labs.
- **Progress.** Migration `0003_lab_progress` with `evidence` = `self-reported` (local labs: every checkpoint ticked; a browser cannot prove work done on the learner's machine) or `verified` (simulation challenges replayed by the server, read-through answers graded). API: `GET /api/labs/:id`, `POST /api/labs/:id/complete`, `GET /api/me/labs`; the track API lists labs. Lab page with completion per mode.
- **Content.** Local, executed: Git (merge conflict; reflog recovery and a committed secret), PostgreSQL (rollback and isolation), Nginx (security headers, the add_header inheritance trap, rate limiting), Terraform (drift), Redis (sliding-window limiter in Lua), GitHub Actions (protected deploy stage), Docker (multi-stage image under 1 MB), Postman (assertions on status, headers, body and errors), Jira (commit-msg hook for work item keys), Kafka (retry and dead-letter topics), Airflow (idempotent backfills), n8n (human approval with a signed, single-use resume URL), MLflow (promotion gate), LangChain (retrieval evaluation with hit rate and MRR), Prometheus (alert rule, promtool unit tests, live alert), OpenTelemetry (finding a slow request in Jaeger), Jenkins (credentials and Groovy interpolation). Read-through, executed on kind: Kubernetes debugging (ImagePullBackOff, CrashLoopBackOff, Pending). Simulation labs: one per track except Git, written from each simulation's challenges.
- **Facts checked while writing labs.** Each lab's tool behaviour was checked against official documentation, and several drafts were corrected by real runs: `return` bypasses `limit_req` in Nginx; a new Kafka consumer group starts at the latest offset; Airflow standalone's CLI backfill hits SQLite locking (the REST API is used); n8n's resume URL is signed (401) and single-use (409); unreachable reflog entries expire after 30 days, not 90; langchain-core 1.8.4 raises on all-zero vectors.
- **Simulation fixes found by the lab authors.** OpenTelemetry critical path (sequential calls now on the path), Terraform name field (so `-/+` can be produced), LangChain hint and chunk-size label, n8n flaky-service wording, MLflow run-ID placeholder, PostgreSQL log label.
- **CI.** Green on run 45774941756 (10ca7d1). Two later runs failed on the Kubernetes read-through lab: the crashing Pod's status alternates (fixed with a wildcard), and `logs --previous` was unavailable for 30 s in CI (the lab now reads the termination message, `terminationMessagePolicy: FallbackToLogsOnError`). Confirmation of the latest commits: see "Current work".
- **Not executed.** Jenkins running a pipeline, GitHub environments and required reviewers (checked against official docs only); the Jira lab needs no Jira site.

### Milestone 8 — intermediate and advanced lessons, Path 1 (2026-11-26)

- **26 new lessons, all executed by the test suite, each with a figure, sources checked on 2026-11-26, and a self-check.** Git (5): branches and merging, undoing work safely, pull requests and review, rebasing and history, protected branches, signing and secrets. PostgreSQL (5): transactions and ACID, isolation levels and anomalies, roles, privileges and SQL injection, backups, restores and migrations, replication and pooling. Postman (4): authentication flows, mock servers and documentation (Prism 5.16.0), collections in CI, contract testing. Redis (4): Pub/Sub versus Streams, transactions and Lua, persistence and replication, cache stampede and failure modes. Nginx (4): caching and compression, TLS termination with a local certificate, access control and connection limits, upstream failure handling. Docker (4): networks and Compose, health checks, logs, limits and stopping cleanly, image and container security, build cache and the supply chain (SBOM with Syft v1.55.0 on a digest-pinned base image).
- **Lesson runner.** Cleanup also takes down Compose projects (`docker compose -p`) and user-defined networks; `redis-cli` run inside a container no longer marks a lesson as using (and flushing) the host's Redis; per-user Docker CLI plugins are linked into the isolated HOME (only the `cli-plugins` folder, never `config.json`); Docker lessons get 300 s.
- **Facts corrected by real runs.** Under LRU, even the most recently written key can be evicted (one-second LRU clock); Git's "not fully merged" wording is version-specific; Nginx `return` runs before `limit_req`, `allow`/`deny` and `auth_basic`; Newman does not interpolate item names; Compose reports a stopped dependency as a DNS failure whose code depends on the host.
- **Not executed (described from documentation and labelled).** BuildKit secret mounts, `--sbom`/`--provenance` attestations and vulnerability scanning (the local machine has no Buildx; lessons 6–7 are builder-independent).
- **CI.** Run 45813697474 failed on two timing-dependent checks (Redis `volatile-lru` refusal count; Kubernetes lab status alternation, column width and stdout/stderr order) — fixed and re-verified locally. Run 45820069409 confirmed those fixes and the Redis, Nginx and Docker 4–5 lessons, but failed in the Airflow backfill lab (a backfill request returned no id); the helper now retries and reports Airflow's reply. Confirmation of the latest commits: see "Current work".

### Milestone 8 — Path 2 begins: Terraform (2026-11-26)

- **Four new lessons, executed locally twice each with Terraform 1.15.6:** remote state, locking and workspaces (pg backend on PostgreSQL 16, credentials only in the environment, a refused concurrent apply, -lock-timeout); importing existing resources and handling drift (kreuzwerker/docker 4.6.0: import block with generated configuration reviewed down to a clean plan, -refresh-only, removed with destroy = false); testing and policy (validation, terraform test with plan/apply runs, expect_failures and a mocked provider, a jq policy on the plan JSON); CI with plan review (detailed exit codes, applying the saved plan, a stale plan refused, and a checked GitHub Actions workflow).
- **CI restructured.** Run 45833076158 passed every test but hit the 40-minute limit, because lesson replay chains grow faster than the lesson count. Executed lessons now run in three independent shards (`DEVFORGE_LESSON_SHARD=i/n`), and the verify job skips them (`off`). Shards pull Docker Hub images through mirror.gcr.io after one shard hit Docker Hub's anonymous rate limit. Run 45843877395: all four jobs green in about 17 minutes.
- **Runner.** Lessons that run `createdb`, `dropdb` or `psql` from bash are gated on PostgreSQL like SQL lessons.

### Milestone 8 — Path 2 and 3 tracks: Kubernetes, GitHub Actions, Jenkins, Prometheus + Grafana, OpenTelemetry (2026-11-26)

- **23 new lessons, all executed locally twice before pushing, each with a figure, a self-check and sources checked on 2026-11-26.** Kubernetes 4–8 (ConfigMaps and Secrets, namespaces and selectors, volumes and StatefulSets, RBAC and network policies, Ingress and Gateway API with cloud-provider-kind v0.12.0); GitHub Actions 4–8 (images to a local registry, reusable workflows and composite actions, environments, OIDC, supply-chain hardening with SHA-pinned actions); Jenkins 4–7 (Configuration as Code, agents and labels, shared libraries, securing Jenkins); Prometheus + Grafana 4–8 (metric types, dashboards and variables, alerting with Alertmanager 0.34.2, SLOs and burn rates, cardinality and long-term storage); OpenTelemetry 4–7 (context through queues, metrics and logs, sampling, correlating signals).
- **Research notes** for each track in `docs/research/` (versions, sources with wording, behaviour observed in real runs).
- **Facts found by running, not assumed:** the core Collector 0.166.0 has `probabilistic_sampler` but no `tail_sampling` (tail sampling is described and labelled as not run); the JavaScript SDK 0.301.2 offers only the deprecated `TraceIdRatioBased` sampler and records no exemplars; default histogram buckets put sub-second durations into one bucket; Prometheus 3 refuses scrapes without a Content-Type.
- **CI:** run 45909030368 green on all four jobs after the SIGPIPE, Airflow-backfill and Collector-port fixes; OpenTelemetry lessons 4–7 confirmed in CI by run 45912029469 (all four jobs green).

### Milestone 8 — Kafka (2026-11-27)

- **Six new lessons, each run twice locally before pushing:** producers, acks and retries (a paused broker; a timed-out send that was written anyway); offsets, retention and replay (resets by offset, shift and time; retention by record timestamp; compaction); replication on a three-node KRaft cluster (ISR, min.insync.replicas, preferred leader election); delivery guarantees (at-most/at-least/exactly-once with crashes at fixed points; transactions and markers); schemas and evolution (Apicurio Registry 3.3.4, the wire format by hand with fastavro); the outbox pattern (PostgreSQL 16, a relay, deduplicating consumers).
- **`starts_fresh: true`** (lesson front matter): the lab builds everything itself, so tests and the recorder skip prerequisite replay. Kafka lesson 4 went from 190 s to 63 s.
- **Root-cause fix for a class of flaky waits:** run blocks use `set -o pipefail`, so `cmd | grep -q x` fails when `cmd` gets SIGPIPE after grep exits — wait loops never broke. 33 lessons and labs now use `grep x > /dev/null`; the build rejects `| grep -q`; a test reproduces the race. The PostgreSQL gate no longer counts `psql` run inside a container.
- **Decision:** Apicurio Registry instead of Karapace (680 MB vs 1.7 GB image; both Apache-2.0); Confluent Schema Registry not used (Confluent Community License). Kafka lessons get 600 s.
- **CI:** see "Current work" for the run that confirms the track.

### Milestone 8 — Airflow (2026-11-27)

- **Five new lessons, each run twice locally (lesson 7 also 3× under full CPU load):** timeouts and failure callbacks (execution_timeout, dagrun_timeout, AirflowFailException, task and DAG callbacks); passing data between tasks (paths instead of data, the common-io object-storage XCom backend, XComs cleared on retry); an idempotent ETL (append vs replace-the-day, reruns by clearing, a corrected source); backfills with write–audit–publish quality checks and `reprocess_behavior: failed`; deployment and executors (an image extended with the PostgreSQL provider from the image's own constraints, components as separate Compose services, LocalExecutor parallelism, a scheduler outage).
- **Fixes found on the way:** Airflow containers now run as the host user (`--user "$(id -u):0"`), so the test runner can delete files they write; a Jenkins commit ID changed by the grep -q fix was re-recorded (CI run 45922391534 found it; run 45924702495 green).
- **Kafka track confirmed in CI:** run 45924702495, all four jobs green (full suite, because the runner changed).

### Milestone 8 — MLflow (2026-11-27)

- **Three new lessons, each run twice locally:** the tracking server and its stores (default storage lost with the container; PostgreSQL backend and a proxied artifact store; a client with no storage access; a stateless restart); a reproducible training pipeline in Airflow (an image with pinned mlflow-skinny/scikit-learn, lineage tags for Airflow run, data hash and code hash, identical metrics on re-run, a code change visible in the hashes); serving and monitoring (alias promotion needs a reload, signature enforcement, rollback, a prediction log and PSI drift on a labelled simulated shift).
- **MLflow lessons get 600 s** (the pipeline lesson runs about 190 s locally, including an image build).
- **Airflow track confirmed in CI:** run 45936864117, all four jobs green.

### Milestone 8 — LangChain + LlamaIndex, and four root-cause CI fixes (2026-11-27)

- **Four new lessons, each run twice locally, no real model calls:** a RAG pipeline with a relevance threshold, abstention and mechanically checked citations; tool calling with a hand-written agent loop (allowlist, schema validation, human approval above a limit, step limit, audit log); evaluation (exact match vs required facts, a faithfulness heuristic, abstention, judge calibration against human labels, a release gate); prompt injection with permission filters at retrieval and defence in depth.
- **Intermittent CI failures fixed at the root:** (1) 75 e2e assertions read text right after an action; `expectText()` now waits for the visible text (42/42 normal and 8× throttled). (2) Prometheus held back the first Watchdog alert for its 1-minute resend delay; the lesson sets `--rules.alert.resend-delay=2s`. (3) The Redis stampede lesson's lock had a real double-query race; it now re-checks the cache after locking (5/5 under load). (4) The long-standing n8n crash: the CLI ran during the server's database migrations; the lesson now waits for `/healthz/readiness`.
- **MLflow track** was executed in run 45941753388 (its MLflow lessons passed; the run failed on items 1–2 above).

### Milestone 8 — n8n (2026-11-27)

- **Four new lessons, each run twice locally:** calling APIs and mapping data (pagination, Split Out, Edit Fields, Retry On Fail proven by a request counter); human approval steps (time limits with escalation, a four-eyes rule, a waiting execution surviving a restart; early resume calls answer 409); self-hosting securely (encryption key and encrypted credentials, the mismatched-key refusal, Execute Command blocked by default, `n8n audit`); AI agents and their risks (an n8n AI Agent with a scripted OpenAI-compatible stand-in model, an injected ticket steering the tool, rules enforced in the tool, Max Iterations — after three repeated refunds).
- **CI fixes:** the Docker limits lesson waits up to 10 s for the `OOMKilled` flag (run 45949757257 read it as false right after exit); the lesson runner removes volumes created with `docker volume create`.
- **Confirmed in CI:** run 45949757257 executed all LangChain lessons, the n8n lessons and lab, the fixed Prometheus alerting and Redis lessons — all green except the Docker OOM check (fixed since).
- **Unexplained, watched:** one local failure of the human-approval lesson right after a recording run (11 s, output not kept); 5 runs since passed.

### Milestone 8 — Jira, and the milestone's end (2026-11-27)

- **Two new executed lessons** (host Python, standard library): Kanban and flow metrics (lead and cycle time from REST-shaped changelogs, percentiles, Little's Law and why it fails on an unstable window, a cumulative flow table); reports and anti-patterns (story-point inflation, work-item age against the 85th percentile, skipped statuses, reopening and bulk closing).
- **All lesson lists in REMAINING_WORK §5 are ✅.** Milestone 8 is complete once the full-suite CI run (workflow_dispatch, see "Current work") is green.
- **Lesson learned:** a lesson the content build rejects is silently not selected by the lesson tests — the build must pass before a lesson "pass" means anything.
- **Milestone 8 complete:** full-suite run 45956974167 (workflow_dispatch on a8b28ac) green in all four jobs.

### Milestone 9 — quiz and project foundations, Git track (2026-11-27)

- **Quizzes** (`content/quizzes/<track>/<id>.yaml`): single, multiple, ordering, matching, output-reading and diagram-labelling questions; every quiz mixes all three levels and every question points to the lesson that teaches it. Graded on the server; a wrong answer links that lesson without revealing the answer; signed-in attempts are saved (migration 0004) and paths show a passed track as "Skipped by quiz".
- **Mini-projects** (`content/projects/<track>/<id>.md` + `starter/`, `solution/`, optional `check.sh`): user stories in "As a …, I want … so that …" form, at least three acceptance criteria and rubric rows, progressive hints, stretch goals. The solution is served only to faculty and admins (401/403 otherwise; tested). `scripts/lib/projects.test.ts` runs each check script on the starter (must fail) and the solution (must pass); a solution's `prepare.sh` replays the Git history from the starter and ends with a `diff -r` against the solution files.
- **Git track:** a 12-question quiz and three projects — portfolio repository (commit hygiene, .gitignore, no secrets in history), team task tracker (branch per backlog item, merge commits, PR template, CODEOWNERS, tested Python features), release workflow (bug fix with test, CI and tag-triggered release workflows, SHA-pinned actions with SHAs from the GitHub Actions research notes, least-privilege permissions, changelog, annotated tag). Each check was also run against deliberately broken versions (secret committed, commit on main, unpinned action, write permissions in CI) and reports each as FAIL.
- **Fixes found on the way:** projects were listed alphabetically instead of in track-plan order (API test added); the Docker lesson's out-of-memory step now says what the Docker Engine source shows — `OOMKilled` is set only by a separate OOM event that can be missed, so exit code 137 is the dependable signal (CI run 45956197496 had `OOMKilled=false, exit code 137` even after a 10 s wait).

### Milestone 9 — PostgreSQL, Jira, Prometheus + Grafana, OpenTelemetry (2026-11-27)

- **Quizzes and projects** for four more tracks; every check runs real tools (PostgreSQL 16.15, promtool/amtool, Collector + Jaeger + Node services, Python on Jira REST-shaped exports) and was also run against deliberately broken variants.
- **Quiz output rule enforced:** every "output" question shows output recorded in a lesson or produced by running the command (the PostgreSQL CHECK error was re-run on 2026-11-27); commands are the lessons' own (two invented script names in the Jira quiz were replaced).
- **Version-age deviation found (decision):** otelcol 0.166.0 and Grafana 13.3.2 were released on 2026-11-24 and pinned in the lessons and CI on 2026-11-25, against the 14-day rule. Not downgraded — that would mean re-recording lessons for versions that pass the 14-day mark on 2026-12-08. New project checks use older pins instead (Collector 0.165.0 image, published 2026-11-07; dashboards are checked with Prometheus, without Grafana). The same applies to the `python:3.12-slim@sha256:191083cd…` digest (published 2026-11-24, pinned from 2026-11-26 in lessons and checks); it passes the 14-day mark on 2026-12-08.

### Milestone 9 — ten more tracks (2026-11-27)

- **Kafka, Airflow, MLflow** written here; **Postman, Redis, Nginx, Docker, LangChain + LlamaIndex, n8n** by helper agents in separate worktrees, reviewed and merged. Every check runs the real tool (Kafka 4.4.0, Airflow 3.4.0 `dags test`, MLflow 3.18.0, Newman 6.2.3, Redis 7.4, Nginx, Docker/Compose, n8n 2.49.6, langchain-core 1.8.4) and was run against deliberately broken variants.
- **Fixes found on the way:** the root `data/` ignore rule had silently dropped the Airflow projects' sample data (CI caught it; `!content/projects/**/data/` added); the project runner now passes `DOCKER_CONFIG` through its isolated HOME (Compose v2 as a per-user plugin); CI drops the unused Microsoft apt repository before installing Playwright's system libraries (403 in run 45988691485); Grafana and Jaeger lesson flakes fixed at the root (plugin registration wait; Jaeger's own metrics port).
- **Quiz rule re-checked:** every output question's output appears verbatim in a lesson, and its command is the lesson's own (four invented script names replaced).

### Milestone 10 — capstone foundation (2026-11-27)

- **Capstone content type** (`content/capstones/<id>.md`): letter A–G, summary, at least three tracks, an architecture diagram (`media:capstones/…`, drawn with figlib), user stories, milestones with deliverables, acceptance criteria and links to the lessons, labs and mini-projects they build on (validated), rubric, stretch goals; "Brief", "Architecture" and "Getting started" sections. Paths link their capstone by id. API `/api/capstones`, `/api/capstones/:id`; pages `/capstones` and `/capstones/:id`; a Capstones item in the main navigation; API and browser tests.
- **Decision — capstone B:** the blueprint's text for Project B is not in the repository (the original prompt folder was deleted). Every other letter is named by a learning path (A distributed systems, C AI application, D data engineering, E MLOps, F DevOps platform and its team slice, G automation); the only unlettered path capstone, backend foundations' course-registration system, becomes **Project B — Course registration platform**.

### Milestone 9 — done: Kubernetes, Terraform, GitHub Actions, Jenkins (2026-11-27)

- The last four tracks' quizzes and projects (helper agents in worktrees; reviewed, quiz outputs and commands checked against the lessons, merged). All 18 tracks now have a quiz and three mini-projects.
- **CI:** Docker-based project checks moved out of the lesson shards into their own job ("Mini-project checks", four shards, affected-only on pushes) — 48 Docker checks did not fit the lesson shards' time budget. Known caveats: Jenkins checks download plugins on their first run; kind clusters may hit inotify limits on small machines.
- **Flake fixed at the root:** `kafka-campus-activity`'s check started two consumers after all 300 swipes were produced; with a 0 ms initial rebalance delay the first consumer could process everything before the second joined (CI run 46033336825: 0 and 300). Both copies now start first and the swipes arrive over about 4 s; the criterion ("both copies did part of the work") is unchanged. Solution passed 3 of 3 local runs.

### Milestone 10 — capstones, integrations and architecture studio (2026-11-27)

- **Capstones A–G**, each with a figlib architecture diagram, milestones linked to the lessons, labs and projects they reuse (validated), rubric and stretch goals; paths link their capstone.
- **17 integrations** (`content/integrations/*.yaml`) between related tracks, each practised by executed lessons of its two tracks, and the **relationship graph** (`/graph`, filters by path and tool, an accessible connections table; `/integrations/:id`). **Decision:** the blueprint's list of 17 integrations is not in the repository (prompt folder deleted); the 17 are the 15 related-track pairs that existing lessons already demonstrate, plus two pairs that needed a new executed lesson: Redis cache-aside in front of PostgreSQL and one trace across a Kafka hop with OpenTelemetry.
- **Architecture studio:** 10 reference architectures (diagram, components, flow, trade-offs, failure modes, alternatives, decision prompts, learn-more links, capstones), and learner architecture decision records saved per architecture (migration 0005, `/api/me/decisions`), with API and browser tests.
- **New lessons:** `redis-cache-aside-with-postgresql` (PostgreSQL 16 + Redis 7.4 + Python; a dead cache falls back immediately with no retries) and `kafka-tracing-with-opentelemetry` (Kafka 4.4.0, confluent-kafka 2.16.1, opentelemetry-sdk 1.45.2 released 2026-10-29; a traceparent header joins producer and consumer spans, a message without it starts a new trace). Both executed.
- **Fix:** the unused-media warning now names capstones and architectures, and its test was updated to the new wording (it had been left on the old text, failing the verify job in run 46033336825).

### Milestone 11 — institutional features, part 1 (2026-11-27)

- **Cohorts** (migration 0006): faculty create a cohort and get a 10-character join code (no look-alike characters; can be replaced, which invalidates the old one); learners join after being told that the cohort's teachers will see their name, e-mail and progress, and can leave at any time; the last teacher cannot leave. Pages `/cohorts`, `/cohorts/:id`; "Cohorts" in the main navigation for signed-in users.
- **Assignments with due dates** for any lesson, lab, quiz, project, capstone or architecture record. Completion is never stored — it is derived from the learner's own records (lesson self-check passed, lab completed with its evidence, quiz passed, work submitted/accepted, decision record submitted/reviewed), with "late" and "overdue" states. Faculty see a per-learner table (lessons completed, labs verified, quizzes passed, assignments done); learners see their assignments on the dashboard.
- **Submissions and review against rubrics:** learners submit an `https://` link and notes from a project or capstone page; faculty who teach the learner (admins: everyone) review it from `/reviews` against the item's own rubric — one radio group per criterion, all required, plus feedback — and accept or request changes; learners see the feedback on the page; resubmitting asks for a new review. Submitted architecture decision records are reviewed the same way against a fixed four-criterion ADR rubric. Teachers of other cohorts get 403/404.
- **Portfolio:** opt-in public page `/portfolio/:slug` with display name, headline, accepted work and valid certificates — never the e-mail address.
- **Certificates** `/certificates/:id` (random 128-bit id, public verification, admin revocation, audited). **Decision — threshold:** the track quiz passed and every lab of the track that the server can verify (simulation and read-through labs) verified; Git has no server-verifiable lab (both are local), so its commit-graph simulation's three challenges (verified by replay) stand in. Self-reported work never counts. The evidence is stored with the certificate.
- **Privacy controls:** JSON export of all of a user's data and self-service account deletion (password + confirmation phrase, rate-limited, last admin protected; cascades and removes reviews of the deleted work). docs/security.md updated with who can see what.
- **Tests:** 18 API tests (permissions for every role, join-code rotation, rubric completeness, derived statuses, privacy of public pages, deletion) and 2 browser tests (teacher → learner → review → portfolio; export and deletion).
- **Open item — release checklist:** the order of work ends with "the release checklist from my previous message", but that message is not in this repository or in any saved session transcript (earlier summaries already noted it was not visible). It will be requested from the owner instead of being invented.

### Speed-ups and decisions (2026-11-26)

- **Decisions recorded.** Licences: MIT for code (`LICENSE`), CC BY-SA 4.0 for `content/` (`LICENSE-CONTENT`, full legal code from creativecommons.org), Fira Sans OFL notice kept. `~/Downloads/devforge18` deleted after checking that every file's content exists in this repository's history (the only differences were three debugging logs and an older `package.json`). Terraform's plugin cache is enabled in CI with `TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE` (HashiCorp documents it for setups that discard lock files, as lesson folders do; without it the cache is never used for fresh folders); learners' commands are unchanged. Python packages are installed inside lesson containers, so no pip cache (it would change commands learners see). Quiz and project scaffolds come with their schemas in milestone 9.
- **Record lessons in CI** (`.github/workflows/record-lessons.yml`, `npm run ci:record -- <id> …`): pushes the commit to a temporary branch, records there with every service and tool, downloads the patch, applies it for review, deletes the branch.
- **Caches** (keyed by exact versions): tool downloads (checksums still verified every run), Terraform providers and npm packages used by lessons, Playwright's Chromium, npm via `npm ci` and the lockfile. Shared tool installation lives in `.github/actions/lesson-tools`.
- **Affected-only lesson runs** (`scripts/lib/affected.ts`, `scripts/affected-lessons.ts`): pushes and pull requests run only lessons whose own file or prerequisite chain changed (plus API-dependent lessons on any content change; everything if the runner, server, schema, workflows or dependencies change). Nightly 01:30 UTC and manual runs execute everything. Shards with nothing to run skip tool installation.
- **Flake tools.** `npm run lessons:stress` (repeated runs with every core busy); lessons that stop early print their containers' state, OOM flag and logs; `npm run test:e2e:throttled` (8× CPU throttling) and `samplePhases()` in the e2e harness, now used to assert that the mobile menu closes in the tap's own update.
- **Scaffolding.** `npm run new:lesson` / `new:lab` create schema-shaped files and a figure script; the content build rejects any file still containing `TODO(scaffold)`.

### Time log

| Date (UTC) | Track / item | Minutes working | Minutes waiting | Notes |
|---|---|---|---|---|
| 2026-11-26 | Decisions: licences, duplicate folder | 10 | 0 | |
| 2026-11-26 | Speed-ups 1–5 | 60 | 10 | waiting = local stress runs of the n8n lesson |
| 2026-11-26 | Kubernetes lessons 7–8 (research, prototypes, recording, 2 test runs each) | 55 | 25 | waiting = kind runs; first CI recording round-trip took 5 min |
| 2026-11-26 | GitHub Actions lessons 4–8 (one research pass, checker extended for composite actions and reusable calls) | 95 | 10 | local recording (no heavy images); one root-cause hunt (git ls-remote relative path) |
| 2026-11-26 | CI fixes (missing figure, implicit image pulls, last-green comparison) | 25 | 20 | waiting = CI runs |
| 2026-11-26 | Jenkins lessons 4–7 (one research pass; real Jenkins, plugins, agent, library server) | 85 | 15 | plugin image built in under a minute locally; no CI recording needed |
| 2026-11-26 | CI fixes (stream order, trap set -e, n8n stress run in CI: not reproduced) | 20 | 25 | |
| 2026-11-26 | Prometheus + Grafana lessons 4–8 (one research pass; Alertmanager added to CI tools) | 100 | 25 | waiting = Prometheus/Grafana/Alertmanager downloads (lost with the old scratch folder) |
| 2026-11-26 | OpenTelemetry lessons 4–7 (one research pass; no new CI tools) | 110 | 15 | lost ~10 min to a shell heredoc that ended early (lesson text now written with the editor, not heredocs) |
| 2026-11-27 | Kafka lessons 4–9 (one research pass; `starts_fresh`; pipefail/grep -q race fixed in 33 files) | 170 | 35 | waiting = lesson runs (each tested twice); 25 min lost to a 300 s timeout whose cause was grep -q under pipefail |
| 2026-11-27 | Airflow lessons 4–8 (one research pass; 3× stress run of lesson 7) | 150 | 30 | 15 min lost to an interrupted session (machine restart) |
| 2026-11-27 | MLflow lessons 4–6 (one research pass; two extended images) | 120 | 25 | waiting = image builds and lesson runs |
| 2026-11-27 | CI fixes (e2e text waits ×75, Alertmanager resend delay, Redis double-checked lock, n8n readiness) | 70 | 35 | root causes for three intermittent failures, two of them long-standing |
| 2026-11-27 | LangChain + LlamaIndex lessons 4–7 | 110 | 15 | |
| 2026-11-27 | n8n lessons 4–7; Docker OOM flag wait; runner removes named volumes | 150 | 30 | the AI-agent lesson needed a fake OpenAI-compatible server and an older Agent node version |
| 2026-11-27 | Jira lessons 4–5 (executed flow-metric scripts on REST-shaped sample data) | 60 | 5 | |
| 2026-11-27 | Milestone 9 foundations: quiz/project types, grading, pages, scaffolds, check runner | 180 | 20 | |
| 2026-11-27 | Git quiz and three Git mini-projects with acceptance checks and replayed histories; Docker OOM root cause | 120 | 10 | |
| 2026-11-27 | PostgreSQL, Jira, Prometheus + Grafana, OpenTelemetry quizzes and projects; disk-full root cause (orphaned volumes) | 330 | 40 | waiting = usage limit (helper agents in parallel used it up) |
| 2026-11-27 | Kafka, Airflow, MLflow (own); review and merge of Postman, Redis, Nginx, Docker, LangChain, n8n (agents); CI fixes (ignored sample data, apt repository 403, two lesson flakes) | 300 | 30 | |
| 2026-11-27 | Kubernetes, Terraform, GitHub Actions, Jenkins (agents, reviewed and merged); CI projects job | 90 | 20 | |
| 2026-11-27 | Capstones A–G, graph, integrations (15 by an agent + 2 with new lessons), architecture studio and ADRs | 300 | 30 | |
| 2026-11-27 | CI fixes: stale warning test, Kafka consumer-group race | 25 | 10 | |

## Current work

Milestone 11: institutional features and hardening (REMAINING_WORK §6.3–6.4), then the release checklist.

## Pending work (ordered)

### Phase 1 — impressive functional MVP (next)

1. **Run CI once on GitHub** and fix anything the real `@types/react` typecheck reports. Commit `package-lock.json` and switch CI to `npm ci`.
2. **Verify all 46 resource links** (weekly workflow or manual run), review each, update `verification` in YAML.
3. **Beginner lessons for the remaining 16 tracks without lessons** (at least 2 per track), each meeting the bar in `docs/content-authoring.md`. Order follows Path 1: ~~Git/GitHub~~ (done) → PostgreSQL → Postman → Redis → Nginx → Docker (lesson 2), then the rest. To make PostgreSQL, Redis and Nginx lessons *executable*, add those services to the CI job (GitHub Actions `services:` containers) and extend `hasCommand` skips accordingly; until then they are `docs-checked`.
4. **Video candidates** found on git-scm.com/learn (four short official introductions to version control and Git). Each must be watched and checked before being added (content guide rule 5).
5. Setup guides (Windows / macOS / Linux) as lessons for each track, with verification and uninstall steps (done for Git inside lesson 1).
6. Track `content_status` updated as lessons land.

### Phase 2 — deep content

Intermediate/advanced lessons; command explorer; glossary; quizzes with more question types (match, diagram reading, command interpretation, diagnosis); learning-path rubrics; curated videos (only after each is individually verified — see content guide); build-time Mermaid → SVG diagrams.

### Phase 3 — labs and projects

Lab schema and pages (objective, steps, expected output, progressive hints, reset, reflection); first browser simulations (Kubernetes self-healing, Kafka partitions/consumer groups, Redis TTL, Git branch graph) clearly labelled; mini-project and capstone guides A–G; submission and rubric workflow.

### Phase 4 — architecture and integrations

Full relationship graph with filters and per-edge integration lessons (the 17 integrations in the blueprint); Architecture Studio (10 reference architectures); ADR workflow for learners; case-study library starting with the four sources listed in the blueprint, each separating confirmed facts from inference.

### Phase 5 — institutional

Admin and faculty screens; cohorts and assignments; content review workflow; portfolio (opt-in public) and certificates (assessment threshold); privacy controls.

### Phase 6 — advanced engineering

Optional isolated lab execution (never on the main server); OpenTelemetry tracing for the platform; PostgreSQL adapter if required (ADR 0002); Redis for shared rate limits when running more than one instance; load, security and accessibility audits.

## Known issues and limitations

| Issue | Impact | Plan |
|---|---|---|
| No `package-lock.json` (generated offline environment) | Dependency versions not locked transitively | Commit lockfile after first `npm install` online |
| Rate limits in process memory | Limits are per process and reset on restart | Acceptable for one instance; Redis in Phase 6 if scaled out |
| `node:sqlite` is marked experimental in Node 22 | API could change in a future Node release | Pinned to Node 22 LTS; covered by tests; ADR 0002 |
| `node:sqlite` is synchronous | Long queries would block the event loop | All queries are indexed point lookups; revisit if analytics queries are added |
| Docker / Nginx / CI untested | Possible small configuration fixes needed | Test on first deployment |
| 54 beginner lessons | No intermediate or advanced lessons yet; labs and projects listed as planned | Milestones 7–9 |
| CI duration | Real Jenkins and Kubernetes runs add several minutes per CI run | Acceptable; could move slow lesson tests to a separate, scheduled or path-filtered job later |
| Python packages for the LangChain + LlamaIndex lessons | Only the top-level packages are pinned; a new release of one of their dependencies could change behaviour or break the install in CI | If it happens: pin the full set with a constraints file generated by `pip freeze` in the lesson container |
| Docker Hub pull limits in CI | CI pulls `postgres:16`, `redis:7`, `nginx:1.27-alpine`, `alpine:3.20`, `apache/kafka`, `apache/airflow`, `n8nio/n8n`, `python:3.12-slim` and (from GitHub's registry) `ghcr.io/mlflow/mlflow` anonymously; Docker Hub rate-limits anonymous pulls, which could intermittently fail CI | If it happens: add a Docker Hub login step (`docker/login-action` with a read-only token in repository secrets) |
| No lesson currently uses `pending`, and no resource is unverified | Those UI states ("Automated test pending.", "Link not yet verified") are not exercised by the browser tests (still validated by the content schema and loader); the `docs-checked` state is, by a Jira lesson | Add e2e assertions when such content exists, or test the states with fixture content |

## Decisions made

See `docs/adr/`. In short:

1. **ADR 0001** — Minimal, verifiable stack: React + esbuild frontend, `node:http` server, Node 22 native TypeScript, zod as the only runtime dependency.
2. **ADR 0002** — SQLite (`node:sqlite`) for Phases 0–5; data access isolated so PostgreSQL can be added. **Open question for the project owner:** confirm SQLite is acceptable for the target deployment, or request PostgreSQL earlier.
3. **ADR 0003** — Content as version-controlled files, validated and compiled at build time.
4. **ADR 0004** — Server-side sessions with hashed tokens, scrypt, custom-header + Origin CSRF defence, classroom-aware rate limits.
5. **ADR 0005** — Simulations are always labelled; learner code never runs on the main server.
6. **ADR 0006** — Design direction: dark-first navy, single accent, self-hosted Fira Sans, system map as the signature element.

## Commands already tested

```bash
npm run content:build        # content validation and compile
npm run web:build            # frontend bundle
npm run build                # both
npm run typecheck            # strict TS (server/shared/scripts/tests)
npm test                     # 106 tests
npm run test:e2e             # 15 browser tests
npm start                    # server on PORT (default 8080)
npm run db:migrate           # idempotent
npm run user:create -- --email a@b.edu --name "A" --role admin
npm run db:backup -- ./backups/manual.db
```

## Exact next steps for the next session

The full plan for all remaining work is in [`REMAINING_WORK.md`](REMAINING_WORK.md); [`MASTER_PROMPT.md`](MASTER_PROMPT.md) is a ready-made prompt for continuing with a coding agent.

1. Milestone 8 — intermediate and advanced lessons, track by track, Path 1 first (REMAINING_WORK.md §5).
2. Re-check the case studies flagged as fast-changing (Redpanda and Dragonfly licences) before each release.
3. Re-run the *Link check* workflow monthly; a person re-confirms each page before updating `checked_on`.
4. Update this file after each milestone.
