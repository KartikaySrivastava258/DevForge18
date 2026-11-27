# ADR 0004 — Authentication, sessions and abuse protection

- **Status:** Accepted (2026-11-24)

## Decision

- **Passwords:** scrypt, N=2¹⁷, r=8, p=1 (OWASP guidance), 16-byte salt; parameters stored in each hash and upgraded on next login. Policy: 10–200 characters, blocklist of common passwords, must not contain the email name (NIST SP 800-63B style — no composition rules).
- **Sessions:** 256-bit random token in an `HttpOnly; SameSite=Lax` cookie (`__Host-` prefixed and `Secure` in production); only its SHA-256 is stored; new token on every login; deleted on logout; expiry enforced server-side.
- **CSRF:** state-changing requests need the `X-DevForge-CSRF: 1` header (cross-site pages cannot set it without a CORS preflight, and no CORS is granted), a matching `Origin` when present, and a same-origin `Sec-Fetch-Site` when present.
- **Brute force:** the main defence is **per account** (10 failures per 15 minutes). Per-IP limits are generous (200 logins / 15 min, 60 registrations / hour) because an entire classroom may share one NAT address.
- **Timing:** unknown emails still run one scrypt verification so response time does not reveal which accounts exist.
- **Roles:** `student` (self-registration), `faculty`, `admin`; the first admin is created only through the CLI. Role changes are audited and the last admin cannot be demoted.

## Options considered

JWTs in local storage (rejected: exposed to XSS, hard to revoke); a hosted identity provider (attractive later for college SSO, but adds an external dependency for local use).

## Consequences

Sessions can be revoked instantly. Rate-limit counters live in memory: per process and reset on restart (documented limitation). **Amended 2026-11-27 by [ADR 0010](0010-shared-rate-limits-redis.md):** with `REDIS_URL` set, the counters are shared by all instances in Redis, and fall back to the per-process counters while Redis is unreachable.

## Revisit when

The college wants single sign-on (add OIDC), or more than one instance runs (limits: done in ADR 0010; sessions still need a shared database).
