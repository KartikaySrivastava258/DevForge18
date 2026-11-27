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
- With `REDIS_URL`, rate-limit keys in Redis are SHA-256 hashes of the IP address or e-mail address they count, never the values themselves.
- Use synthetic data in demos. Never load real student records into a public instance.

## Known gaps (tracked in IMPLEMENTATION_STATUS.md)

- Rate limits are per process (in memory) unless `REDIS_URL` is set ([ADR 0010](adr/0010-shared-rate-limits-redis.md)); while Redis is unreachable they fall back to per-process limits.
- No email verification or password reset yet (requires an email service; planned with Phase 5). Until then an admin can recreate an account.
- Run `npm audit` after every dependency change. The first audit (2026-11-25) reported zod, js-yaml and docs-linter dependencies; all were upgraded (see IMPLEMENTATION_STATUS.md).
