# Security

## Threat model (summary)

| Asset | Threat | Control |
|---|---|---|
| Accounts | Password guessing, credential stuffing | scrypt (N=2¹⁷); per-account lockout after 10 failures / 15 min; common-password blocklist; generic error messages; timing-equalised login |
| Sessions | Theft, fixation, replay after logout | 256-bit random tokens; only SHA-256 stored; `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production; new token per login; server-side deletion on logout; enforced expiry |
| State-changing requests | CSRF | Required custom header + `Origin` + `Sec-Fetch-Site` checks; no CORS granted |
| Pages | XSS | Strict CSP (`script-src 'self'`, no `unsafe-inline`); React escaping; lesson HTML rendered at build time with raw HTML escaped and unsafe URL schemes removed; display names reject `<`, `>` and control characters |
| Database | SQL injection | Parameterised statements only; zod validation of every body |
| Files | Path traversal | Route params restricted to identifier characters; static paths resolved and confined to the web root |
| Quiz integrity | Reading answers from the client | Answers and explanations never sent before grading; grading on the server |
| Simulation progress | Forging "challenge completed" | The server replays the submitted actions through the same pure model and runs the check itself (ADR 0008); actions must match the model's strict schema; at most 400 actions and 3,000 ticks per request; reference solutions are never sent to browsers |
| Admin functions | Privilege escalation | Role checks on every route; self-registration is always `student`; first admin via CLI only; last admin cannot be demoted; role changes audited |
| Accounts (admin) | A compromised or departed user keeps access | Admins can disable an account: its sessions are deleted at once, sign-in is refused, and `getSessionUser` rejects disabled users as a second check; an admin cannot disable themselves; audited (`user.disabled`, `user.enabled`) |
| Content editor (ADR 0011) | Bypassing review; writing outside content; leaking the GitHub token | Changes only become pull requests (review and CI still apply); faculty/admin only, CSRF-checked; paths limited to `content/**` `.md`/`.yaml` files with a schema (no `..`, absolute paths, backslashes or `%`); 64 KB files; token sent only to `GITHUB_API_URL` (HTTPS unless loopback), never logged or sent to browsers; pull requests name the editor by display name only, with `@` mentions neutralised; each pull request recorded in `cms_submissions` and the audit log |
| Redirects | Open redirect after login | `next` must be a same-site path (`/…`, not `//…`) |
| Metrics | Information disclosure | `/metrics` served only to private addresses; blocked by Nginx |
| Availability | Abuse, large payloads | Per-IP API limit; 64 KB JSON limit; server timeouts; Nginx `limit_req` and `client_max_body_size` |
| Host | Learner code execution | None — see ADR 0005 |
| Request playground (Postman track, `/tracks/postman/playground`) | A learner sending, with their own session, a request that hurts them (deleting the account, exposing their data), or the page being used against another host | It can do nothing the learner could not do with curl and their own cookie; the limits protect learners from accidents. An allowlist (`shared/simulations/postman/playground.ts`, with the reasoning) of public catalogue reads, the learner's own `/api/me` reads, a lesson self-check, bookmarking and two unrouted methods (405); administration, the content editor, cohorts, reviews, account deletion, export, sign-in/registration/sign-out and staff-only reads are refused before sending. Path segments are identifier characters only (no `..`, `//` or `%`); same origin only (and CSP `connect-src 'self'`, unchanged). The CSRF header is added but removable, so the server's own `403 csrf_failed` is shown; the server's checks are unchanged. At most 20 requests a minute from the page, plus the server's per-user and per-address limits. `server/test/postman-playground.test.ts` fails if any route outside the list becomes reachable, or a role-restricted one is listed |

## Operational checklist

Before going live:

- [ ] Serve only over HTTPS; set `COOKIE_SECURE=true` and `PUBLIC_ORIGIN=https://…` (the server refuses to start in production with HTTPS and insecure cookies).
- [ ] Set `TRUST_PROXY=true` **only** if the app is reachable exclusively through your proxy.
- [ ] Do not expose the app port directly; expose Nginx only.
- [ ] Create the admin with `npm run user:create`; there are no default credentials.
- [ ] Schedule `npm run db:backup` and test a restore (see deployment guide).
- [ ] Keep `.env` out of Git (already in `.gitignore`); never put real secrets in `.env.example`.
- [ ] If you enable the content editor, give `GITHUB_TOKEN` a **fine-grained** token limited to this one repository with only **Contents: read and write** and **Pull requests: read and write** (Metadata: read is added automatically). Do not grant Workflows or administration permissions. Set an expiry, store it like any other secret, rotate it before it expires, and protect the default branch (required reviews and CI) so a pull request from the editor cannot be merged unreviewed.
- [ ] Enable GitHub secret scanning and Dependabot alerts on the repository.
- [ ] Keep Node.js on a supported 22.x/24.x release and rebuild the image monthly for OS patches.

## Privacy

- Stored per account: e-mail, display name, role, progress (lessons, labs, simulations, quizzes), bookmarks, architecture decision records, project/capstone submissions (a link and notes), reviews received, portfolio settings and certificates.
- **Who sees a learner's data.** The learner; administrators; and the teachers of a cohort the learner joined — they see the learner's name, e-mail address, progress counts, assignment status and submitted work. The join form says this before the learner joins, and leaving a cohort ends it. Teachers of other cohorts see nothing (API tests check the 403/404 cases). `/api/faculty/overview` stays aggregated, without identifiers.
- **Public pages** show the display name only, never the e-mail address: a portfolio exists only after the learner switches it on, and lists only work a teacher accepted; a certificate's verification page is reachable only through its random 128-bit id.
- **Your data** (dashboard): a JSON export of everything stored about the account (`/api/me/export`), and account deletion after re-entering the password and typing a confirmation phrase (`/api/me/delete`; rate-limited; the last administrator cannot delete themselves). Deletion cascades to every table and removes reviews of the deleted work; audit events keep the user id with no e-mail.
- Submission links must be `https://` URLs (validated by the API and the database) and are rendered with `rel="noopener noreferrer"` (`nofollow` on public portfolios).
- Logs contain request IDs, trace IDs (when tracing is on), routes, statuses and timings — no bodies, cookies or passwords (sensitive-looking keys are redacted). Trace spans follow the same rule and also leave out query strings, client IP addresses and user agents ([ADR 0009](adr/0009-opentelemetry-tracing.md)).
- With `REDIS_URL`, rate-limit keys in Redis are SHA-256 hashes of the IP address, user id or e-mail address they count, never the values themselves.
- Use synthetic data in demos. Never load real student records into a public instance.

## Endpoint authorization review (v1.0, 2026-11-28)

Release checklist item 4. Scope: every API endpoint added or changed since the Phase 0 commit `21ad03b` — 60 endpoints in `server/src/routes/` (content, auth, admin, simulations, labs, assessment, architecture, institution, cms). Endpoints unchanged since Phase 0 (`/api/tracks`, `/api/paths`, `/api/lessons/:id`, `/api/search`, `/api/auth/logout`, `/api/auth/me`, lesson start/check, `/api/me/progress`, bookmarks, `/api/faculty/overview`, `/api/health`, `/api/ready`, `/metrics`) were reviewed in Phase 0 and are not repeated here.

**How access is enforced.** The router's `auth` option gives 401 to anonymous callers (`auth: "user"` or a role list) and 403 to a signed-in caller without one of the listed roles, before the handler runs. Ownership is enforced in the handlers: every `/api/me/…` route reads and writes rows `WHERE user_id = <session user>` and takes no user id from the request; cohort, review and assignment routes check that the caller teaches the cohort or the learner. Every mutating route passes the app-wide CSRF check before authentication.

**Access rules used below.** *Public* — no account; never returns personal data except the holder's display name on certificate and opted-in portfolio pages. *Public, own progress* — public content, plus the caller's own progress when signed in. *Signed in, own data* — any account; only the caller's own rows. *Member* — a member of the cohort (learners get a reduced view), or an admin. *Teaching faculty* — faculty/admin role **and** a faculty member of that cohort (admins: any cohort). *Faculty who teach the learner* — faculty/admin role and a faculty member of a cohort the learner is in as a learner (admins: anyone); never one's own work. *Staff* — faculty or admin. *Admin* — admin only.

### Tests cited

`AZ` is `server/test/api-authz-review.test.ts` (added by this review); the others are existing files in `server/test/`.

| Id | File | Test |
|---|---|---|
| AZ1 | api-authz-review | anonymous callers get 401 on every route that needs an account, and nothing changes |
| AZ2 | api-authz-review | students get 403 on faculty and admin routes, and nothing changes |
| AZ3 | api-authz-review | faculty get 403 on admin routes (users, roles, account status, audit log, certificate revocation), and nothing changes |
| AZ4 | api-authz-review | public-by-design routes answer without an account and never include personal data |
| AZ5 | api-authz-review | the CSRF check refuses a cross-site account deletion even with a valid session cookie |
| AZ6 | api-authz-review | /api/me reads return only the caller's own records, never another learner's |
| AZ7 | api-authz-review | writes to /api/me routes change only the caller's own rows |
| AZ8 | api-authz-review | another learner's progress never earns a certificate; neither the holder nor faculty can revoke one |
| AZ9 | api-authz-review | a private portfolio is 404 for everyone, including the learner's teacher; publishing is the owner's choice and disabling the account hides it |
| AZ10 | api-authz-review | another teacher cannot open, re-key, assign to or remove members from a cohort they do not teach |
| AZ11 | api-authz-review | a learner in the cohort cannot see other members, the join code, or remove anyone |
| AZ12 | api-authz-review | a teacher whose faculty role is taken away loses the teacher's view of the cohort at once |
| AZ13 | api-authz-review | the cohort's own teacher and administrators can manage it (positive control) |
| AZ14 | api-authz-review | another teacher cannot read or review work of a learner they do not teach |
| AZ15 | api-authz-review | a decision record is reviewable only under its canonical id, so reviews always reach the learner |
| AZ16 | api-authz-review | administrators cannot review their own work |
| AZ17 | api-authz-review | leaving the cohort ends the teacher's access to the learner's work |
| AZ18 | api-authz-review | faculty see only their own content-editor pull requests; administrators see all |
| AZ19 | api-authz-review | export contains only the signed-in account's data |
| AZ20 | api-authz-review | account deletion deletes only the signed-in account, even if another user's id is sent |
| RB | api-rbac | the "role-based access control" matrix (`GET /api/admin/users as faculty → 403` and the other rows); forbids students from changing roles, including their own |
| AD | api-admin | is admin-only and needs the CSRF header |
| AU1 | api-auth | blocks state-changing requests without the CSRF header; blocks cross-origin and cross-site requests even with the header |
| AU2 | api-auth | locks an account after repeated failures without blocking other accounts on the same IP; rate-limits registrations per IP |
| CN | api-content | returns a full track with lessons, related tracks and paths; returns learning paths with computed time estimates |
| SI | api-simulations | replays the actions on the server: a correct run passes, but is not saved for anonymous visitors; requires the CSRF header like every other write; returns the simulation without reference solutions |
| LB | api-labs | requires an account; never sends read-through answers to the browser |
| AS1 | api-assessment | serves every question type without answers or explanations; grades every type, explains correct answers and points wrong ones to a lesson (anonymous attempts are not saved) |
| AS2 | api-assessment | answers 404 for a track without a quiz yet and requires sign-in for personal results |
| AS3 | api-assessment | serves the reference solution to faculty only; answers 404 for an unknown project, and checks the role before saying whether a solution exists |
| AS4 | api-assessment | serves the brief, criteria, rubric, starter files and check script, but never the solution; lists capstones and serves one with resolved milestone links and its architecture figure |
| IN1 | api-institution | only faculty and admins create cohorts; the creator teaches it and gets a join code |
| IN2 | api-institution | non-members get 404; learners see assignments but not other members; faculty see members and progress |
| IN3 | api-institution | a new join code invalidates the old one; the last teacher cannot leave; a learner can leave and rejoin |
| IN4 | api-institution | faculty assign existing items with a due date; unknown items and duplicates are rejected |
| IN5 | api-institution | faculty who teach the learner see the work in their queue; other faculty are refused |
| IN6 | api-institution | is private until the learner publishes it, and never shows the e-mail address |
| IN7 | api-institution | anyone can verify a certificate by its id; only admins revoke it |
| IN9 | api-institution | learners join with the code (case-insensitive), and a wrong code is a clear 404 |
| IN8 | api-institution | export returns the learner's own data as a download, and nobody else's; deleting an account needs the password and the confirmation phrase, then removes everything; the last administrator cannot delete their own account |
| CM | api-cms | is limited to faculty and admins: students get 403, anonymous users 401; enforces the size limit and the CSRF check |

### Endpoints

| Endpoint | Method | Access rule | 401 / 403 | Another user cannot access | Tests |
|---|---|---|---|---|---|
| `/api/tracks/:slug` (changed) | GET | Public | n/a | n/a | CN, AZ4 |
| `/api/paths/:slug` (changed) | GET | Public | n/a | n/a | CN, AZ4 |
| `/api/graph` | GET | Public | n/a | n/a | AZ4 |
| `/api/integrations/:id` | GET | Public | n/a | n/a | AZ4 |
| `/api/capstones` | GET | Public | n/a | n/a | AS4, AZ4 |
| `/api/capstones/:id` | GET | Public | n/a | n/a | AS4, AZ4 |
| `/api/auth/register` (changed: shared limiter) | POST | Public, rate-limited | n/a | n/a | AU1, AU2 |
| `/api/auth/login` (changed: shared limiter) | POST | Public, rate-limited | n/a | n/a | AU1, AU2 |
| `/api/admin/users` (changed) | GET | Admin | RB, AZ1, AZ2, AZ3 | n/a | RB, AZ3 |
| `/api/admin/users/:id/role` (changed) | PATCH | Admin | AZ1, AZ2, AZ3 | faculty cannot promote themselves | RB, AZ3 |
| `/api/admin/users/:id/status` | PATCH | Admin | AD, AZ1, AZ2, AZ3 | AD | AD, AZ3 |
| `/api/admin/audit` (changed) | GET | Admin | RB, AZ1, AZ2, AZ3 | n/a | RB |
| `/api/simulations/:id` | GET | Public, own progress | n/a | AZ6 | SI, AZ4, AZ6 |
| `/api/simulations/:id/challenges/:challenge/verify` | POST | Public; saved for the caller only | n/a | saves under the session user only | SI, AZ4 |
| `/api/labs/:id` | GET | Public, own progress | n/a | AZ6 | LB, AZ4, AZ6 |
| `/api/labs/:id/complete` | POST | Signed in, own data | LB, AZ1 | AZ7 | LB, AZ1 |
| `/api/me/labs` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/tracks/:slug/quiz` | GET | Public (no answers) | n/a | n/a | AS1, AZ4 |
| `/api/tracks/:slug/quiz/grade` | POST | Public; saved for the caller only | n/a | saves under the session user only | AS1 |
| `/api/me/quizzes` | GET | Signed in, own data | AS2, AZ1 | AZ6 | AZ6 |
| `/api/tracks/:slug/projects` | GET | Public | n/a | n/a | AZ4 |
| `/api/projects/:id` | GET | Public (no solution) | n/a | n/a | AS4, AZ4 |
| `/api/projects/:id/solution` | GET | Staff | AS3, AZ1, AZ2 | n/a | AS3 |
| `/api/architectures` | GET | Public | n/a | n/a | AZ4 |
| `/api/architectures/:id` | GET | Public | n/a | n/a | AZ4 |
| `/api/me/decisions` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/decisions/:architectureId` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/decisions/:architectureId` | PUT | Signed in, own data | AZ1 | AZ7 | AZ7 |
| `/api/cohorts` | POST | Staff | IN1, AZ1, AZ2 | n/a | IN1 |
| `/api/cohorts` | GET | Signed in; own memberships; join code to teaching faculty only | AZ1 | IN9, AZ10, AZ11, AZ12 | IN9, AZ10, AZ12 |
| `/api/cohorts/join` | POST | Signed in (staff join as teachers — see findings) | AZ1 | n/a | IN9, AZ12 |
| `/api/cohorts/:id` | GET | Member (learner view) or teaching faculty | AZ1 | IN2, AZ10, AZ12 | IN2, AZ11, AZ12 |
| `/api/cohorts/:id/code` | POST | Teaching faculty | IN3, AZ1, AZ2 | AZ10, AZ12 | AZ13 |
| `/api/cohorts/:id/members/:userId` | DELETE | Self (leave), or teaching faculty | AZ1 | IN3, AZ10, AZ11, AZ12 | IN3, AZ17 |
| `/api/assignable` | GET | Staff | IN4, AZ1, AZ2 | n/a | IN4 |
| `/api/cohorts/:id/assignments` | POST | Teaching faculty | IN4, AZ1, AZ2 | AZ10 | IN4, AZ13 |
| `/api/cohorts/:id/assignments/:assignmentId` | DELETE | Teaching faculty; assignment must belong to that cohort | AZ1, AZ2 | AZ10, AZ11 | AZ13 |
| `/api/me/assignments` | GET | Signed in, own cohorts | AZ1 | AZ6 | AZ6 |
| `/api/me/submissions` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/submissions/:kind/:itemId` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/submissions/:kind/:itemId` | PUT | Signed in, own data | AZ1 | AZ7 | AZ7 |
| `/api/reviews` | GET | Staff; work of learners they teach (admins: all) | IN5, AZ1, AZ2 | IN5, AZ14, AZ17 | IN5 |
| `/api/reviews/:type/:id` | GET | Faculty who teach the learner | AZ1, AZ2 | IN5, AZ12, AZ14, AZ15, AZ17 | IN5, AZ14 |
| `/api/reviews/:type/:id` | POST | Faculty who teach the learner; not own work | AZ1, AZ2 | AZ14, AZ15, AZ16 | AZ14, AZ16 |
| `/api/me/decisions/:architectureId/review` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/portfolio` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/portfolio` | PUT | Signed in, own data; slug unique | AZ1 | AZ7 | IN6, AZ7 |
| `/api/portfolio/:slug` | GET | Public only when opted in and the account is enabled | n/a | IN6, AZ9 | IN6, AZ9 |
| `/api/me/certificates` | GET | Signed in, own data | AZ1 | AZ6 | AZ6 |
| `/api/me/certificates/:track` | POST | Signed in; eligibility from own progress only | AZ1 | AZ8 | AZ8 |
| `/api/certificates/:id` | GET | Public by design (random 128-bit id; display name only) | n/a | n/a | IN7, AZ4 |
| `/api/certificates/:id/revoke` | POST | Admin | IN7, AZ1, AZ2, AZ3 | AZ8 (holder and teacher refused) | IN7, AZ8 |
| `/api/me/export` | GET | Signed in, own data | IN8, AZ1 | IN8, AZ19 | IN8, AZ19 |
| `/api/me/delete` | POST | Signed in, own account; password + phrase | AZ1 | AZ20 | IN8, AZ5, AZ20 |
| `/api/cms/status` | GET | Staff | CM, AZ1, AZ2 | n/a | CM |
| `/api/cms/files` | GET | Staff | CM, AZ1, AZ2 | n/a | CM |
| `/api/cms/file` | GET | Staff | CM, AZ1, AZ2 | n/a | CM |
| `/api/cms/validate` | POST | Staff | CM, AZ1, AZ2 | n/a | CM |
| `/api/cms/submissions` | POST | Staff | CM, AZ1, AZ2 | n/a | CM |
| `/api/cms/submissions` | GET | Staff; faculty see their own, admins all | CM, AZ1, AZ2 | AZ18 | AZ18 |

**CSRF.** One mechanism covers every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`): it runs before authentication in `server/src/app.ts`. AU1 tests the mechanism; AD, CM, SI and AZ5 confirm it on an admin route, the content editor, a public write and account deletion.

### Findings

Before this review, 24 of the 60 endpoints had complete tests (sign-in, role and another-user cases where they apply). The other 36 lacked at least one case — most often the 401 case, the "another teacher" case for cohort management and reviews, or any isolation test for the `/api/me` routes and the architecture routes (which had no server tests at all). AZ1–AZ20 add them. Every refused call in AZ is also checked for side effects: the stored data must be byte-for-byte unchanged.

1. **Fixed — a demoted teacher kept the teacher's view of their cohorts.** Cohort faculty rights came from `cohort_members.role` alone. After an admin changed a teacher's role to student, that account could still open `GET /api/cohorts/:id` with every learner's name, e-mail address and progress, saw the join code in `GET /api/cohorts`, and could remove members with `DELETE /api/cohorts/:id/members/:userId`. A faculty membership now counts only while the account is faculty or admin (`cohortRole` in `server/src/routes/institution.ts`); review routes already required the role. Test: AZ12.
2. **Fixed — reviews filed under a non-canonical decision id.** `/api/reviews/decision/:id` looked the record up with `Number(id)`, so `012` or `0xc` found decision 12, but the review was stored under the text given. Such a review never reached the learner, was missing from their export and survived their account deletion (which matches `CAST(id AS TEXT)`). Only the canonical id is accepted now. Only teachers of the learner could do this, so it was a data-integrity and privacy defect rather than an access bypass. Test: AZ15.
3. **By design, recorded — staff who know a join code become teachers of that cohort.** `POST /api/cohorts/join` gives faculty and admin accounts the faculty role in the cohort (the cohort page says "Another teacher joins with the same code"). Learners also hold the code, so a faculty account that obtains it from a learner gains the teacher's view of that cohort. Mitigations: faculty accounts are created by admins, the join is audited (`cohort.joined` with the role), and a teacher can rotate the code and remove members. A separate teacher invite would close this; it is left to the product owner.
4. **By design, recorded — administrators see everything.** Admins can open any cohort and review any learner's work (they cannot review their own, AZ16); this matches the Privacy section.
5. **Open — no automated check that new routes are reviewed.** Adding a route does not fail any test until someone extends AZ1/AZ2. A route-table test that lists every registered route with its expected rule would close this; not done in v1.0.

## Known gaps (tracked in IMPLEMENTATION_STATUS.md)

- API requests are limited per signed-in user (600 a minute, the main abuse guard) and per client address (6,000 a minute, sized for a classroom behind one NAT address); both are configurable ([deployment.md, "Rate limits"](deployment.md#rate-limits)). Rate limits are per process (in memory) unless `REDIS_URL` is set ([ADR 0010](adr/0010-shared-rate-limits-redis.md)); while Redis is unreachable they fall back to per-process limits.
- No email verification or password reset yet (requires an email service; planned with Phase 5). Until then an admin can recreate an account.
- Run `npm audit` after every dependency change. The first audit (2026-11-25) reported zod, js-yaml and docs-linter dependencies; all were upgraded (see IMPLEMENTATION_STATUS.md).
