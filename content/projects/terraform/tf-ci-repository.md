---
id: tf-ci-repository
track: terraform
title: CI-validated infrastructure repository
level: advanced
estimated_hours: 6
prerequisites: [terraform-in-ci-with-plan-review, terraform-testing-and-policy, terraform-variables-outputs-state, terraform-first-configuration]
related_tracks: [github-actions, git-github]
user_stories:
  - As a reviewer, I want every pull request to the infrastructure formatted, validated, tested and planned automatically so that I review a plan, not a guess.
  - As a security lead, I want the workflow to use a read-only token, actions pinned to commit SHAs and providers pinned by the lock file so that a compromised tag or release cannot change what CI runs.
  - As a team member, I want no state or plan files in Git so that secrets in them never reach the repository.
acceptance_criteria:
  - No state files, saved plans or .terraform/ folders are committed, and .gitignore ignores them but not .terraform.lock.hcl.
  - terraform fmt -check -recursive and terraform validate pass.
  - infra/.terraform.lock.hcl is committed, records hashicorp/local 2.9.1 with h1 hashes for at least three platforms, and terraform init -lockfile=readonly succeeds with it.
  - terraform test passes with at least three runs, at least one of them using expect_failures; a plan with environment=qa is refused by validation.
  - With environment=staging, apply renders out/staging/<service>.json for each service and the output config_files lists them; a second plan shows no changes; destroy removes the files.
  - "The workflow passes actionlint, runs on pull requests with permissions contents: read, pins every action to a full commit SHA, installs Terraform 1.15.6 and runs fmt -check, init -lockfile=readonly, validate, test and plan — and never apply -auto-approve."
rubric:
  - { criterion: "Supply chain", excellent: "Actions pinned by SHA with the release in a comment, Terraform and providers pinned, the lock file covering every platform the team uses and checked with -lockfile=readonly, and a note on how updates are reviewed (Dependabot or a scheduled job).", good: "Everything pinned and the lock file committed.", needs_work: "Tags such as @v4, unpinned providers, or no lock file." }
  - { criterion: "Tests and validation", excellent: "Validation on every input with messages that say how to fix the value, plan-only tests for the logic and expect_failures for each refusal, and tests that would catch a real regression.", good: "Three passing runs, including a refusal.", needs_work: "Only the happy path, or assertions that restate the code." }
  - { criterion: "Workflow design", excellent: "Least-privilege token, a concurrency group, timeouts, a plan summary for reviewers, -detailed-exitcode handled correctly, and a written plan for how apply would work safely (remote backend, approval, saved plan).", good: "Pull requests are formatted, validated, tested and planned with a read-only token.", needs_work: "Applies on push with a write-all token." }
hints:
  - "git rm --cached infra/terraform.tfstate removes the file from the repository but keeps your copy; add the .gitignore in the same commit."
  - "terraform providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_arm64 -platform=windows_amd64 records a hash for each platform, so colleagues on other systems can run init -lockfile=readonly too."
  - "git ls-remote https://github.com/actions/checkout refs/tags/v7.0.1 shows the commit a tag points to; for an annotated tag use the ^{} line."
  - "expect_failures = [var.environment] makes a run pass only if that variable's validation fails — the way to test refusals."
  - "plan -detailed-exitcode exits 2 when there are changes; in CI that is not an error. Only exit code 1 is."
stretch_goals:
  - Add a remote backend and a second job that applies the saved plan from main after approval on a protected environment, as in the CI lesson.
  - Add a policy check on the plan JSON (terraform show -json) that refuses more than 10 replicas in prod.
  - Run a scheduled drift-detection plan every night and fail when it is not empty.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

`infra/` renders one JSON configuration file per campus service and environment. It works on its author's laptop,
but the repository is not ready for a team: `terraform.tfstate` is committed, nothing is pinned or tested, there is
no `.gitignore`, and the only workflow applies every push with a write-all token and actions referenced by
movable tags.

Turn it into a repository whose pull requests CI can be trusted to check: clean history and `.gitignore`, pinned
providers with a committed multi-platform lock file, validated inputs with `terraform test`, and a GitHub Actions
workflow that formats, validates, tests and plans every pull request with a read-only token and SHA-pinned actions.

The check needs **Docker only**. It runs Terraform 1.15.6 (and git, which the same image contains) from the
official `hashicorp/terraform` image and actionlint 1.7.12 from its official image, both pinned by digest, on a
temporary copy of your repository. It cannot run GitHub Actions itself: it lints the workflow and checks its
triggers, permissions, pins and steps, and runs the same Terraform commands locally.

## Getting started

1. Copy the starter folder, make it a Git repository and read `README.md`.
2. Clean up and pin: remove the state file from the repository, add `.gitignore`, pin `hashicorp/local` to
   2.9.1 and create the lock file:

   ```bash
   cd infra
   terraform init
   terraform providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_arm64 -platform=windows_amd64
   ```

3. Add validation and `infra/tests/*.tftest.hcl`, and run `terraform test` until it passes.
4. Rewrite `.github/workflows/terraform.yml`, starting from the workflow in the CI lesson, with SHA-pinned actions
   and a read-only token, then run the check:

   ```bash
   bash check.sh path/to/your/repository
   ```
