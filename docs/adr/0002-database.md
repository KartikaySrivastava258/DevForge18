# ADR 0002 — SQLite now, with a path to PostgreSQL

- **Status:** Accepted for Phases 0–5 (2026-11-24). **Awaiting project-owner confirmation.**

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

## Revisit when

More than one app instance is needed; write latency appears in metrics; the institution requires a managed PostgreSQL service; or analytics queries become long enough to block the event loop.
