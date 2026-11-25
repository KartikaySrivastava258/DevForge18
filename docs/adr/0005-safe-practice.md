# ADR 0005 — Safe practice: labelled simulations, no untrusted code on the server

- **Status:** Accepted (2026-11-24)

## Context

Learners need hands-on practice with tools such as Docker, Kubernetes and Kafka. Running learner-supplied code or containers on the main server would expose every user's data and the host.

## Decision

1. Lab modes are explicit in content: **read-through**, **local** (runs on the learner's machine), **simulation** (an interactive model in the browser). The UI labels each mode; simulations are never presented as real infrastructure.
2. The main server never executes learner code, never mounts the Docker socket, and never runs infrastructure commands.
3. Lesson self-checks and future auto-graded tasks are evaluated by comparing submitted answers with authored answers on the server — no code execution.
4. Real execution environments, if ever added (Phase 6), run in isolated, ephemeral sandboxes with CPU/memory/time quotas, no outbound network by default, non-root users, secret isolation, automatic cleanup and audit logs, on infrastructure separate from the main application.

## Consequences

Some labs are less immersive than a live terminal; in return the platform is safe to host for a whole college.
