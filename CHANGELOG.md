# Changelog

All notable changes to DevForge 18. Dates are UTC. The project follows [Semantic Versioning](https://semver.org/); the content (`content/`) is versioned per item with `content_version`.

## [1.0.0] — 2026-11-28

The first release: all 18 tracks complete, with college features. Evidence for every item below is in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) (section "v1.0 release checklist").

### Learning content

- **18 tracks** (Git and GitHub, Docker, Kubernetes, PostgreSQL, Terraform, GitHub Actions, Prometheus and Grafana, LangChain and LlamaIndex, Redis, Apache Kafka, Jenkins, Jira, Postman, Nginx, OpenTelemetry, Apache Airflow, n8n, MLflow), each with a plain-language explanation, its place in a system architecture, a curriculum by level and official resources.
- **133 lessons** (54 beginner, 42 intermediate, 37 advanced) with objectives, figures, expected output and a server-graded self-check. The commands in 131 lessons are run against the real tools by the test suite and in CI, and their output is compared; the 2 lessons about the hosted Jira service are checked against Atlassian's documentation and say so.
- **134 figures**, 22 lessons with step-through diagrams.
- **18 simulations**, one per track, with challenges verified by replaying the learner's actions on the server; each is labelled as a simulation and states what it simplifies.
- **37 labs**: local labs with check scripts, simulation labs and a read-through lab graded on the server.
- **18 quizzes** (230 questions, six question types) graded on the server.
- **54 mini-projects** with stories, acceptance criteria, rubrics, starter files, hints and a faculty-only solution; every acceptance check fails on the starter and passes on the solution in CI.
- **7 capstones** (A–G), **17 integrations** between tracks, **10 reference architectures** with learner decision records.
- **36 case studies** (every claim with a verbatim quote, its source and the date checked) and **89 alternatives** with licences.
- **8 learning paths**, search with typo tolerance, an interactive system map and a relationship graph.

### Platform

- Accounts and sessions (scrypt, hashed session tokens, CSRF defence), roles (student, faculty, admin), progress, bookmarks, dashboard.
- **For colleges:** cohorts with join codes, assignments with due dates, submissions reviewed against rubrics, opt-in public portfolios, certificates that anyone can verify, data export and account deletion.
- **Admin screens** (roles, disable/enable, audit log) and a **content editor** for faculty that opens GitHub pull requests.
- **Rate limits for shared networks:** per signed-in user (600 requests a minute, the main abuse guard) and per address (6,000 a minute, sized for a classroom behind NAT), both configurable; optional shared counters in Redis.
- OpenTelemetry tracing of DevForge itself (optional), Prometheus metrics, structured logs.
- Docker Compose deployment behind Nginx, read-only containers, images pinned by digest; backups with an integrity check.
- Dark and light themes, keyboard navigation, mobile layout, reduced motion; a strict Content Security Policy unchanged since the first commit.

### Verification

- Unit, API and browser tests; an automated accessibility audit (axe) of every page type in both colour schemes; a crawler that fails on any dead internal link; an upgrade test from two older versions and a backup-and-restore test; a Compose and Nginx smoke test; a k6 load test (nightly).
- An authorization review of every endpoint added since the first version, with tests that another user cannot read or change someone else's data ([docs/security.md](docs/security.md#endpoint-authorization-review-v10-2026-11-28)).

### Known limitations

- One app instance per database (SQLite); needing more than one app server is the trigger for the PostgreSQL adapter ([ADR 0002](docs/adr/0002-database.md)).
- The manual screen-reader pass has not been done yet.
- See [README, "Known limitations"](README.md#known-limitations).
