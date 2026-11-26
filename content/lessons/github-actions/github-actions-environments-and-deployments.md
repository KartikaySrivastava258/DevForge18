---
id: github-actions-environments-and-deployments
title: Environments, approvals and deployments
track: github-actions
order: 6
level: intermediate
estimated_minutes: 45
prerequisites: [github-actions-caching-and-artifacts]
learning_objectives:
  - Model a pipeline that builds once and promotes the same image digest from staging to production.
  - Use GitHub environments for per-environment variables and secrets, required reviewers, wait timers and branch rules.
  - Roll back by redeploying a previous digest, and keep a deployment history per environment.
  - Stop two deployments to the same environment from overlapping with a concurrency group.
resources:
  - title: Deployments and environments
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
    publisher: GitHub
    type: reference
    level: intermediate
    official: true
    why: Required reviewers (up to six), wait timers (1 to 43,200 minutes), deployment branches and tags, environment secrets and variables, and plan limits for private repositories.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Using secrets in GitHub Actions
    url: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: How secrets reach steps (as inputs or environment variables), and that secrets cannot be referenced directly in if conditions.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: promote
    prompt: Why should production deploy the digest that staging tested, rather than build again from the same commit?
    options:
      - { id: a, text: "Building twice is slower, nothing else" }
      - { id: b, text: "A second build can differ (new base image, new dependency versions); promoting the digest guarantees production runs exactly what was tested" }
      - { id: c, text: "GitHub forbids two builds" }
    answer: b
    explanation: Build once, promote the artefact. The lab's deploy script refuses a production digest that staging never ran.
  - id: env-secrets
    prompt: The production database password is an environment secret of the production environment, which has required reviewers. When can a job read it?
    options:
      - { id: a, text: "Any job in the repository, at any time" }
      - { id: b, text: "Only a job that references the production environment, and only after a reviewer approved that job" }
      - { id: c, text: "Only pull request jobs" }
    answer: b
    explanation: Environment secrets are released to the job when its protection rules pass — that is what makes approval meaningful.
  - id: rollback
    prompt: Production misbehaves after a deploy. What is the fastest safe rollback in this design?
    options:
      - { id: a, text: "Revert the commit and wait for a full rebuild" }
      - { id: b, text: "Redeploy the previous digest from production's deployment history — it already ran there" }
      - { id: c, text: "Delete the environment" }
    answer: b
    explanation: Fix forward in the code afterwards; first restore service with a known-good artefact.
verification:
  method: executed
  details: The local commands — a deploy script that models promotion, per-environment configuration, history and rollback — run in the test suite and their output is compared with this lesson; this is a local model of the rules, not GitHub itself. The workflow is validated by DevForge's workflow checker. Environment protection rules, secrets and limits were checked against GitHub Docs on 2026-11-26; configuring them needs a GitHub repository and is not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A deployment pipeline **builds once** and **promotes the same image digest** through **environments** — staging, then production — where GitHub releases each environment's secrets only to jobs that pass its **protection rules** (approvals, wait timers, allowed branches).

## Explain it like I'm twelve

A school play is rehearsed in the classroom (staging) before the performance in the hall (production). The performance uses the *same* script and costumes that were rehearsed — nobody rewrites the play on the night. The head teacher signs off before the doors open (approval), and the hall keys are only handed over then (environment secrets). If something goes wrong on stage, you go back to the last version that worked (rollback).

Where the analogy breaks: a rollback in software takes seconds, because the previous version is still sitting in the registry.

## What problem it solves

Without a deployment process, anyone with access can push anything to production, credentials for production sit in reach of every job, and nobody knows which version runs where. Environments give each stage its own configuration and credentials, record every deployment, and put a human (or a timer) between "tests passed" and "customers see it".

## How it works

![](media:github-actions/environments.svg)

- An **environment** (repository settings) holds **variables** (`vars.API_URL`) and **secrets** for one stage, plus **protection rules**: up to six required reviewers, a wait timer (1–43,200 minutes), and which branches or tags may deploy to it. On GitHub Free, Pro and Team plans, required reviewers and wait timers are available for public repositories only.
- A job opts in with `environment: { name: production, url: … }`. It waits until the rules pass, then gets that environment's secrets; GitHub records a deployment with its status and URL.
- `needs:` chains build → staging → production; jobs pass the **digest** forward as an output.
- `concurrency:` with one group per environment queues deployments instead of running two at once.

## Try it yourself

> **Local lab** — needs Bash, as in the earlier lessons. A small script models the rules locally (it is not GitHub); the workflow is checked by DevForge's tests and runs on GitHub if you push it to a repository with environments. Every command is run automatically in DevForge's tests.

### 1. Per-environment configuration and a deploy script

