# Remaining work and how to build it

This document is the build plan for finishing DevForge 18. It describes what exists, what is missing compared with the blueprint (`DEVFORGE18_MASTER_BLUEPRINT.md`), and **exactly how** to implement each missing part so that it matches the quality of the parts already built. It is written for the project owner and for a coding agent (see [`MASTER_PROMPT.md`](MASTER_PROMPT.md)).

Read [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for the precise, dated record of what has been verified so far.

## Contents

1. [Where the project stands](#1-where-the-project-stands)
2. [Non-negotiable quality rules](#2-non-negotiable-quality-rules)
3. [Gap analysis against the blueprint](#3-gap-analysis-against-the-blueprint)
4. [Architecture for the missing features](#4-architecture-for-the-missing-features)
5. [Plan for each of the 18 tracks](#5-plan-for-each-of-the-18-tracks)
6. [Platform features still to build](#6-platform-features-still-to-build)
7. [Milestones and order of work](#7-milestones-and-order-of-work)
8. [How to verify every change](#8-how-to-verify-every-change)
9. [Open issues and risks](#9-open-issues-and-risks)

## 1. Where the project stands

Snapshot at the time of writing (2026-11-25):

| Area | State |
|---|---|
| Platform: accounts, roles, sessions, progress, bookmarks, search, system map, lesson reader, dark/light themes, mobile layout | Complete and tested |
| Security: scrypt passwords, hashed session tokens, CSRF protection, strict CSP, per-account brute-force limits, build-time HTML escaping, audit log | Complete and tested |
| 18 tracks with explanation, curriculum outline, planned labs and projects, official resources | Present (outline level) |
| 8 learning paths | Complete |
| Lessons | 21 across 10 tracks, beginner level only. All 21 executed and confirmed in CI (the last 5 — Jenkins 1, Terraform 1–2, Kubernetes 1–2 — in CI run 45643638519, 2026-11-25) |
| Executable-lesson system (commands run against real tools, output compared) | Complete: Git, PostgreSQL, Redis, Nginx, Docker, Jenkins, Terraform, Kubernetes, HTTP via a live DevForge API |
| Checkers: workflow files, Jenkinsfiles, content schema, Markdown safety | Complete |
| CI on GitHub | Green (run #2); installs pinned, checksum-verified tools |
| Labs, simulations, quizzes beyond self-checks, projects, capstones, case studies, alternatives, glossary, videos, diagrams beyond ASCII, admin/faculty screens | **Not built** |

On every track page today, **Lessons** works for the 10 tracks that have lessons; **Labs** and **Projects** only list planned items; **Official resources** lists links, of which only a few have been verified.

## 2. Non-negotiable quality rules

These rules are why the existing work can be trusted. Every new feature must follow them.

1. **Never invent facts.** No made-up commands, outputs, versions, statistics, company usage, video titles or links. Every claim about a real organisation needs a primary source (the company's engineering blog, a conference talk by its engineers, an official case study or a peer-reviewed paper), recorded with its URL and the date it was checked.
2. **Check current versions on the web before writing about a tool.** Models and memories go out of date; this project already caught three outdated version assumptions (GitHub Actions, Terraform, Jenkins). Record the version used in the lesson's `verification.details`.
3. **Execute what can be executed.** Commands in lessons run in the test suite against the real tool (`bash run`, `sql run`, `redis run` blocks). Output is captured from real runs with `npm run lessons:record`, never typed by hand. A lesson is `pending` until CI confirms it, then `executed`.
4. **Label simulations as simulations.** A simulation is a model that teaches a concept. It must never claim to be the real tool, and the UI must say so.
5. **Security first.** No inline scripts or styles in HTML (the CSP forbids them). No remote images or scripts without a deliberate CSP change and a documented reason. No learner code runs on the server (ADR 0005).
6. **Accessible by default.** Every diagram and animation has a text alternative; every interactive element works with a keyboard; animations respect `prefers-reduced-motion`; colour is never the only signal.
7. **Tested before done.** A feature is done when its tests pass locally and in CI, the browser tests cover its main journey, and `IMPLEMENTATION_STATUS.md` records it.
8. **Small, reviewable steps.** One track, one feature or one fix per change, each leaving the project green.

## 3. Gap analysis against the blueprint

| Blueprint feature | Current state | Priority |
|---|---|---|
| Comprehensive beginner → advanced lessons for all 18 tracks | 21 beginner lessons on 10 tracks | P1 |
| Pictures, diagrams and animations that explain each concept | ✅ SVG figures in every lesson and a step-through per track with lessons (2026-11-25); moving-element animations still to come | P1 |
| Interactive simulations for every track | Framework done (2026-11-25); Git and Kubernetes simulations with server-verified challenges; 16 tracks to go | P1 |
| Hands-on labs with verification | Lesson "Try it yourself" sections only; lab pages do not exist | P1 |
| Quizzes (more question types, per-track assessments) | Per-lesson multiple-choice self-checks | P2 |
| Real-world usage and case studies with sources | Only "Where this fits in a real system" sections | P1 |
| Alternatives and trade-offs for each tool | Brief mentions in some lessons | P1 |
| Mini-projects per track and capstones A–G | Listed as planned | P2 |
| Integration lessons between tools, full relationship graph | `related` links with a reason; system map | P2 |
| Architecture studio, reference architectures | None | P3 |
| Installation guides per OS | Inside some lessons | P1 (one setup lesson per track) |
| Verified videos | None | P3 |
| Glossary and command explorer | None | P2 |
| Admin and faculty screens, cohorts, assignments | API foundation only | P3 |
| Portfolio and certificates | None | P3 |
| Verified external links | ✅ All 55 unique links reachable and reviewed (2026-11-25); 10 moved or mislabelled links corrected | Re-run monthly |

## 4. Architecture for the missing features

All new content follows the existing principle (ADR 0003): **content lives in files in Git, is validated by zod schemas at build time, and is compiled into `build/content.json`.** Interactive behaviour lives in React components under `web/src/`. Pure logic lives in `shared/` so it can be unit-tested without a browser.

### 4.1 Content model extensions

Extend `shared/content-schema.ts` with new schemas, each validated by `scripts/lib/content-loader.ts` with cross-reference checks (every referenced track, lesson, lab or simulation must exist):

| New content type | Location | Key fields |
|---|---|---|
| Lab | `content/labs/<track>/<lab-id>.md` | id, track, level, mode (`local` / `simulation` / `read-through`), estimated_minutes, objectives, prerequisites, steps with `bash run` blocks, verification (same as lessons), checkpoints (what the learner must see), reset instructions, cleanup |
| Simulation | `content/simulations/<track>/<sim-id>.yaml` + a React component | id, track, title, concept, component name, scenarios (named initial states), challenges (goal + check), learning objectives, text alternative |
| Project | `content/projects/<track>/<project-id>.md` | id, level, brief, user stories, acceptance criteria, rubric (criteria × levels), starter repository instructions, stretch goals, related tracks |
| Capstone | `content/capstones/<letter>.md` | the blueprint's capstone A–G, milestones, architecture diagram, rubric |
| Case study | `content/case-studies/<id>.md` | organisation, track(s), claim list where **each claim has `source_url`, `source_title`, `publisher`, `published`, `checked_on`, `kind: confirmed / inferred`**, summary, lessons learned |
| Alternatives | inside `track.yaml` as `alternatives:` | name, category, when to choose it, when not, licence, links (official only) |
| Glossary term | `content/glossary/<term>.yaml` | term, short definition, longer explanation, tracks, related terms |
| Quiz | `content/quizzes/<track>/<quiz-id>.yaml` | questions with types: single choice, multiple choice, ordering, matching, command-output interpretation, diagram labelling; each with explanation; server-side grading like self-checks |
| Media asset | `content/media/<track>/…` | SVG or PNG, with a sidecar `.yaml` holding alt text, caption, credit and licence |

Tests to add for each type: the loader accepts the real content; it rejects deliberately broken copies (missing field, unknown reference, missing source on a confirmed claim).

### 4.2 Pictures, diagrams and animations

Goal: every lesson section that explains *how something works* has a picture, and every process (a request, a rollout, a merge) can be watched step by step.

Use three levels, from simplest to richest:

1. **Static diagrams as SVG.** Author diagrams as SVG files in `content/media/` (hand-drawn in a vector editor or generated by code). Reference them in lesson Markdown as `![alt text](media:git/three-areas.svg "caption")`; the Markdown renderer resolves `media:` paths and renders a `<figure>` with `<figcaption>`. **Changed during implementation ([ADR 0007](docs/adr/0007-inline-svg-figures.md)):** SVGs are validated against a strict allowlist and *inlined*, not copied and shown with `<img>`, because an `<img>` SVG cannot follow the app's theme toggle or be stepped through. Hashed files with `<img>` remain the plan for photographs and screenshots. Use the design tokens' colours via `currentColor` and CSS classes so diagrams work in dark and light themes. Keep text in SVGs as real text (searchable, translatable, accessible).
2. **Step-through diagrams.** A `StepDiagram` React component shows one SVG with numbered states; **Next / Previous** buttons and arrow keys move between steps; each step highlights elements (by `data-step` attributes) and shows a caption. Lessons embed them with a fenced block, for example ```` ```diagram steps=git-commit-flow ````, which the renderer turns into a placeholder element that the lesson page hydrates. Every step's caption is also the text alternative.
3. **Animations.** Use CSS transitions and the Web Animations API on SVG elements (moving packets, Pods being replaced, messages flowing through Kafka partitions). Rules: animations are **user-started** (Play button), can be paused, and are replaced by the step-through mode when `prefers-reduced-motion` is set. Never autoplay looping animations.

Mermaid is convenient for flowcharts but heavy and runtime-rendered; if used, render it **at build time** to SVG (for example with `@mermaid-js/mermaid-cli` in the build step) so no Mermaid JavaScript ships to the browser and the CSP stays strict.

Photographs or screenshots of real tools (for example the Jenkins UI or Grafana) must be taken by the project team from a real installation, stored in `content/media/`, and credited. Never hotlink images from other websites.

### 4.3 Simulation framework

Simulations make invisible behaviour visible: what a Kafka consumer group does when a consumer dies, how a Kubernetes controller reconciles, why an index changes a query plan. Build one framework and one simulation per track (section 5 specifies each).

Architecture, so simulations are correct and testable:

```text
shared/simulations/<track>/<sim>.ts      pure model: state, actions, step(), invariants
shared/simulations/<track>/<sim>.test.ts unit tests: every action, every invariant
web/src/simulations/<Sim>.tsx           React view: renders state, sends actions
web/src/simulations/SimulationShell.tsx shared chrome: title, "Simulation" badge, scenario
                                        picker, play/pause/step/reset, speed, event log,
                                        challenge panel, text-mode toggle
content/simulations/<track>/<sim>.yaml   scenarios, challenges, objectives, text alternative
```

Rules for every simulation:

- **The model is a pure, deterministic function** (`next = step(state, action)`), with a seeded random generator where randomness is needed. This makes it unit-testable and replayable.
- **Invariants are tested.** For example, Kafka: "each partition is assigned to exactly one consumer in a group"; Kubernetes: "after reconciliation, ready Pods = desired replicas unless the image is broken".
- **An event log** under the visual explains every change in words ("Controller saw 2 Pods, desired 3, created web-7f9c"). This doubles as the accessible text alternative.
- **Challenges** turn watching into doing ("Make the consumer lag reach zero", "Roll back the broken release"); the check is a pure function over the state, so it can be unit-tested and progress can be recorded through the existing progress API.
- **A visible "Simulation" badge** and a note on what the model simplifies.
- **Performance:** animations use `requestAnimationFrame` and CSS transforms; the model updates at a fixed tick; no work runs when the simulation is off-screen or paused.
- **Browser tests** cover: open the simulation, run one scenario, complete one challenge, keyboard operation, reduced-motion mode.

Track pages get a **Simulations** section; lessons embed simulations with ```` ```simulation kafka-consumer-groups ````.

### 4.4 Labs that really work

A lab is longer than a lesson's "Try it yourself" and has a goal, checkpoints and a reset. Three modes:

- **Local labs** (learner's machine). Steps use executable blocks, so the test suite and CI prove every step works with pinned tool versions. Add a small **verification script** per lab (`labs/<track>/<lab-id>/verify.sh`) that the learner runs at the end; it checks the result (for example "the repository has three commits and a `.gitignore` that ignores `.env`") and prints a clear pass/fail report. The same script runs in CI after the lab's steps, so the checker itself is tested.
- **Simulation labs** use the framework in 4.3 with challenges.
- **Read-through labs** walk through real output and ask the learner to interpret it, with quiz questions.

Progress: record lab completion through a new `lab_progress` table (new migration) when the learner submits the verification result or completes the simulation challenges. Treat local verification as self-reported (it cannot be proven from a browser) and label it so.

### 4.5 Projects and capstones

Each mini-project page has: a realistic brief, user stories, acceptance criteria written as testable statements, a rubric, a starter template (a small repository or folder under `projects/`), hints that reveal progressively, and a reference solution kept out of the public UI (faculty role only). Capstones A–G follow the blueprint, add an architecture diagram and milestones, and reuse labs. Faculty review can use the existing roles and audit log.

### 4.6 Case studies, real-world usage and alternatives

Add two sections to every track page and to relevant lessons:

- **"Who uses this and why"**: short, sourced statements from case-study files. The page shows the source link and the date it was checked next to every claim. Distinguish "confirmed by the organisation" from "inferred" and avoid figures that are not in the source.
- **"Alternatives and how to choose"**: a comparison table from `alternatives:` in `track.yaml` — when this tool is the right choice, when an alternative fits better, licence and hosting differences. Keep it balanced: no tool is "the best", only better for a context.

Primary sources to search first: official engineering blogs of the organisation, talks published by the conference (KubeCon, QCon, Strange Loop, PGConf), project websites' official user or case-study pages (for example CNCF case studies), and academic papers. Every source is added to the link checker.

### 4.7 Quizzes and assessment

Extend the self-check engine (server-side grading already exists) with new question types (multiple answers, ordering, matching, interpreting command output, labelling a diagram). Add a per-track quiz that mixes levels, and use it for the blueprint's "take the quiz to skip ahead" alternate routes on learning paths. Never send answers to the browser before grading.

### 4.8 Videos

Only add a video after a person has watched it in full and recorded title, creator, duration, captions availability and URL in content. Embed with `youtube-nocookie.com` and add a narrowly scoped `frame-src` to the CSP in `server/src/http/security.ts`, with a test that the CSP still forbids everything else. Always provide a text summary next to the video.

## 5. Plan for each of the 18 tracks

Each track below lists the lessons still to write (existing ones are marked ✅), the simulation to build, the labs, real-world context, alternatives, and how its commands are verified. Lesson counts aim at roughly **3 beginner, 3 intermediate and 2 advanced** per track. Every lesson follows the structure in `docs/content-authoring.md` and adds, wherever it helps understanding: a picture (4.2), a step-through or animation, a "Who uses this and why" note (4.6), and an "Alternatives" note.

**About the real-world notes below:** the *origin* facts are widely documented and safe to start from, but must still be cited from a primary source in the lesson. *Usage by specific companies* must be found and cited from primary sources before being written; the "where to look" hints are starting points, not claims.

### 5.1 Git and GitHub

- **Lessons:** ✅ What Git is and setup · ✅ First commits · ✅ Remotes, push and pull · Branches and merging (with a real merge conflict, executed) · Undoing work safely (`restore`, `reset`, `revert`, reflog) · Pull requests and code review on GitHub · Rebasing and history editing (advanced) · Protected branches, signed commits and secret scanning (advanced).
- **Simulation — commit graph explorer:** the model is a DAG of commits with branch pointers and `HEAD`; actions are commit, branch, switch, merge (fast-forward or three-way), rebase and reset. The view draws the graph and animates pointer moves. **Challenges:** "merge `feature` without a merge commit", "undo the last commit on a shared branch safely (revert, not reset)". **Invariants:** every commit except the root has parents; branch names point at existing commits.
- **Labs:** resolve a merge conflict (local, executed); recover a deleted branch with reflog (local); review a pull request with a checklist (read-through).
- **Real world:** Git was created by Linus Torvalds in 2005 for Linux kernel development. Look for sources in the Git project's history pages, GitHub's own engineering blog and the Linux kernel's documentation on its workflow.
- **Alternatives:** Mercurial; hosting alternatives GitLab, Bitbucket, Gitea/Forgejo (self-hosted).
- **Verification:** executed (Git is available locally and in CI).

### 5.2 Docker

- **Lessons:** ✅ Images vs containers · ✅ Volumes and bind mounts · ✅ Writing a Dockerfile (layers, cache, `.dockerignore`) · Multi-stage builds and small images · Networks and Docker Compose · Health checks, logs and resource limits · Image security: non-root users, scanning, pinning digests (advanced) · Build cache and supply-chain (SBOM, provenance) basics (advanced).
- ✅ **Simulation — layer cake and cache:** model a Dockerfile as ordered instructions; editing a line invalidates the cache from that point; show which layers rebuild and the final image size. **Challenge:** reorder instructions so a source change does not reinstall dependencies.
- **Labs:** containerise a small API (executed); Compose an API with PostgreSQL (executed in CI); shrink an oversized image (executed, compare `docker image ls` sizes).
- **Real world:** Docker was open-sourced by dotCloud in 2013. Sources: Docker's official blog and documentation; CNCF and company engineering blogs for container adoption stories.
- **Alternatives:** Podman, containerd/nerdctl, Buildah; for local VMs, Lima/Colima.
- **Verification:** executed in CI behind `DEVFORGE_DOCKER_TEST=1`.

### 5.3 Kubernetes

- **Lessons:** ✅ Deployments and self-healing · ✅ Services, rolling updates and rollback · ✅ ConfigMaps and Secrets · ✅ Probes, requests and limits · ✅ Namespaces, labels and selectors in depth · ✅ Ingress/Gateway and how traffic enters a cluster · ✅ Persistent volumes (advanced) · ✅ RBAC and network policies (advanced).
- **Simulation — the reconciliation loop:** model nodes, a Deployment, ReplicaSets and Pods with states (Pending, Running, Ready, Failed); actions: kill a Pod, drain a node, scale, update image (good or broken), change maxSurge/maxUnavailable. Animate the controller "noticing" and acting. **Challenges:** "keep at least 4 Pods available during an update", "recover from a broken image". **Invariants:** available Pods never drop below `replicas − maxUnavailable` during a rolling update.
- **Labs:** deploy a three-tier app on kind (executed in CI); break a Deployment and debug with `kubectl describe` and events (executed); add probes and observe behaviour (executed).
- **Real world:** Kubernetes grew out of Google's experience running containers with Borg; Google published the Borg paper ("Large-scale cluster management at Google with Borg", EuroSys 2015) and donated Kubernetes to the CNCF. Sources: the paper, kubernetes.io history, CNCF case studies.
- **Alternatives:** HashiCorp Nomad, Docker Swarm, managed container services (Amazon ECS, Google Cloud Run, Azure Container Apps); for small apps, Docker Compose on one server.
- **Verification:** executed in CI with kind (pinned node image digest).

### 5.4 PostgreSQL

- **Lessons:** ✅ Tables, rows and constraints · ✅ Relationships, joins and grouping · ✅ Indexes and `EXPLAIN ANALYZE` · Transactions and ACID · Isolation levels and concurrency anomalies (advanced) · Roles, privileges and SQL injection prevention · Backups, restores and migrations · Replication and connection pooling (advanced).
- ✅ **Simulation — query planner and index:** a table of N rows; toggle an index; the model shows sequential scan versus index scan with rows touched and estimated cost; animate the B-tree descent. Second simulation: two concurrent transactions on a timeline at different isolation levels, showing which anomalies appear. **Challenge:** choose an index that makes a given query touch fewer than 1% of rows.
- **Labs:** design a college schema (executed); compare plans before and after indexing (executed, with wildcards for timings); demonstrate a rollback and an isolation anomaly (executed with two `psql` sessions scripted).
- **Real world:** PostgreSQL descends from the POSTGRES project at the University of California, Berkeley, led by Michael Stonebraker in the 1980s. Sources: postgresql.org history page; company engineering blogs describing PostgreSQL at scale.
- **Alternatives:** MySQL/MariaDB, SQLite (embedded; DevForge itself uses it — a good teaching comparison), managed services (Amazon RDS/Aurora, Cloud SQL, Azure Database), distributed SQL (CockroachDB, YugabyteDB).
- **Verification:** executed in CI against the PostgreSQL service.

### 5.5 Terraform

- **Lessons:** ✅ First configuration · ✅ Variables, validation, outputs and state · ✅ Modules and reuse (with safe refactoring) · ✅ Remote state, locking and workspaces · ✅ Importing existing resources and handling drift · ✅ Testing with `terraform test` and policy checks (advanced) · ✅ Terraform in CI with plan review (advanced).
- ✅ **Simulation — plan diff:** desired configuration, recorded state and the real world as three panels; edit any panel and see the plan symbols (`+`, `~`, `-/+`, `-`) recomputed; show drift when the real world changes. **Challenge:** produce a plan with zero destroys while renaming a resource (teaches `moved` blocks).
- **Labs:** reusable module with the local provider (executed); drift detection by editing a managed file (executed); CI pipeline that posts a plan (read-through plus a workflow validated by the checker).
- **Real world:** Terraform was released by HashiCorp in 2014; it has been under the Business Source License since 1.6, and the OpenTofu fork (Linux Foundation) began from 1.5 in 2023. Sources: HashiCorp's blog and releases, opentofu.org.
- **Alternatives:** OpenTofu, Pulumi, AWS CloudFormation and CDK, Azure Bicep, Crossplane.
- **Verification:** executed in CI with pinned Terraform and the `hashicorp/local` provider.

### 5.6 GitHub Actions

- **Lessons:** ✅ First workflow · ✅ Pull requests, required checks and safe workflows · ✅ Caching and artifacts · ✅ Building and pushing container images · ✅ Reusable workflows and composite actions · ✅ Environments, approvals and deployments · ✅ OIDC for cloud access without long-lived secrets (advanced) · ✅ Supply-chain hardening: pinning SHAs, Dependabot, provenance (advanced).
- ✅ **Simulation — workflow run visualiser:** model jobs with `needs`, matrices and steps; run the DAG with simulated durations and failures; show parallelism and how a failing step stops a job. **Challenge:** reduce total run time by parallelising independent jobs.
- **Labs:** add caching and measure the difference (read-through with real logs from this repository's CI); write a matrix workflow (validated by the checker).
- **Real world:** GitHub Actions became generally available in 2019. Sources: GitHub's changelog and blog; DevForge's own `ci.yml` is a documented case study.
- **Alternatives:** GitLab CI, CircleCI, Jenkins, Buildkite, Azure Pipelines.
- **Verification:** local commands executed; workflows validated by `scripts/lib/workflow-check.ts`.

### 5.7 Prometheus and Grafana

- **Lessons:** ✅ Metrics, labels and the /metrics endpoint · ✅ Running Prometheus — scraping and your first PromQL (`rate`, `sum by`, `histogram_quantile`) · ✅ Grafana — a data source and a dashboard from files · ✅ Counters, gauges and histograms done right · ✅ Grafana dashboards and variables · ✅ Alerting rules and Alertmanager · ✅ SLIs, SLOs and error budgets (advanced) · ✅ Cardinality and long-term storage (advanced). *Decision (2026-11-25): the beginner lessons run the official Prometheus and Grafana binaries, not containers, because DevForge listens on 127.0.0.1, which containers on Docker's default network cannot reach.*
- ✅ **Simulation — scrape and rate:** a counter increasing over time, scraped every N seconds; show raw samples, `rate()` over a window, the effect of a counter reset, and why `rate` belongs before `sum`. **Challenge:** write the query for the 95th-percentile latency from histogram buckets.
- **Labs:** run Prometheus in Docker scraping DevForge (executed in CI: query the HTTP API with `curl` and compare JSON with wildcards); build a dashboard from provisioning files (executed: Grafana's HTTP API confirms the dashboard exists).
- **Real world:** Prometheus was created at SoundCloud starting in 2012 and became the second project to join the CNCF after Kubernetes (2016). Grafana was created by Torkel Ödegaard in 2014. Sources: prometheus.io history, CNCF announcements, Grafana Labs blog.
- **Alternatives:** VictoriaMetrics, Thanos/Cortex/Mimir (long-term storage), InfluxDB, hosted services such as Datadog or New Relic.
- **Verification:** executed in CI with Prometheus and Grafana containers (gated like Docker).

### 5.8 LangChain and LlamaIndex

- **Lessons:** ✅ Prompts, models and output parsers (what an LLM application is; structured output) · ✅ Embeddings and similarity, with small vectors · ✅ Chunking, retrieval and the prompt a RAG system builds · Building a RAG pipeline with citations in depth · Tool calling and agents, safely · Evaluation and hallucination checks (advanced) · Prompt injection and data permissions (advanced).
- ✅ **Simulation — RAG pipeline, end to end:** use small, deterministic, hand-made embedding vectors (clearly labelled as a teaching model) so learners can see chunking, vector similarity, top-k retrieval and prompt assembly without any API key. Show how chunk size changes what is retrieved. **Challenge:** choose a chunk size and k so the answer's supporting passage is retrieved.
- **Labs:** run a retrieval pipeline over the course's own Markdown with a **local** embedding model or a deterministic fake for CI; real model calls only in an optional section that needs the learner's own key, never in CI.
- **Real world:** LangChain was launched in October 2022 by Harrison Chase; LlamaIndex began as GPT Index by Jerry Liu in 2022. Sources: their official blogs and documentation; company case studies on their websites (verify each).
- **Alternatives:** Haystack, Semantic Kernel, DSPy, direct use of model SDKs; vector stores: pgvector, Qdrant, Weaviate, Chroma.
- **Verification:** executed with deterministic fakes in CI; anything needing a paid API is `docs-checked` and clearly marked.

### 5.9 Redis

- **Lessons:** ✅ Keys, values and data structures · ✅ Caching and rate limiting · ✅ Eviction policies and memory · Pub/Sub versus Streams · Transactions and Lua scripts · Persistence (RDB/AOF) and replication (advanced) · Cache stampede and other failure modes (advanced).
- ✅ **Simulation — cache under load:** requests arrive over time; toggle cache-aside, TTL length and eviction policy; show hit ratio, database load and what happens when a hot key expires (stampede). **Challenge:** keep database load under a limit during a traffic spike.
- **Labs:** LRU eviction with a small `maxmemory` (executed in CI); a stream consumer group (executed).
- **Real world:** Redis was created by Salvatore Sanfilippo in 2009. Its licence changed in 2024 and Valkey was forked under the Linux Foundation. Sources: redis.io, valkey.io, company engineering blogs.
- **Alternatives:** Valkey, Memcached, KeyDB, Dragonfly; managed services such as Amazon ElastiCache.
- **Verification:** executed in CI against the Redis service.

### 5.10 Apache Kafka

- **Lessons:** ✅ Events, topics and partitions · ✅ Consumer groups, offsets and lag · ✅ Scaling consumers and rebalancing · ✅ Producers, acknowledgements and retries · ✅ Offsets, retention and replay in depth · ✅ Replication and fault tolerance · ✅ Delivery guarantees and idempotent producers · ✅ Schemas and evolution (advanced) · ✅ Outbox pattern and event-driven design (advanced).
- ✅ **Simulation — partitions and consumer groups:** a topic with N partitions; producers append keyed messages (same key → same partition); consumers in a group are assigned partitions; kill a consumer and watch rebalancing; show offsets and lag per partition. **Challenges:** "make lag reach zero", "explain why adding a fifth consumer to four partitions does nothing". **Invariants:** each partition is assigned to at most one consumer in a group; ordering holds within a partition.
- **Labs:** run Kafka in KRaft mode in a container (executed in CI with the official image, pinned); produce and consume with the CLI tools; replay from an earlier offset.
- **Real world:** Kafka was created at LinkedIn and open-sourced in 2011, later becoming an Apache top-level project. Sources: the Apache Kafka website, LinkedIn's engineering blog, the original Kafka paper.
- **Alternatives:** Redpanda, Apache Pulsar, RabbitMQ (queues), NATS JetStream, cloud services (Amazon Kinesis, Google Pub/Sub).
- **Verification:** executed in CI (gated, generous time limit).

### 5.11 Jenkins

- **Lessons:** ✅ Jenkins in Docker · ✅ Pipeline as code with a Jenkinsfile · ✅ Agents and running builds in containers · ✅ Parallel stages, artefacts and test reports · ✅ Shared libraries · ✅ Configuration as Code (JCasC) and plugin management (taught as lesson 4, because the later lessons build on it) · ✅ Securing Jenkins (advanced).
- ✅ **Simulation — controller, queue and executors:** jobs enter a queue, agents with labels and executors pick them up; show waiting time when executors are scarce. **Challenge:** cut queue time by adding an agent with the right label.
- **Labs:** a Jenkins built from a pinned image with plugins installed by `jenkins-plugin-cli` and a job created by JCasC, then a pipeline run triggered and checked through the REST API (executed in CI).
- **Real world:** Jenkins was forked from Hudson in 2011; Hudson was started by Kohsuke Kawaguchi at Sun Microsystems. Sources: jenkins.io history and blog.
- **Alternatives:** GitHub Actions, GitLab CI, TeamCity, Buildkite, Tekton.
- **Verification:** executed in CI (real Jenkins); Jenkinsfiles checked by `scripts/lib/jenkinsfile-check.ts`.

### 5.12 Jira

- **Lessons:** ✅ Work items, types and workflows (including writing good stories and acceptance criteria) · ✅ Sprints, boards and work-in-progress limits · ✅ Linking work items to branches and commits · Kanban and flow metrics in depth · Reports, cycle time and anti-patterns (advanced).
- ✅ **Simulation — sprint board:** a backlog of stories with estimates; plan a sprint against capacity; play the sprint day by day with random blockers (seeded) and watch the burndown and cumulative flow. **Challenge:** finish the sprint goal by limiting work in progress.
- **Labs:** read-through and simulation labs; a real Jira site is optional (free plans exist — check current terms) and must never be required.
- **Real world:** Jira was first released by Atlassian in 2002. Sources: Atlassian's website and blog.
- **Alternatives:** GitHub Projects, GitLab issues and boards, Linear, YouTrack, Azure Boards, Trello.
- **Verification:** simulation and read-through only; UI steps `docs-checked`, dated, because Atlassian changes the interface often.

### 5.13 Postman

- **Lessons:** ✅ HTTP requests and responses · ✅ Sessions, chained requests and API tests · ✅ Environments and variables in depth (collections and Newman) · Authentication flows (API keys, bearer tokens, OAuth concepts) · Mock servers and API documentation · Running collections in CI with the Postman CLI or Newman (advanced) · Contract testing concepts (advanced).
- ✅ **Simulation — request builder against DevForge:** this one can be *real*: a built-in request playground that sends requests to the learner's own DevForge API (same origin, CSRF header handled) and shows status, headers and body, plus a "what went wrong" explainer for 4xx codes. Label it as a playground, rate-limit it, and allow only DevForge's own endpoints.
- **Labs:** export a collection and run it with Newman in CI (executed, pinned Newman version, against the practice server).
- **Real world:** Postman began in 2012 as a Chrome extension created by Abhinav Asthana. Sources: Postman's website and blog.
- **Alternatives:** Insomnia, Bruno, Hoppscotch, HTTPie, curl.
- **Verification:** HTTP steps executed against the practice server; Postman UI `docs-checked`.

### 5.14 Nginx

- **Lessons:** ✅ Configuration and static files · ✅ Reverse proxy, 502 errors and load balancing · ✅ Location matching rules in depth · Caching and compression · TLS termination with a local certificate · Rate limiting and access control · Upstream health and failure handling (advanced).
- ✅ **Simulation — location matcher:** type a request path; the model applies Nginx's location-matching order (exact `=`, longest prefix, `^~`, regular expressions in order) and highlights the winning block with the reason. **Challenge:** write locations so `/api/v1/` goes to the API but `/api/docs` is served statically. Unit-test the model against real Nginx in CI by generating configurations and comparing which block answers.
- **Labs:** TLS with a self-signed certificate (executed); `limit_req` returning 503s under load (executed with a burst of curl requests).
- **Real world:** Nginx was written by Igor Sysoev and first released publicly in 2004. Sources: nginx.org, F5/NGINX blog, company engineering blogs.
- **Alternatives:** HAProxy, Caddy, Envoy, Traefik, Apache HTTP Server; cloud load balancers.
- **Verification:** executed (Nginx runs unprivileged locally and in CI).

### 5.15 OpenTelemetry

- **Lessons:** ✅ Traces, spans and context · ✅ Instrumenting a Node.js service · ✅ The Collector pipeline and Jaeger · ✅ Propagating context across services and queues · ✅ Metrics and logs with OpenTelemetry · ✅ Sampling and cost (advanced) · ✅ Correlating traces, metrics and logs (advanced).
- ✅ **Simulation — trace waterfall:** a request travels through gateway → API → database → cache; the model generates spans with parent IDs; the view draws the waterfall and lets learners inject latency in one service and find it. **Challenge:** find the slow span and explain the critical path.
- **Labs:** instrument DevForge itself (the blueprint's Phase 6 item) and send traces to a Collector and Jaeger in containers (executed in CI by querying Jaeger's API for the expected service and span names).
- **Real world:** OpenTelemetry was formed in 2019 by merging OpenTracing and OpenCensus and is a CNCF project. Sources: opentelemetry.io, CNCF.
- **Alternatives:** vendor agents (Datadog, New Relic, Dynatrace), Zipkin and Jaeger client libraries (historical), eBPF-based auto-instrumentation tools.
- **Verification:** executed in CI with containers.

### 5.16 Apache Airflow

- **Lessons:** ✅ DAGs, tasks and runs · ✅ Schedules, logical dates and catchup · ✅ Retries, failures and safe re-runs · ✅ Timeouts and failure callbacks · ✅ Passing data between tasks (and why XCom is for small values) · ✅ Building an idempotent ETL · ✅ Backfills and data-quality checks (advanced) · ✅ Deployment and executors (advanced).
- ✅ **Simulation — scheduler timeline:** a DAG with schedule and start date; move "now" forward and see which runs are created, how catchup behaves, and what happens when a task fails and retries. **Challenge:** backfill a week without duplicating data (idempotency).
- **Labs:** `airflow standalone` in a pinned container; trigger a DAG and check task states through the REST API (executed in CI, generous time limit).
- **Real world:** Airflow was created at Airbnb in 2014 and became an Apache top-level project. Sources: airflow.apache.org, Airbnb's engineering blog.
- **Alternatives:** Dagster, Prefect, Argo Workflows, Luigi, cloud schedulers (AWS Step Functions, Google Cloud Composer — itself managed Airflow).
- **Verification:** executed in CI with containers.

### 5.17 n8n

- **Lessons:** ✅ Workflows, nodes and items · ✅ Webhooks and expressions · ✅ Validating input and handling errors (retries, error outputs, error workflows) · Calling APIs and data mapping in depth · Human approval steps · Self-hosting securely (advanced) · AI agents in workflows and their risks (advanced).
- ✅ **Simulation — workflow executor:** nodes connected on a canvas; run items through them and show the data each node receives and outputs; add an error branch. **Challenge:** route invalid form submissions to an error workflow.
- **Labs:** n8n in a pinned container; import a workflow from JSON and run it through the webhook against DevForge's practice API (executed in CI).
- **Real world:** n8n was founded in 2019 by Jan Oberhauser and is distributed under a "fair-code" Sustainable Use License. Sources: n8n.io, docs.n8n.io.
- **Alternatives:** Zapier, Make, Node-RED, Apache Airflow (for data pipelines), custom code.
- **Verification:** executed in CI with containers.

### 5.18 MLflow

- **Lessons:** ✅ Experiments, runs, parameters and metrics · ✅ Comparing and searching runs · ✅ Models, signatures and the registry · The tracking server and backend store in depth · Reproducible pipelines with Airflow (advanced) · Serving and monitoring concepts (advanced).
- ✅ **Simulation — experiment explorer:** a seeded set of runs with hyperparameters and metrics; sort, filter and plot; promote a model version by moving an alias. **Challenge:** pick the best run under a latency constraint and explain the trade-off.
- **Labs:** track a scikit-learn experiment on synthetic data with a pinned MLflow in a container, then query runs through the MLflow REST API (executed in CI).
- **Real world:** MLflow was introduced by Databricks in 2018. Sources: mlflow.org, Databricks blog.
- **Alternatives:** Weights & Biases, Neptune, Kubeflow, DVC, cloud ML platforms.
- **Verification:** executed in CI with containers; deterministic seeds for metrics.

## 6. Platform features still to build

### 6.1 Track pages that are complete

The track page sections **Lessons, Labs, Projects and Official resources** must all lead somewhere real:

- **Lessons:** all lessons for the track, grouped by level, with completion ticks from the progress API.
- **Simulations (new section):** cards for the track's simulations, each opening the simulation page.
- **Labs:** each lab links to its lab page with mode, time, prerequisites and completion state. Labs not yet written show "Planned" and **no link** (never a dead page).
- **Projects:** each mini-project links to its project page with brief, rubric and starter instructions.
- **Who uses this and why (new):** sourced statements from case studies (4.6).
- **Alternatives (new):** the comparison table (4.6).
- **Official resources:** show "Verified on <date>" for checked links; run the *Link check* workflow monthly and update `verification` after a person confirms each page is still the right resource.

Add browser tests that walk every section of at least one complete track and assert there are no dead links (every internal link returns a real page).

### 6.2 Learning experience improvements

- **Glossary tooltips:** terms in lessons link to glossary entries (accessible popovers, keyboard-operable).
- **Notes per lesson:** the blueprint's notes feature (table `notes`, private to the learner).
- **Recommendations:** "next best lesson" from the learner's progress and chosen learning path.
- **Per-lesson cheat sheet:** a printable summary of commands and key ideas, generated from tagged blocks in the lesson.
- ✅ **Code splitting:** load simulations and heavy diagrams on demand (esbuild `splitting: true` with ESM output and dynamic `import()` in `scripts/build-web.ts`) so the initial JavaScript stays near today's ~255 KB. *Done 2026-11-25: simulations are separate chunks; keep simulation models free of runtime dependencies (zod lives in each model's `schema.ts`).*
- **Optional translations:** Hindi (and other languages) later, through a content-translation layer with the same validation rules; the UI text first, then lessons.

### 6.3 Institutional features (blueprint Phase 5)

- Admin screens for users, roles and the audit log (the API exists: `/api/admin/*`).
- Faculty screens for aggregated progress (`/api/faculty/overview` exists), cohorts, assignments with due dates, and project review against rubrics.
- Portfolio: opt-in public page showing completed projects and capstones.
- Certificates: issued only for assessment thresholds (quizzes plus verified labs), with a verification URL.
- Content editing for faculty without Git: a CMS that **opens pull requests** to the repository, so review and validation still apply (ADR 0003).

### 6.4 Engineering items (blueprint Phase 6)

- OpenTelemetry tracing for DevForge itself (doubles as the OpenTelemetry track's lab).
- Shared rate limits in Redis when running more than one instance (ADR 0004).
- PostgreSQL adapter if the deployment requires it (ADR 0002).
- Test `deploy/docker-compose.yml` and the production Nginx configuration in CI (build the image, start Compose, run a smoke test through Nginx).
- Accessibility audit with `@axe-core/playwright` in the browser tests, and a manual screen-reader pass.
- Load test of the API (for example with k6) before institution-wide use.

## 7. Milestones and order of work

Each milestone ends with CI green and `IMPLEMENTATION_STATUS.md` updated.

1. ✅ Done (verified in CI on 2026-11-25). **Close open verification.** Push the latest patch; fix any mismatch in the five pending lessons from the CI log; promote them to `executed`. Run the *Link check* workflow and verify links. *Done when:* no `pending` lessons; every resource is verified or flagged.
2. ✅ Done (verified in CI on 2026-11-25, run 45650635699). **Visual learning system.** Media pipeline (`media:` paths, figures, captions, dark/light SVGs), `StepDiagram`, animation guidelines; convert the ASCII diagrams in the existing 21 lessons into SVG figures, and add a step-through to at least one lesson per track. *Done when:* every existing lesson has at least one real figure, and browser tests cover a step-through with keyboard and reduced motion.
3. ✅ Done (verified in CI on 2026-11-25, run 45655582859). **Simulation framework plus two exemplars.** `SimulationShell`, the model/view split, challenges and progress; build the Git commit-graph and the Kubernetes reconciliation simulations first. *Done when:* both have unit-tested models with invariants, browser tests, and are embedded in their lessons.
4. ✅ Done (verified in CI on 2026-11-25, run 45675259630). **Complete Path 2.** Prometheus + Grafana and OpenTelemetry beginner lessons (executed in CI) and their simulations.
5. **Remaining tracks, beginner level.** Kafka, Airflow, MLflow, LangChain + LlamaIndex, n8n, Jira: lessons, setup guide, one simulation each. *Done when:* all 18 tracks have at least three beginner lessons and one simulation. Status (2026-11-26): done — every track has at least three beginner lessons and a simulation.
6. ✅ Done (2026-11-26). **Real-world context.** Case-study and alternatives content types; at least two sourced case studies and an alternatives table per track. Status: 36 case studies and 89 alternatives, every quote checked against its source page; see IMPLEMENTATION_STATUS.md.
7. ✅ Done (2026-11-26). **Labs.** Lab pages, verification scripts, lab progress; at least two labs per track, executed in CI where the tool allows. Status: 36 labs (18 local with check scripts, 17 simulation, 1 read-through); 19 executed in CI; see IMPLEMENTATION_STATUS.md.
8. **Intermediate and advanced lessons.** Following section 5, track by track, Path 1 first. Status (2026-11-26): in progress — Path 1 done (Git and PostgreSQL 8 lessons each; Postman, Redis, Nginx and Docker 7 each) Terraform (7), Kubernetes (8), GitHub Actions (8), Jenkins (7) and Prometheus + Grafana (8); 49 new executed lessons; the other 7 tracks next.
9. **Quizzes and projects.** New question types, per-track quizzes, mini-project pages with rubrics and starter templates.
10. **Capstones A–G and integration lessons.** Including the architecture studio and the full relationship graph.
11. **Institutional features and hardening.** Section 6.3 and 6.4.

## 8. How to verify every change

Run before every commit:

```bash
npm run verify      # typecheck (server + web), docs lint, build, unit/API/lesson tests, browser tests
```

For lessons and labs:

```bash
npm run lessons:record -- <lesson-id>   # capture real output (needs the tool; see docs/content-authoring.md)
git diff                                 # review every recorded change before committing
```

Then push and read the CI result: lessons that need PostgreSQL, Redis, Docker, Nginx, Jenkins, Terraform or Kubernetes only run there. A lesson moves from `pending` to `executed` only after CI has run it successfully.

For visual work, look at the screenshots the browser tests write to `build/screenshots/` (also uploaded by CI when a run fails), in both themes and on the mobile viewport, before calling it done.

For facts: every new external claim has a source URL and a `checked_on` date; run `npm run content:check-links` (or the *Link check* workflow) after adding sources.

## 9. Open issues and risks

| Issue | What to do |
|---|---|
| ~~Five lessons pending their first CI run (Jenkins 1, Terraform 1–2, Kubernetes 1–2)~~ | ✅ Done: all five matched on their first CI run (45643638519, 2026-11-25) and are `executed` |
| ~~Assumed download names in CI (kind `.sha256sum` asset, Jenkins image tag `2.580.2-lts-jdk21`)~~ | ✅ Both exist: the kind checksum verified and the Jenkins image was pulled in CI run 45643638519 |
| No licence chosen | Owner decision before the repository is public (for example MIT for code, CC BY-SA 4.0 for content) |
| katex override for the docs linter | Only on the owner's machine if applied; add `overrides.katex` to `package.json` here if `npm audit` was clean with it |
| Docker Compose and production Nginx untested | Milestone 11 (section 6.4) |
| CI duration grows with real Jenkins and Kubernetes runs | Move slow lesson tests to a separate job triggered on content changes and nightly, if needed |
| Docker Hub anonymous pull limits | Add a Docker Hub login step with a read-only token if pulls fail |
| Tool versions change monthly | Review pinned versions monthly from official release pages; update lessons with `lessons:record`; bump `content_version` and `last_reviewed` |
| Content ages | Add a CI warning for lessons whose `last_reviewed` is older than 12 months |
