# Content authoring guide

Content is the product. A beautiful page with a wrong command teaches the wrong thing. This guide defines the bar every track, lesson and resource must meet before it is merged.

## Accuracy rules (non-negotiable)

1. **Never invent** commands, flags, outputs, version numbers, resources, video titles, durations or company deployments.
2. **Verify against current official documentation** and record the review date (`last_reviewed`). If something is version-sensitive, say which version you checked.
3. **Mark uncertainty** instead of guessing. If you are not sure, leave it out or open an issue.
4. **Company claims** (case studies) need a reliable public source supporting that exact claim. Separate *confirmed* facts from *inferred* or *illustrative* architecture, and label student designs "inspired reference architecture".
5. **Videos** may be added only after a person has watched them and confirmed the title, creator, duration, captions and URL. Always provide a text alternative.
6. **Simulations** must be labelled as simulations.
7. **Safety:** commands must be safe on a student laptop; warn before anything destructive and explain how to undo it. Never ask learners to paste real credentials.

## Link verification

Every resource has `verification: { status: unverified | verified | broken, checked_on }`. The weekly *Link check* workflow reports reachability; a person then confirms the page is the right, current resource and sets `status: verified` with `checked_on`. The build rejects `verified` without a date. The UI shows "Link not yet verified" until then.

## Executable lessons

When the tool can run in CI (Git today; more tools as CI services are added), make the lesson **executable**:

