---
id: github-actions-caching-and-artifacts
title: Caching and artifacts
track: github-actions
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [github-actions-pull-requests-and-safety]
learning_objectives:
  - Cache dependencies between workflow runs with a key that changes only when the dependencies change.
  - Pass a build's output from one job to another with artifacts.
  - Explain what caches and artifacts are each for, and why neither should hold secrets.
resources:
  - title: Dependency caching reference
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: Cache keys, restore keys, cache hits, eviction and security notes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Store and share data with workflow artifacts
    url: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: Uploading and downloading artifacts between jobs, and retention.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: key
    prompt: Why build the cache key from a hash of package-lock.json?
    options:
      - { id: a, text: "So the key changes on every run" }
      - { id: b, text: "So the key — and therefore the cache — changes exactly when the locked dependencies change, and stays the same otherwise" }
      - { id: c, text: "GitHub requires it" }
    answer: b
    explanation: An exact key match is a cache hit. A key tied to the lockfile is reused across runs until the dependencies change; then a new cache is created with a new key — existing caches cannot be changed.
  - id: artifact-or-cache
    prompt: The build job produces dist/ and the test job needs it. Cache or artifact?
    options:
      - { id: a, text: "Cache — it is faster" }
      - { id: b, text: "Artifact — artifacts share a run's data between its jobs (and keep it after the run); caches speed up later runs by reusing things such as downloaded dependencies" }
      - { id: c, text: "Neither — jobs share a disk" }
    answer: b
    explanation: Each job starts on a fresh runner, so files do not carry over. GitHub's documentation describes artifacts as the way to share data between jobs in a workflow.
  - id: secrets
    prompt: Is it fine to cache a folder that contains a deploy token?
    options:
      - { id: a, text: "Yes, caches are private" }
      - { id: b, text: "No — GitHub's documentation says not to store sensitive information in a cache; anyone who can open a pull request can read the base branch's caches" }
      - { id: c, text: "Only on Mondays" }
    answer: b
    explanation: Cache contents are not signed and can be read by other workflow runs; keep tokens in secrets, never in cached paths or artifacts.
verification:
  method: executed
  details: The local commands — writing the project and workflow, building, and computing a stand-in for the cache key — run in the test suite and their output is compared with this lesson; the workflow is validated by DevForge's workflow checker. How caching and artifacts behave on GitHub was checked against GitHub Docs and the actions' releases (2026-11-26), but is not run, because it needs github.com.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Every job starts on a fresh, empty runner, so two tools carry files across: a **cache** keeps things such as downloaded dependencies **between runs**, under a **key** you choose, and an **artifact** passes a run's output — a build — **between the jobs of that run** and keeps it for download afterwards.

## Explain it like I'm twelve

A cooking class meets every week in an empty kitchen. Fetching the same spices from the shop each week wastes time, so the class keeps a labelled spice box in a locker — the label says exactly which spice list it matches, and when the list changes, they pack a new box. That box is a **cache**.

During one lesson, the baking group passes its finished cake to the decorating group at the next table. That cake is an **artifact**.

Where the analogy breaks: a cache box can never be repacked — a changed list always gets a new box with a new label.

## What problem it solves

Without caching, every run downloads every dependency again — minutes of waiting on each push. Without artifacts, a test or deploy job cannot use the exact files the build job made, and nobody can download what CI built. Caches make runs faster; artifacts connect jobs and keep their results.

## How it works

![](media:github-actions/cache-artifact.svg)

- `actions/cache` restores a cache whose `key` matches exactly — a **cache hit** — and saves a new one at the end of the job if there was none. If no key matches, it tries `restore-keys` as prefixes and uses the most recent match.
- The key usually includes `hashFiles('package-lock.json')`, a hash of the lockfile: same dependencies, same key; changed dependencies, new key. Existing caches cannot be changed.
- GitHub removes caches not used for 7 days, and by default keeps at most 10 GB per repository.
- `actions/upload-artifact` stores files from a job; `actions/download-artifact` fetches them in a later job, which says it `needs` the first. By default, artifacts are kept 90 days.

## Try it yourself

> **Local lab** — needs Node.js and the tools from the previous lessons. You write the project and the workflow, build locally to see what the artifact will contain, and compute a stand-in for the cache key. Every command is run automatically in DevForge's tests; running the workflow itself needs a GitHub repository (optional).

