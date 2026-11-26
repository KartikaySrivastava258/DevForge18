---
id: github-actions-protected-deployment
title: Add a protected deployment stage
track: github-actions
level: advanced
mode: local
estimated_minutes: 35
prerequisites: [github-actions-pull-requests-and-safety]
objectives:
  - Split a workflow into a test job and a deploy job that runs only after the tests pass.
  - Protect the deploy job with a GitHub environment, so a reviewer must approve it and its secret stays locked until then.
  - Stop two deployments from running at once with a concurrency group, without cancelling one halfway.
checkpoints:
  - { id: fails-safe, text: "deploy.sh refused to run without DEPLOY_TOKEN" }
  - { id: workflow, text: "I can explain what needs, environment and concurrency each do in deploy.yml" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Deployments and environments
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
    publisher: GitHub Docs
    type: documentation
    level: intermediate
    official: true
    why: Required reviewers, deployment branches, and when a job can read environment secrets.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Managing environments for deployment
    url: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
    publisher: GitHub Docs
    type: documentation
    level: intermediate
    official: true
    why: Creating the production environment and its protection rules in the repository settings, and which plans support them.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Control the concurrency of workflows and jobs
    url: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
    publisher: GitHub Docs
    type: documentation
    level: intermediate
    official: true
    why: Concurrency groups, pending jobs, and cancel-in-progress.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Writing and running the deploy script, writing the workflow and committing it in the practice repository are run by DevForge's test suite, and their output is compared with this page; the workflow is checked by DevForge's workflow checker. Environments, required reviewers and concurrency were checked against GitHub's documentation on 2026-11-26 but are not executed, because they need a repository on GitHub. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

The notes repository from the lessons is checked on every push. Now add a **deploy stage**: it runs only after the checks pass, only from `main`, only after a person approves it, never twice at the same time — and the deploy secret is out of reach until all of that has happened.

## Before you start

Continue in the `student-notes` practice repository from the lessons (on Windows, Git Bash). The local steps write and check the files; the last step, on GitHub, is optional and needs a repository you own.

## Steps

### 1. A deploy script that fails safe

The "deployment" here only prints what it would deploy — the point is the pipeline around it. It refuses to run without its token, so a misconfigured pipeline stops instead of half-deploying.

```bash run
cat > scripts/deploy.sh <<'EOF'
#!/usr/bin/env bash
# Pretend deployment: prints what it would deploy. Needs DEPLOY_TOKEN.
set -euo pipefail
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is not set; refusing to deploy}"
echo "Deploying $(git rev-parse --short HEAD) of student-notes to production"
EOF
bash scripts/deploy.sh || echo "exit code: $?"
```

```text output
scripts/deploy.sh: line 4: DEPLOY_TOKEN: DEPLOY_TOKEN is not set; refusing to deploy
exit code: 1
```

```bash run
DEPLOY_TOKEN=practice-only bash scripts/deploy.sh
```

```text output
Deploying … of student-notes to production
```

### 2. The workflow: test, then a protected deploy

```bash run
cat > .github/workflows/deploy.yml <<'EOF'
name: Deploy notes

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the repository
        uses: actions/checkout@v7
      - name: Check the README
        run: bash scripts/check-notes.sh

  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: production
      cancel-in-progress: false
    steps:
      - name: Check out the repository
        uses: actions/checkout@v7
      - name: Deploy
        run: bash scripts/deploy.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
EOF
git add scripts/deploy.sh .github/workflows/deploy.yml
git commit -q -m "Add a protected deploy stage"
git show --stat --format=%s HEAD
```

```text output
Add a protected deploy stage

 .github/workflows/deploy.yml | 32 ++++++++++++++++++++++++++++++++
 scripts/deploy.sh            |  5 +++++
 2 files changed, 37 insertions(+)
```

Read it line by line:

- **`on: push: branches: [main]`** — pull requests do not trigger this workflow at all; only changes that reach `main` can deploy.
- **`needs: test`** — the deploy job waits for the test job and is skipped if it fails.
- **`environment: production`** — the job deploys to a GitHub **environment**. Protection rules set on that environment in the repository settings — such as required reviewers and which branches may deploy — must pass before the job starts. GitHub's documentation also says a job cannot read the environment's secrets until a required reviewer approves it, so `DEPLOY_TOKEN` should be stored as an *environment* secret, not a repository secret.
- **`concurrency: group: production`** — only one job in the `production` group runs at a time; a newer one waits as *pending*. **`cancel-in-progress: false`** (the default) means a running deployment is never cancelled halfway; by default a waiting deployment is replaced by a newer one, which is usually what you want.
- **`permissions: contents: read`** — the automatic token can read the code and nothing more.

### 3. Set up the environment on GitHub (optional)

On a repository you own on GitHub: **Settings → Environments → New environment**, name it `production`, tick **Required reviewers** and add yourself, restrict **Deployment branches** to `main`, and add an environment secret `DEPLOY_TOKEN` with any practice value. Push, open the **Actions** tab, and watch the deploy job wait for your approval after the tests pass.

Check your plan first: GitHub's documentation says that on the Free, Pro and Team plans, required reviewers and some other protection rules are available only for public repositories.

## Check your work

Run this inside `student-notes`.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
wf=.github/workflows/deploy.yml
check "deploy.yml and deploy.sh are committed" 'git ls-files --error-unmatch "$wf" scripts/deploy.sh'
check "the deploy job needs the test job" 'grep -qE "^    needs: test$" "$wf"'
check "the deploy job uses the production environment" 'grep -qE "^    environment: production$" "$wf"'
check "deployments share one concurrency group and are not cancelled halfway" 'grep -qE "^      group: production$" "$wf" && grep -qE "^      cancel-in-progress: false$" "$wf"'
check "the token gets read-only access to the code" 'grep -qE "^  contents: read$" "$wf"'
check "deploy.sh refuses to run without DEPLOY_TOKEN" '! env -u DEPLOY_TOKEN bash scripts/deploy.sh'
check "deploy.sh runs with a token" 'DEPLOY_TOKEN=practice-only bash scripts/deploy.sh'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: deploy.yml and deploy.sh are committed
PASS: the deploy job needs the test job
PASS: the deploy job uses the production environment
PASS: deployments share one concurrency group and are not cancelled halfway
PASS: the token gets read-only access to the code
PASS: deploy.sh refuses to run without DEPLOY_TOKEN
PASS: deploy.sh runs with a token
All checks passed
```

## Reset

Undo the lab's commit with `git reset --hard HEAD~1` (only if you have not pushed it), then start again at step 1.

## What you practised

A deployment pipeline is a chain of guarantees: tests before deploy, deploys only from `main`, a person's approval before the secret is released, and one deployment at a time. Each line of `deploy.yml` adds one of those guarantees.