```bash run
mkdir -p deploy-lab/environments deploy-lab/history && cd deploy-lab
printf 'API_URL=https://staging.course-site.example\n' > environments/staging.env
printf 'API_URL=https://course-site.example\n' > environments/production.env
cat > deploy.sh <<'EOF'
#!/usr/bin/env bash
# Usage: deploy.sh ENVIRONMENT DIGEST — a local model of a promotion pipeline:
# production only accepts a digest that staging has already run; every deployment is recorded.
set -euo pipefail
env="$1"; digest="$2"
[ -f "environments/$env.env" ] || { echo "unknown environment: $env"; exit 1; }
source "environments/$env.env"
if [ "$env" = production ] && ! grep -qx "$digest" history/staging.log 2> /dev/null; then
  echo "REFUSED: $digest was never deployed to staging"; exit 1
fi
echo "$digest" >> "history/$env.log"
echo "deployed ${digest:0:15}… to $env ($API_URL)"
EOF
chmod +x deploy.sh
v1="sha256:$(printf '%064d' 1)"; v2="sha256:$(printf '%064d' 2)"; v3="sha256:$(printf '%064d' 3)"
./deploy.sh staging "$v1"
./deploy.sh production "$v1"
```

```text output
deployed sha256:0000000… to staging (https://staging.course-site.example)
deployed sha256:0000000… to production (https://course-site.example)
```

The digests here are placeholders (`sha256:000…1` and so on); in the pipeline they come from the image build. Each environment reads its own configuration — in GitHub, environment variables like `vars.API_URL`.

### 2. Production only takes what staging ran

```bash run fails
./deploy.sh production "$v2"
```

```text output
REFUSED: sha256:0000000000000000000000000000000000000000000000000000000000000002 was never deployed to staging
```

```bash run
./deploy.sh staging "$v2"
./deploy.sh production "$v2"
echo "production history: $(wc -l < history/production.log | tr -d ' ') deployments, current ${v2: -1}"
```

```text output
deployed sha256:0000000… to staging (https://staging.course-site.example)
deployed sha256:0000000… to production (https://course-site.example)
production history: 2 deployments, current 2
```

### 3. Roll back

Version 2 misbehaves in production. Redeploy the previous one from production's own history:

```bash run
previous=$(tail -n 2 history/production.log | head -n 1)
./deploy.sh production "$previous"
echo "now running version ${previous: -1}; history:"
sed 's/.*\(.\)$/  version \1/' history/production.log
```

```text output
deployed sha256:0000000… to production (https://course-site.example)
now running version 1; history:
  version 1
  version 2
  version 1
```

The rollback is just another deployment of a digest production already ran — fast, and recorded.

### 4. The workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/deploy.yml <<'EOF'
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      digest:
        description: Redeploy this image digest to production (rollback)
        required: false
        type: string

permissions:
  contents: read

jobs:
  build:
    if: inputs.digest == ''
    runs-on: ubuntu-latest
    outputs:
      digest: ${{ steps.image.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - name: Build and push the image (see the previous lessons)
        id: image
        run: echo "digest=sha256:replace-with-the-build-push-action-output" >> "$GITHUB_OUTPUT"

  staging:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: ${{ vars.API_URL }}
    concurrency:
      group: deploy-staging
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - name: Deploy to staging
        env:
          DIGEST: ${{ needs.build.outputs.digest }}
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}   # the staging environment's secret
        run: ./deploy.sh staging "$DIGEST"

  production:
    needs: [build, staging]
    if: always() && (needs.staging.result == 'success' || inputs.digest != '')
    runs-on: ubuntu-latest
    environment:
      name: production        # required reviewers and a wait timer are set on this environment
      url: ${{ vars.API_URL }}
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v7
      - name: Deploy to production
        env:
          DIGEST: ${{ inputs.digest || needs.build.outputs.digest }}
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}   # released only after approval
        run: ./deploy.sh production "$DIGEST"
EOF
sed -n '/^jobs:/,$p' .github/workflows/deploy.yml | grep -E '^  [a-z]+:$|name: (staging|production)' | sed 's/^ *//'
```

```text output
build:
staging:
name: staging
production:
name: production        # required reviewers and a wait timer are set on this environment
```

- A push to `main` builds once, deploys to `staging`, then waits for the `production` environment's reviewers; only then does the production job get production's `DEPLOY_TOKEN`.
- `workflow_dispatch` with a `digest` skips the build and staging and redeploys a known digest to production — the rollback path, still behind the same approval.
- Each environment has its own concurrency group: deployments queue, and none is cancelled halfway.
- On GitHub: **Settings → Environments** — create `staging` and `production`, add variables and secrets, and give `production` required reviewers and "Deployment branches: main".

## Common mistakes

- **Repository-level secrets for production.** Any job could read them. Put them on the protected environment.
- **Rebuilding per environment.** Promote the tested digest instead.
- **`cancel-in-progress: true` on deployments.** A half-finished deployment is worse than a queued one.
- **No rollback path.** Decide before an incident how to redeploy the previous digest — and practise it.
- **Expecting reviewers on a private repository on a Free plan.** Check your plan; GitHub documents which protection rules each plan supports.

## Where this fits in a real system

The digest comes from the image pipeline of lesson 4; the deploy step applies **Kubernetes** manifests or runs **Terraform** with the digest as a variable; cloud credentials come from OIDC (next lesson) rather than stored secrets; and **Prometheus** alerts decide when a rollback is needed. **Jenkins** offers the same pattern with input steps and credentials scoped to stages.