- Write runnable commands in a ```` ```bash run ```` fence, and the output the learner should see in a ```` ```text output ```` fence directly after it. The site labels output fences "Expected output".
- Set `verification: { method: executed, details: … }` in the front matter. The build rejects `executed` lessons without run blocks, and `docs-checked` lessons that contain them.
- `npm test` runs every run block in order, in one bash session, inside a temporary directory with an isolated `HOME`, `TZ=UTC` and fixed commit dates (so Git commit IDs are reproducible). Executed prerequisite lessons run first, because learners continue from them. Any difference between real and documented output fails the build.
- Wildcards: `…` inside a line matches any text on that line (use it for paths); a line containing only `…` matches any number of lines. Use them sparingly — exact output teaches better.
- For a command that is supposed to fail, write ```` ```bash run fails ````.
- **SQL**: a ```` ```sql run ```` block is sent to `psql` (`-X -v ON_ERROR_STOP=1`) against a throwaway database created for that run and dropped afterwards. Expected output is what a learner sees in an interactive psql session: command tags such as `CREATE TABLE` and `INSERT 0 3`, result tables, and `ERROR:`/`DETAIL:` lines. The one normalisation is removing the `psql:<stdin>:N:` prefix psql adds to errors only when reading a script. SQL tests run when a server is reachable through the standard `PGHOST`/`PGUSER`/`PGPASSWORD` variables; CI provides PostgreSQL 16 as a service.
- **HTTP** (Postman track): lessons use `curl` against `$API`. The test suite starts a real DevForge server with an empty in-memory database in a separate process (it must not share the runner's blocked event loop) and sets `API` to its address. Learners set `API=http://localhost:8080` for their own copy. Use `…` for values that change per request (request IDs, dates, generated IDs). Postman UI steps are not executable: say so in `verification.details`.
- **Redis**: a ```` ```redis run ```` block is piped to `redis-cli --no-raw` (default host and port), which keeps the interactive format learners see (`(integer) 1`, `"value"`, `(nil)`); bash blocks may call `redis-cli` directly (use `--raw` in scripts). Every Redis lesson run starts with `FLUSHDB`, so Redis lessons run **only** with `DEVFORGE_REDIS_TEST=1` against a throwaway server — CI sets it; never set it against a Redis that holds real data. The runner refuses Redis lessons without this opt-in.
- **Nginx**: lessons run Nginx as the current user with a per-lesson prefix (`nginx -p "$PWD" -e error.log -c nginx.conf`), on port 8088, with every temp path set inside the lab folder (Debian/Ubuntu builds otherwise use `/var/lib/nginx`, which an unprivileged user cannot create). The runner's exit trap stops any Nginx a failed lesson left running. Lessons after the first proxy to a practice DevForge server on 127.0.0.1:8080, the address learners use.
- **Docker**: lessons use plain `bash run` blocks calling `docker`. They create and force-remove containers and volumes with fixed names, so they run only with `DEVFORGE_DOCKER_TEST=1` on a disposable Docker engine (CI sets it); the test and record commands refuse otherwise. Pin image tags (`nginx:1.27-alpine`, `alpine:3.20`) so output stays reproducible, and add a short, explained `sleep 1` after starting a server container before requesting from it.
- **GitHub Actions workflows**: show workflows in ```` ```yaml workflow ```` fences, or create them in run blocks with `cat > .github/workflows/<name>.yml <<'EOF'`. Every one is validated by `scripts/lib/workflow-check.ts` (structure, pinned `uses:`, declared `permissions`, no `${{ github.event… }}` inside `run:`). A deliberately bad example uses ```` ```yaml workflow invalid ````; the test then requires it to be flagged for its rules, not for a YAML parse error. Check current action major versions before writing (they move: `actions/checkout` reached v7 in 2026).
- **Jenkinsfiles**: show them in ```` ```groovy jenkinsfile ```` fences or create them in run blocks with `cat > Jenkinsfile <<'EOF'`; every one is checked by `scripts/lib/jenkinsfile-check.ts` (pipeline/agent/stages structure, stages that do something, no hard-coded secrets in `environment`, no credential inside a double-quoted Groovy string). Bad examples use ```` ```groovy jenkinsfile invalid ```` and must be flagged for their rules, not for being malformed. Lessons that run Docker commands are gated by `DEVFORGE_DOCKER_TEST=1`; slow servers such as Jenkins get a longer runner time limit.
- **Terraform**: lessons use the `hashicorp/local` provider (no cloud account), `-no-color`, and `…` for output that varies between versions (timings, provider attribute lists, update notices); summary lines such as `Plan: 1 to add, 0 to change, 0 to destroy.` are checked exactly. CI installs a pinned, checksum-verified Terraform.
- **Kubernetes**: lessons create a kind cluster pinned by node-image digest; the runner deletes any `kind create cluster --name …` cluster in its cleanup trap. Wait with `kubectl wait` / `kubectl rollout status`, never `sleep`; select Pods by label and count them, because names are random. Gated like Docker lessons.
- **Never type expected output by hand when you can record it.** With the tool available, run `npm run lessons:record -- <lesson-id>` (or `--all`): it rewrites output blocks from real runs, keeps blocks that already match (so `…` wildcards survive), and leaves everything else untouched. Review `git diff` before committing.

### Verification methods

| `verification.method` | Meaning | Shown to learners as |
|---|---|---|
| `executed` | Run blocks reproduce their documented output in the test suite | "Tested commands." |
| `pending` | Run blocks exist and run in CI, but the documented output has not yet been confirmed by a real run (for example, it was written from the documentation where the tool was unavailable) | "Automated test pending." |
| `docs-checked` | No run blocks; checked against official documentation only | "Checked against official documentation." |

To promote `pending` to `executed`: run the lesson against a real server (`npm run lessons:record -- <id>`, or let CI pass), review the diff, then change the method. To try SQL lessons locally:

```bash
docker run --name devforge-pg -e POSTGRES_PASSWORD=devforge -p 127.0.0.1:5432:5432 -d postgres:16
PGHOST=localhost PGUSER=postgres PGPASSWORD=devforge npm run lessons:record -- --all
```

## Figures and step-through diagrams

Every "How it works" section needs a picture (REMAINING_WORK.md §4.2). Figures are SVG files that are validated and inlined at build time ([ADR 0007](adr/0007-inline-svg-figures.md)):

```text
content/media/<track>/<name>.svg          the drawing
content/media/<track>/<name>.yaml         alt, caption, credit, licence (project-content, or a licence plus source_url)
content/media/<track>/<name>.steps.yaml   optional: a step-through over one figure in the same folder
```

- **Static figure:** put `![](media:<track>/<name>.svg)` on a line of its own. The alt text and caption come from the sidecar; Markdown alt text and a quoted title override them for one lesson.
- **Step-through:** write an empty fence ```` ```diagram steps=<track>/<name> ````. In the SVG, `data-step="N"` makes an element appear at step N (and highlights it while N is current); `data-until="M"` hides it after step M. Every step after the first must change the picture, and each step's caption is a full sentence, because the captions are also the text alternative ("All steps as text"). A figure that uses `data-until` can only be shown as a step-through.
- **Drawing rules** (the build rejects anything else): `svg`, `g`, `defs`, `marker`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`; no `style` attributes, scripts, links or images; colours only through the classes listed in `docs/design-system.md`; ids only `a-z0-9-`. Draw arrow heads as `polygon` elements inside the same `g` as their line, so they highlight with it.
- **Size:** design at a `viewBox` about 640 units wide with 12–14 px text. Figures never shrink below 30rem; on phones they scroll sideways inside their frame.
- Keep text in the SVG short (labels, not sentences); explanations belong in the caption and the lesson.
- Check the result in both themes and on mobile (`npm run test:e2e` writes screenshots to `build/screenshots/`).

## Lesson structure

File: `content/lessons/<track>/<lesson-id>.md`; the id must equal the file name. Use the exemplar `content/lessons/docker/docker-images-vs-containers.md` as the model. A lesson should include, as `##` sections where they apply:

1. **The idea in one sentence** — precise definition.
2. **Explain it like I'm twelve** — an analogy, plus where the analogy breaks.
3. **What problem it solves**.
4. **How it works** — a figure or step-through (see above) and step-by-step flow; beginner, intermediate and advanced depth.
5. **Try it yourself** — labelled local lab or read-through; exact commands; what each flag does; expected output; Windows/macOS/Linux differences; cleanup.
6. **Common mistakes**.
7. **Where this fits in a real system** — connect to other tracks.

Front matter (validated by `LessonMetaSchema`):

```yaml
id: git-first-commits
title: Your first commits
track: git-github
order: 2                       # unique within the track
level: beginner
estimated_minutes: 25
prerequisites: [git-what-and-why]   # lesson ids
learning_objectives:
  - Create a repository and record three commits with clear messages.
resources: []                  # same shape as track resources
self_check:                    # at least 2; test application, not recall
  - id: staging-purpose
    prompt: You edited two files but only want to commit one. What do you do?
    options:
      - { id: a, text: "…" }
      - { id: b, text: "…" }
    answer: b
    explanation: Explain why b is right and why the tempting wrong answer is wrong.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
```

**Good self-check questions** present a situation ("You rebuilt the image and the container still shows the bug — why?") rather than a definition. The explanation is shown only after a correct answer, so make it teach.

## YAML pitfalls in front matter

A plain (unquoted) YAML value may not contain a colon followed by a space: `explanation: the header reads "Server: nginx"` is parsed as a new key and the build fails. Quote such values with single quotes (`'…'`, doubling any `'` inside). The build reports the file and line.

## Writing style

Plain, active sentences; second person; define a term before using it; one idea per paragraph; sentence-case headings; code in fenced blocks with a language (`bash`, `yaml`, `sql`, `dockerfile`, `python`, `text` for diagrams). Avoid "simply", "just" and "obviously".

## Review checklist

- [ ] `npm run build` passes with no warnings for the file.
- [ ] Every command was run (or checked against official docs) on the stated version.
- [ ] Expected outputs are real, or clearly described as approximate.
- [ ] Destructive steps have warnings and undo instructions.
- [ ] Self-checks test application; explanations teach.
- [ ] Links are official or reputable; verification fields are honest.
- [ ] `last_reviewed` updated; track `content_status` updated if appropriate.
