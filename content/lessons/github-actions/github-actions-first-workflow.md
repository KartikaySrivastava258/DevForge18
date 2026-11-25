---
id: github-actions-first-workflow
title: Your first workflow
track: github-actions
order: 1
level: beginner
estimated_minutes: 35
prerequisites: [git-remotes-push-pull]
learning_objectives:
  - Explain how events, workflows, jobs, steps and runners fit together.
  - Explain how CI decides that a step failed, using exit codes.
  - Write a check script, test it locally, then run it automatically with a workflow.
  - Read a workflow run on GitHub and find the cause of a failure in its logs.
resources:
  - title: GitHub Actions documentation
    url: https://docs.github.com/en/actions
    publisher: GitHub
    type: documentation
    level: all
    official: true
    why: Workflow syntax, events, runners, permissions and security hardening, from GitHub.
    verification: { status: unverified }
  - title: actions/checkout v7.0.0 release
    url: https://github.com/actions/checkout/releases/tag/v7.0.0
    publisher: GitHub
    type: reference
    level: intermediate
    official: true
    why: The release used in this lesson; its notes include a security change for pull_request_target workflows.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: exit-code
    prompt: How does GitHub Actions decide that a "run" step failed?
    options:
      - { id: a, text: "It searches the output for the word FAIL" }
      - { id: b, text: "The command finished with a non-zero exit code" }
      - { id: c, text: "The step took longer than a minute" }
    answer: b
    explanation: Every command ends with an exit code; 0 means success and anything else means failure. A step fails when its script exits non-zero, which is why the check script ends with exit 1 on a problem — printing FAIL alone would not stop the workflow.
  - id: test-locally
    prompt: Why write the check as a script and run it locally before adding it to a workflow?
    options:
      - { id: a, text: "Workflows cannot run commands directly" }
      - { id: b, text: "You can test and debug it in seconds on your own machine, and the workflow stays a thin wrapper that is easy to read and reuse" }
      - { id: c, text: "GitHub charges per line of YAML" }
    answer: b
    explanation: Pushing commits just to debug a workflow is slow and clutters history. Keeping the logic in a script that runs the same way locally and in CI shortens the feedback loop.
  - id: anatomy
    prompt: Which statement about jobs and steps is accurate?
    options:
      - { id: a, text: "Each step runs on a separate machine" }
      - { id: b, text: "A job runs on one runner and its steps run in order on that runner; separate jobs get separate runners and run in parallel unless one needs another" }
      - { id: c, text: "Jobs always run one after another in the order written" }
    answer: b
    explanation: Steps in a job share a machine and its files, so a checkout in step 1 is available in step 2. Jobs are independent by default and run in parallel; needs creates an order between them.
verification:
  method: executed
  details: The local commands — the check script, Git commits, branches and pushes to the practice remote from the Git lessons — run in the test suite and their output is compared with this lesson. Every workflow file shown or created here is validated by DevForge's workflow checker. How the workflows behave on GitHub was checked against GitHub Docs and the actions' release notes (2026-11-25), but is not run, because it needs github.com.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**GitHub Actions** runs **workflows** — YAML files in `.github/workflows` — automatically when something happens in a repository, such as a push or a pull request.

## Explain it like I'm twelve

Imagine a teacher who checks every homework sheet the moment it is handed in: is the name at the top, are all the questions answered? Each sheet gets a tick or a cross straight away, before anyone marks the content. GitHub Actions is that teacher for your repository: every push is checked by the same rules, every time, and gets a green tick or a red cross.

Where the analogy breaks: the teacher's rules are not in their head but written in a file inside the repository, so everyone can read, review and change them.

## What problem it solves

Checks that depend on people remembering to run them get skipped, especially under deadline pressure, and "it works on my machine" hides problems that only appear elsewhere. **Continuous integration (CI)** runs the same checks on a clean machine for every change, and shows the result on the commit and on pull requests, so broken work is caught before it is merged.

## How it works

```text
 event (push, pull_request, schedule …)
   └─▶ workflow  .github/workflows/check.yml
         └─▶ job "check"  ── runs on a fresh runner (ubuntu-latest)
               ├─ step 1: uses: actions/checkout@v7      (a reusable action)
               └─ step 2: run: bash scripts/check-notes.sh (a shell command)
                     exit code 0 → ✓ success     non-zero → ✗ failure
```

