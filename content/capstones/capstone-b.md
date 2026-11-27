---
id: capstone-b
letter: B
title: Course registration platform
summary: A small but production-shaped course-registration service — PostgreSQL as the source of truth, a Redis cache and rate limits, Nginx in front, everything in Docker Compose, tested with Postman and delivered through pull requests.
level: intermediate
estimated_hours: 40
tracks: [git-github, postgresql, postman, redis, nginx, docker]
architecture: media:capstones/capstone-b-architecture.svg
user_stories:
  - As a student, I want to see which courses still have seats and register in one step so that I do not queue at the registration office.
  - As a registration officer, I want the system to refuse double enrolments and full courses so that I stop fixing them by hand every term.
  - As an on-call engineer, I want the service to stay responsive during the first hour of registration so that a rush of students does not take it down.
  - As a new team member, I want to start the whole system with one command and run its tests so that I can contribute on my first day.
milestones:
  - id: data-model
    title: A database that refuses bad data
    goal: Model students, courses and enrolments in PostgreSQL so that the rules of registration are enforced by the database itself, and change the schema only through migrations.
    deliverables:
      - Numbered migration files and a migration runner, applied to an empty database and to one with data.
      - Sample data and a seats-left view.
    acceptance:
      - Duplicate students, duplicate enrolments, unknown courses and impossible credit values are rejected by constraints.
      - Registering for a full course is refused even when two requests arrive at the same moment (the test runs them concurrently).
      - Running the migrations twice changes nothing.
    reuses:
      - { kind: project, id: pg-course-registration }
      - { kind: lesson, id: postgresql-transactions-and-acid }
      - { kind: lesson, id: postgresql-isolation-and-anomalies }
      - { kind: lesson, id: postgresql-backups-restores-migrations }
  - id: api-and-tests
    title: An API with an executable contract
    goal: Build the registration API (list courses, register, cancel) and describe it with a Postman collection that is run by Newman on every pull request.
    deliverables:
      - The API service with a health endpoint.
      - A Postman collection and environment covering success, validation errors and authorisation.
    acceptance:
      - The collection passes against the API and fails against deliberately broken versions of it (wrong status code, missing validation).
      - Registering returns 201, a duplicate returns 409 and a full course returns 409 with a clear message.
      - No secret is stored in the collection or the repository.
    reuses:
      - { kind: project, id: postman-college-api-tests }
      - { kind: project, id: postman-auth-flow-tests }
      - { kind: lab, id: postman-assertions-for-status-and-body }
  - id: cache-and-limits
    title: Fast reads and fair access under load
    goal: Cache the course list in Redis with correct invalidation, and rate-limit registration attempts per student so that one script cannot starve everyone else.
    deliverables:
      - A cache-aside course list with a TTL and invalidation on every enrolment change.
      - A sliding-window rate limiter on the register endpoint.
    acceptance:
      - After an enrolment, the seats shown are correct within one request (no stale count).
      - The service keeps answering when Redis is stopped (the cache is optional; PostgreSQL is the source of truth).
      - A student sending more than the allowed number of attempts per minute gets 429, others are unaffected.
    reuses:
      - { kind: project, id: redis-catalogue-cache }
      - { kind: project, id: redis-rate-limiter }
      - { kind: lab, id: redis-cache-under-load }
  - id: edge-and-packaging
    title: One entry point, one command
    goal: Put Nginx in front of two API instances and the static frontend, and package the whole system as a Docker Compose project with health checks and persistent data.
    deliverables:
      - nginx.conf with static files, /api proxying, load balancing and security headers.
      - compose.yaml, Dockerfiles and a .dockerignore.
    acceptance:
      - docker compose up starts everything; the API waits for a healthy database.
      - Stopping one API instance does not interrupt reads.
      - Data survives docker compose down and up; containers run as non-root users.
    reuses:
      - { kind: project, id: nginx-load-balancing-demo }
      - { kind: project, id: docker-compose-fullstack }
      - { kind: lab, id: nginx-safe-headers-and-rate-limiting }
  - id: delivery
    title: Delivered through pull requests
    goal: Work as a team on GitHub — branches, reviewed pull requests, CI that runs the database checks and the Postman collection — and tag a release.
    deliverables:
      - A repository with a protected main branch, a pull request template and CI.
      - A tagged release with release notes.
    acceptance:
      - Every change reached main through a reviewed pull request with green CI.
      - The README lets a newcomer start the system and run every test with documented commands.
    reuses:
      - { kind: project, id: git-team-task-tracker }
      - { kind: project, id: git-release-workflow }
rubric:
  - { criterion: "Data integrity", excellent: "Every rule is a constraint or a transaction, including the full-course race, proven by tests that run concurrent requests.", good: "Rules are enforced in the database; the race is handled.", needs_work: "Rules only in application code, or a full course can be overbooked." }
  - { criterion: "API contract", excellent: "The Postman collection is the documentation, runs in CI, and catches the broken variants; status codes and error bodies are consistent.", good: "A passing collection covering the main cases.", needs_work: "Manual testing only." }
  - { criterion: "Performance and resilience", excellent: "Measured before and after caching, correct invalidation, graceful behaviour without Redis, fair rate limits, two API instances behind Nginx.", good: "Cache and limiter work as specified.", needs_work: "A cache that shows stale seats, or a service that fails when Redis is down." }
  - { criterion: "Operability", excellent: "One command to start, health checks everywhere, non-root containers, persistent data, and a runbook section in the README.", good: "Compose starts a working system.", needs_work: "Setup needs undocumented manual steps." }
  - { criterion: "Teamwork", excellent: "Small reviewed pull requests, meaningful commit messages, a release with notes, and a short retrospective.", good: "Pull requests and CI are used throughout.", needs_work: "Work pushed straight to main." }
stretch_goals:
  - Add OpenTelemetry tracing from Nginx through the API to PostgreSQL and find the slowest step of registration.
  - Add a waiting list that offers a seat to the next student when someone cancels, without ever overbooking.
  - Load-test the registration rush and write up the bottleneck you found and fixed.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Every term the college's registration office goes through the same week: queues, spreadsheets, students enrolled
twice and courses overbooked. Build the service that replaces it — small enough for a team of three or four to
finish in a few weeks, but shaped like a real production system: the database enforces the rules, the API has an
executable contract, reads are cached and attempts are rate-limited, a single Nginx entry point balances two API
instances, the whole system starts with one command, and every change goes through a reviewed pull request.

Each milestone builds on mini-projects you may already have done in the tracks; the "builds on" links show where.
The capstone is about **combining** them into one system that works as a whole.

## Architecture

The diagram above is the target. Two design rules matter most:

- **PostgreSQL is the source of truth; Redis is disposable.** Every rule lives in the database; the cache only
  makes reads faster, and the service must keep working, more slowly, without it.
- **One public entry point.** Only Nginx is reachable from outside. The API instances are stateless, so a second
  instance (or a restarted one) needs no coordination.

Write down any decision that deviates from this design as a short architecture decision record in `docs/adr/`.

## Getting started

1. Form a team, create the repository, protect `main` and add a pull request template (milestone 5 starts on day
   one, not at the end).
2. Work through the milestones in order; each one ends with its acceptance criteria demonstrably met — ideally by
   automated tests that run in CI.
3. Keep a `README.md` that a newcomer can follow: how to start the system, run the tests and read the logs.
4. Present the result: a short demo of a registration rush, the tests that prove the rules, and one thing you
   would design differently next time.
