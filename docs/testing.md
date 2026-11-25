# Testing

| Layer | Location | Runner | What it proves |
|---|---|---|---|
| Content | `scripts/lib/*.test.ts` | `npm test` | Real content is valid; broken content is caught; Markdown output is XSS-safe |
| Executable lessons | `scripts/lib/lesson-runner.test.ts` | `npm test` | Every `bash run` / `sql run` block reproduces its documented output (Git locally and in CI; SQL where PostgreSQL is reachable — CI; HTTP lessons against a real DevForge server started in a child process and exposed as `$API`). Skipped tests say why. |
| Search | `shared/search.test.ts` | `npm test` | Every track ranks first for its own name; typos, abbreviations, prefixes |
| Workflows | `scripts/lib/workflow-check.test.ts` | `npm test` | DevForge's own `.github/workflows` and every workflow in lessons pass the workflow checker; deliberately invalid examples are caught for the right reasons |
| Jenkinsfiles | `scripts/lib/jenkinsfile-check.test.ts` | `npm test` | Every Jenkinsfile in lessons passes the Jenkinsfile checker; invalid examples are caught for the right reasons |
| Units | `server/test/units.test.ts` | `npm test` | Password hashing, migrations (idempotent, checksum, rollback), config validation, router param safety, limiter, cookies, log redaction |
| API | `server/test/api-*.test.ts` | `npm test` | Real HTTP server + in-memory DB: auth, CSRF, brute force, RBAC matrix, grading, progress, bookmarks, static serving, metrics |
| Browser | `e2e/journeys.test.ts` | `npm run test:e2e` | Production build in headless Chromium: discovery, full learning journey, accessibility basics, theming, mobile |

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
