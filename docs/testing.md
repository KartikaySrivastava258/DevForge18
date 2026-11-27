# Testing

| Layer | Location | Runner | What it proves |
|---|---|---|---|
| Content | `scripts/lib/*.test.ts` | `npm test` | Real content is valid; broken content is caught; Markdown output is XSS-safe |
| Figures | `scripts/lib/svg.test.ts`, `content-loader.test.ts`, `markdown.test.ts` | `npm test` | The SVG allowlist rejects scripts, handlers, styles, external references, hard-coded colours and malformed XML; figures and step-throughs render with text alternatives; broken sidecars, steps and references fail the build |
| Simulation models | `shared/simulations/**/*.test.ts` | `npm test` | Every action, invariant and challenge check; the Git model's graph matches real Git for the same command sequences; the Kubernetes model keeps rolling-update limits for every strategy at 1–8 replicas and stalls a broken release at 4 of 5 Pods, as the real cluster in CI did; the Prometheus model's rate() and histogram_quantile() match worked examples from the documented algorithms; the trace waterfall's timings, self time and critical path match hand-worked examples |
| Executable lessons | `scripts/lib/lesson-runner.test.ts` | `npm test` | Every `bash run` / `sql run` block reproduces its documented output (Git locally and in CI; SQL where PostgreSQL is reachable — CI; HTTP lessons against a real DevForge server started in a child process and exposed as `$API`). Skipped tests say why. |
| Search | `shared/search.test.ts` | `npm test` | Every track ranks first for its own name; typos, abbreviations, prefixes |
| Workflows | `scripts/lib/workflow-check.test.ts` | `npm test` | DevForge's own `.github/workflows` and every workflow in lessons pass the workflow checker; deliberately invalid examples are caught for the right reasons |
| Jenkinsfiles | `scripts/lib/jenkinsfile-check.test.ts` | `npm test` | Every Jenkinsfile in lessons passes the Jenkinsfile checker; invalid examples are caught for the right reasons |
| Units | `server/test/units.test.ts` | `npm test` | Password hashing, migrations (idempotent, checksum, rollback), config validation, router param safety, limiter, cookies, log redaction |
| API | `server/test/api-*.test.ts` | `npm test` | Real HTTP server + in-memory DB: auth, CSRF, brute force, RBAC matrix, grading, progress, bookmarks, static serving, metrics, simulation challenge verification (no solutions leak; forged, invalid and oversized runs rejected) |
| Deployment | `scripts/compose-smoke.sh` | `npm run test:compose` (CI job *Docker Compose and Nginx smoke test*) | The production image builds from the lockfile, Compose starts (read-only, no-new-privileges, only Nginx published) and, through Nginx: health, SPA route with the strict CSP and security headers, 18 tracks, CSRF rejections, immutable caching and gzip of hashed assets, hidden `/metrics`, sign-up, `user:create` and `db:backup` in the container, restart keeps data, 429 at the edge rate limit |
| Browser | `e2e/journeys.test.ts` | `npm run test:e2e` | Production build in headless Chromium: discovery, full learning journey, accessibility basics, theming, mobile, step-through diagrams (buttons, arrow keys, focus, Play/Pause, reduced motion, light theme, phone width), simulations (keyboard-only challenge saved through the server, Step, text mode, reduced motion, lesson embeds, track-page links) |

## Principles

- Tests exercise behaviour through public interfaces (HTTP, the browser), not private functions, wherever practical.
- Security properties are tested as attacks: forged origins, missing CSRF headers, traversal paths, tampered cookies, replayed sessions, self-assigned roles.
- Browser tests fail on **any** console error or warning, failed request, 5xx or missing asset. CSP violations therefore fail the build.
- Screenshots from the e2e run are written to `build/screenshots/` for visual review (uploaded as a CI artifact on failure).

## Running a subset

```bash
node --disable-warning=ExperimentalWarning --test server/test/api-auth.test.ts
node --disable-warning=ExperimentalWarning --test --test-name-pattern="CSRF" server/test/api-auth.test.ts
npm run build && node --disable-warning=ExperimentalWarning --test e2e/journeys.test.ts
```
