# Implementation status

Last updated: 2026-11-25 · Milestone: **5 in progress — Kafka, Airflow and MLflow done** (REMAINING_WORK.md §7) · Next: **LangChain + LlamaIndex**

This file is the handover record required by the blueprint (Part XI §15). Update it after every substantial milestone. Claims here are limited to what was actually run and observed; anything not run is marked **untested**.

## Summary

| Area | State |
|---|---|
| All 18 tracks present, searchable, with reviewed explanation and full curriculum outline | ✅ Done, tested |
| 8 learning paths | ✅ Done, tested |
| Lessons | ✅ 36 published across 15 tracks, **all executed** (Airflow confirmed in CI; the 3 MLflow lessons recorded against a real MLflow server locally, CI confirmation in progress) |
| Executable lessons (commands run in CI, output compared) | ✅ Done, tested |
| Accounts, sessions, roles, progress, bookmarks | ✅ Done, tested |
| Frontend: home + system map, catalogue, track, lesson, paths, search, auth, dashboard | ✅ Done, tested in a browser |
| Figures and step-through diagrams | ✅ 37 figures across all 36 lessons (no ASCII diagrams left), 15 of them step-throughs — one in each of the 15 tracks with lessons; tested |
| Simulations | 🟡 Framework done and tested; 7 of 18 tracks have one (Git, Kubernetes, Prometheus + Grafana, OpenTelemetry, Kafka, Airflow, MLflow), with server-verified challenges |
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

## Current work

Milestone 5 of REMAINING_WORK.md §7: Kafka, Airflow and MLflow are done; next LangChain + LlamaIndex, n8n and Jira, then a third lesson and a simulation for each Path 1 track that lacks them.

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
| 36 lessons across 15 tracks | 3 tracks show outline only | Milestone 5 |
| CI duration | Real Jenkins and Kubernetes runs add several minutes per CI run | Acceptable; could move slow lesson tests to a separate, scheduled or path-filtered job later |
| Docker Hub pull limits in CI | CI pulls `postgres:16`, `redis:7`, `nginx:1.27-alpine`, `alpine:3.20`, `apache/kafka`, `apache/airflow` and (from GitHub's registry) `ghcr.io/mlflow/mlflow` anonymously; Docker Hub rate-limits anonymous pulls, which could intermittently fail CI | If it happens: add a Docker Hub login step (`docker/login-action` with a read-only token in repository secrets) |
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

1. Milestone 5 — beginner lessons and a simulation for Kafka, Airflow, MLflow, LangChain + LlamaIndex, n8n and Jira (§5.8, §5.10, §5.12, §5.16–5.18). Done when all 18 tracks have at least three beginner lessons and one simulation, which also means a third beginner lesson for each Path 1 track that has two.
2. Milestone 6 — case studies and alternatives for every track.
3. Re-run the *Link check* workflow monthly; a person re-confirms each page before updating `checked_on`.
4. Update this file after each milestone.
