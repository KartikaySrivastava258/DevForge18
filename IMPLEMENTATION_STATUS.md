# Implementation status

Last updated: 2026-11-25 · Milestone: **3 — simulation framework** (REMAINING_WORK.md §7) · Next: **Milestone 4 — complete Path 2 (Prometheus + Grafana, OpenTelemetry)**

This file is the handover record required by the blueprint (Part XI §15). Update it after every substantial milestone. Claims here are limited to what was actually run and observed; anything not run is marked **untested**.

## Summary

| Area | State |
|---|---|
| All 18 tracks present, searchable, with reviewed explanation and full curriculum outline | ✅ Done, tested |
| 8 learning paths | ✅ Done, tested |
| Lessons | ✅ 21 published across 10 tracks, **all executed** and confirmed in CI (none pending) |
| Executable lessons (commands run in CI, output compared) | ✅ Done, tested |
| Accounts, sessions, roles, progress, bookmarks | ✅ Done, tested |
| Frontend: home + system map, catalogue, track, lesson, paths, search, auth, dashboard | ✅ Done, tested in a browser |
| Figures and step-through diagrams | ✅ 22 figures in all 21 lessons (no ASCII diagrams left), a step-through in each of the 10 tracks with lessons; tested |
| Simulations | 🟡 Framework done and tested; 2 of 18 tracks have one (Git, Kubernetes), with server-verified challenges |
| Labs, projects, quizzes, glossary, architecture studio, case studies | ⬜ Not started (planned phases below) |
| Admin / faculty screens, cohorts, CMS | ⬜ API foundation only |
| CI | ✅ Runs on GitHub (first run 2026-11-25). Docker Compose / production Nginx config still untested |

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

## Current work

Milestone 4 of REMAINING_WORK.md §7: complete Path 2 — Prometheus + Grafana and OpenTelemetry beginner lessons (executed in CI) and their simulations.

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
| 21 lessons across 10 tracks | 8 tracks show outline only | Phase 1 |
| CI duration | Real Jenkins and Kubernetes runs add several minutes per CI run | Acceptable; could move slow lesson tests to a separate, scheduled or path-filtered job later |
| Docker Hub pull limits in CI | CI pulls `postgres:16`, `redis:7`, `nginx:1.27-alpine` and `alpine:3.20` anonymously; Docker Hub rate-limits anonymous pulls, which could intermittently fail CI | If it happens: add a Docker Hub login step (`docker/login-action` with a read-only token in repository secrets) |
| No lesson currently uses `pending` or `docs-checked`, and no resource is unverified | Those UI states ("Automated test pending.", "Link not yet verified") are no longer exercised by the browser tests (still validated by the content schema and loader) | Re-add e2e assertions when such content exists, or test the states with fixture content |

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

1. Milestone 4 — complete Path 2: Prometheus + Grafana (a real Prometheus scraping DevForge's `/metrics` in CI), then OpenTelemetry; one simulation each (§5.7, §5.15).
2. Milestone 5 — beginner lessons and a simulation for Kafka, Airflow, MLflow, LangChain + LlamaIndex, n8n and Jira.
3. Re-run the *Link check* workflow monthly; a person re-confirms each page before updating `checked_on`.
4. Update this file after each milestone.