- An **event** starts a workflow.
- A **job** is a set of steps that runs on one **runner** — a fresh virtual machine provided by GitHub (or your own server).
- A **step** either **uses** an action (a packaged, reusable step, pinned to a version) or **runs** shell commands.
- A step fails when its command exits with a **non-zero exit code**, and then the job fails.

## Try it yourself

> **Local lab, then GitHub** — continue in the `student-notes` repository from the Git lessons (on Windows, Git Bash). The local steps are run automatically in DevForge's tests; seeing the workflow run requires pushing to a repository on GitHub, as described at the end.

### 1. Write the check as a script

```bash run
mkdir -p scripts
cat > scripts/check-notes.sh <<'EOF'
#!/usr/bin/env bash
# Exits with code 1 unless README.md exists and starts with a "# " title.
set -euo pipefail
if [ ! -f README.md ]; then
  echo "FAIL: README.md is missing"
  exit 1
fi
first_line=$(head -n 1 README.md)
case "$first_line" in
  "# "*) echo "PASS: README.md has a title" ;;
  *) echo "FAIL: the first line of README.md must be a title starting with '# '"; exit 1 ;;
esac
EOF
bash scripts/check-notes.sh
echo "exit code: $?"
```

```text output
PASS: README.md has a title
exit code: 0
```

`$?` holds the exit code of the previous command. `0` means success.

### 2. Prove that it fails when it should

A check that never fails is useless, so break the README on purpose:

```bash run fails
mv README.md README.bak
echo "Student notes" > README.md
bash scripts/check-notes.sh
echo "exit code: $?"
mv README.bak README.md
```

```text output
FAIL: the first line of README.md must be a title starting with '# '
exit code: 1
```

Exit code `1` is what CI will see. The last line restored the real README.

### 3. Add the workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/check.yml <<'EOF'
name: Check notes

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the repository
        uses: actions/checkout@v7
      - name: Check the README
        run: bash scripts/check-notes.sh
EOF
git add scripts/check-notes.sh .github/workflows/check.yml
git commit -m "Add CI workflow that checks the README"
```

```text output
[main cc28f0c] Add CI workflow that checks the README
 2 files changed, 30 insertions(+)
 create mode 100644 .github/workflows/check.yml
 create mode 100644 scripts/check-notes.sh
```

Reading the workflow: it runs on pushes to `main` and on every pull request; `permissions: contents: read` gives the job's automatic `GITHUB_TOKEN` only the right to read the code (more in the next lesson); the job checks out the repository, because a runner starts empty, and then runs your script. `@v7` pins the checkout action to a major version, so an unexpected new release cannot change your workflow.

### 4. Push it

```bash run
git push
```

```text output
To ../class-remote.git
   2a82dac..cc28f0c  main -> main
```

Here the push went to the practice remote from the Git lessons, which cannot run workflows. On GitHub, this push is what starts the workflow.

### 5. Watch it run on GitHub

1. Push the repository to GitHub (Git lesson 3, section 5, shows how).
2. Open the repository's **Actions** tab. You will see a run of *Check notes* for your push. Select it, then the **check** job, to see each step's log.
3. The run shows a green tick when every step succeeded. The same tick appears next to the commit on the repository's main page.
4. Make the check fail on purpose: change the first line of `README.md` so it no longer starts with `# `, commit and push. The run turns red, and the **Check the README** step's log shows the `FAIL:` message from your script. Fix the README, push again, and it turns green.
5. On a public repository, standard GitHub-hosted runners are free; on private repositories there is a monthly allowance of minutes. Check GitHub's current billing documentation before running heavy workloads.

## Common mistakes

- **Printing an error but exiting 0.** CI only sees the exit code. `set -euo pipefail` makes a script stop and fail on the first unexpected error.
- **Forgetting `actions/checkout`.** The runner starts without your code; later steps then fail with "file not found".
- **Putting the workflow in the wrong place.** It must be in `.github/workflows/` and end in `.yml` or `.yaml`.
- **Unpinned actions** such as `@main`: a change by the action's author would silently change your pipeline. Pin a version or a full commit SHA.
- **Debugging by pushing dozens of commits.** Run the same script locally first.

## Where this fits in a real system

This is the smallest possible CI pipeline. Real pipelines run linters, tests and security scans, build **Docker** images and deploy to **Kubernetes**; DevForge's own `.github/workflows/ci.yml` typechecks, builds, runs all tests (starting real PostgreSQL and Redis services for the lessons) and runs browser tests on every push. **Jenkins** does the same job on servers you operate yourself, as the Jenkins track compares.