### 1. A small project with a lockfile

```bash run
mkdir -p course-site && cd course-site
cat > package.json <<'EOF'
{
  "name": "course-site",
  "version": "1.0.0",
  "private": true,
  "scripts": { "build": "node build.js" }
}
EOF
cat > package-lock.json <<'EOF'
{
  "name": "course-site",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "course-site", "version": "1.0.0" }
  }
}
EOF
cat > build.js <<'EOF'
const fs = require("fs");
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", "<h1>DevForge course site</h1>\n");
console.log("built dist/index.html");
EOF
node build.js
ls dist
```

```text output
built dist/index.html
index.html
```

`package-lock.json` records the exact dependency versions (here: none yet, to keep the lab offline). `dist/` is what the build job will hand to the next job.

### 2. The workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/build.yml <<'EOF'
name: Build and test

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Cache npm downloads
        uses: actions/cache@v6
        with:
          path: ~/.npm
          key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            npm-${{ runner.os }}-
      - run: npm ci
      - run: npm run build
      - name: Keep the build for the next job
        uses: actions/upload-artifact@v7
        with:
          name: site
          path: dist/

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Get the build from the first job
        uses: actions/download-artifact@v8
        with:
          name: site
          path: dist/
      - run: grep -q "course site" dist/index.html
EOF
grep -c "uses:" .github/workflows/build.yml
```

```text output
5
```

- **build**: checks out the code, installs Node 22, restores the npm download cache (key from the lockfile's hash), installs, builds, and uploads `dist/` as the artifact `site`.
- **test** `needs: build`, so it waits — jobs otherwise run in parallel — and starts on a fresh runner, which is why it downloads the artifact before checking it.
- Every action is pinned to its current major version, and `permissions` limits the token, as in the previous lessons. DevForge's workflow checker validates this file.

### 3. When does the cache key change?

GitHub's `hashFiles` combines SHA-256 hashes of the matched files. Locally, a SHA-256 of the lockfile is a fair stand-in to see when the key changes:

```bash run
key() { echo "npm-Linux-$(sha256sum package-lock.json | cut -c1-12)"; }
key
sed -i 's/"private": true/"private": true,\n  "description": "Course site"/' package.json
key
sed -i 's/"packages": {/"packages": {\n    "node_modules\/course-utils": { "version": "1.0.0" },/' package-lock.json
key
```

```text output
npm-Linux-81a23ba9281a
npm-Linux-81a23ba9281a
npm-Linux-ea7d26c61d79
```

- Editing `package.json`'s description does not touch the lockfile: same key, so the next run gets a **cache hit**.
- Locking a new dependency (an imaginary `course-utils`, never installed here) changes the lockfile: a new key, so the run misses, falls back to the `restore-keys` prefix (the most recent `npm-Linux-` cache), and saves a fresh cache under the new key at the end.

### 4. Run it on GitHub (optional)

Push this folder to a GitHub repository. The first run saves a cache; the second shows "Cache restored" in the cache step, and the run's summary page lists the artifact **site**, which you can download. This step needs github.com and is not part of the automatic tests.

## Try it in the simulation

Jobs run in parallel unless one needs another. Remove the dependencies that are not real, use a matrix, and watch the run time. It is a labelled teaching model with fixed durations, not GitHub Actions itself.

```simulation github-actions-workflow-run scenario=chained
```

## Common mistakes

- **A cache key that never changes** (for example just `npm`). The first cache is reused forever, even after dependencies change; tie the key to the lockfile.
- **Caching `node_modules` across different operating systems or Node versions.** Cache the package manager's download folder, and include the OS in the key.
- **Using a cache to pass build output between jobs.** Caches are best-effort and keyed for reuse; artifacts are made for a run's outputs.
- **Secrets in cached paths or artifacts.** Anyone who can open a pull request can read the base branch's caches; keep tokens in secrets.
- **Huge artifacts kept for months.** Upload only what is needed, and set `retention-days` when the default is longer than you need.

## Where this fits in a real system

The `site` artifact is what a deploy job — or **Jenkins**, or a **Docker** image build — would ship. The same caching idea appears in Docker's layer cache, and the time saved shows up in the run durations you can track over time.
