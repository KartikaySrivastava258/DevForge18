# ADR 0002 — SQLite now, with a path to PostgreSQL

- **Status:** Accepted (2026-11-24). **Confirmed by the project owner for v1.0 on 2026-11-28:** SQLite, one app instance; no PostgreSQL adapter in v1.0.

## Context

The blueprint lists PostgreSQL as the suggested primary database. The expected load is college scale: hundreds to low thousands of users, writes limited to sign-ins, progress and bookmarks. Students and faculty will often run the platform on their own laptops.

## Problem

Pick a database that is reliable, simple to operate and does not raise the barrier to running the project.

## Options considered

1. **PostgreSQL from day one** — production standard and matches the PostgreSQL track, but every contributor must install and run a server; could not be tested in the build environment.
2. **SQLite via `node:sqlite`** — built into Node, nothing to install, single-file backups, WAL mode allows concurrent readers.
3. Both behind an abstraction from the start — doubles the testing surface before there is any need.

## Decision

Option 2. Use `STRICT` tables, foreign keys, WAL journaling, checksummed migrations and portable SQL. Keep all SQL inside `server/src/auth`, `server/src/routes` and `server/src/db` so a PostgreSQL adapter can replace it in one place.

## Positive consequences

Zero-install setup; trivial online backup (`VACUUM INTO`) with integrity check; fast tests with in-memory databases.

## Negative consequences

- One writer at a time; fine for this workload, not for heavy concurrent writes.
- One server process per database file, so horizontal scaling needs PostgreSQL.
- `node:sqlite` is flagged experimental in Node 22 and its API is synchronous.

## Risks

A future Node release could change the experimental API — mitigated by pinning Node 22 LTS and full test coverage of the data layer.

## Owner decision for v1.0 (2026-11-28)

- v1.0 ships with SQLite and runs as **a single app instance** (one Node.js process per database file). This is a deployment requirement, documented in [docs/deployment.md](../deployment.md#database-one-app-instance).
- The PostgreSQL adapter is **not** built for v1.0.
- **What changes the decision:** needing more than one app server (for capacity or availability). That is the trigger to build the PostgreSQL adapter described above; until then, scale the one instance up (CPU, memory), not out. The load test (docs/load-testing.md) shows one process starting to queue at around 300 concurrent active users on an 8-core laptop.
- `REDIS_URL` (ADR 0010) shares rate limits between instances, but sessions and progress are still in the SQLite file, so it does not by itself make several instances possible.

## Revisit when

More than one app instance is needed (the owner's trigger above); write latency appears in metrics; the institution requires a managed PostgreSQL service; or analytics queries become long enough to block the event loop.
