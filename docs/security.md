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
| Admin functions | Privilege escalation | Role checks on every route; self-registration is always `student`; first admin via CLI only; last admin cannot be demoted; role changes audited |
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
- [ ] Enable GitHub secret scanning and Dependabot alerts on the repository.
- [ ] Keep Node.js on a supported 22.x/24.x release and rebuild the image monthly for OS patches.

## Privacy

- Only email, display name, role, progress and bookmarks are stored. Faculty statistics are aggregated and contain no personal identifiers.
- Logs contain request IDs, routes, statuses and timings — no bodies, cookies or passwords (sensitive-looking keys are redacted).
- Use synthetic data in demos. Never load real student records into a public instance.

## Known gaps (tracked in IMPLEMENTATION_STATUS.md)

- Rate limits are per process (in memory).
- No email verification or password reset yet (requires an email service; planned with Phase 5). Until then an admin can recreate an account.
- No account self-deletion or data export screen yet (planned with privacy controls, Phase 5).
- Run `npm audit` after every dependency change. The first audit (2026-11-25) reported zod, js-yaml and docs-linter dependencies; all were upgraded (see IMPLEMENTATION_STATUS.md).
