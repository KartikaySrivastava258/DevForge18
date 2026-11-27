---
id: gha-node-matrix
track: github-actions
title: Multi-version test matrix
level: intermediate
estimated_hours: 6
prerequisites: [github-actions-pull-requests-and-safety, github-actions-caching-and-artifacts, github-actions-supply-chain-hardening]
related_tracks: [git-github]
user_stories:
  - As a maintainer of a shared package, I want the tests to run on every Node.js version I promise to support so that I learn about a version-specific break before the apps that use my package do.
  - As a maintainer, I want to see every failing version at once so that I can fix them together instead of one failed run at a time.
  - As a developer pushing several commits in a row, I want outdated test runs cancelled and dependencies cached so that I get the newest result sooner.
  - As a security reviewer, I want actions pinned to commit SHAs and a read-only token so that a moved tag cannot change what runs in our CI.
acceptance_criteria:
  - .github/workflows/test.yml runs on pushes to main and on pull requests, with a read-only token and every action pinned to a full commit SHA.
  - The job's matrix, expanded as GitHub does (include and exclude count), sets up Node.js 22, 24 and 26.
  - strategy.fail-fast is set explicitly.
  - Dependencies are installed with npm ci, and the npm cache is keyed on package-lock.json.
  - A concurrency group per branch or pull request cancels superseded runs.
  - Run locally, every matrix combination passes in the matching Node.js container.
  - DevForge's hidden tests pass on Node.js 22, 24 and 26 (literal matching of regular-expression characters, base64url cursors without padding).
rubric:
  - { criterion: "Matrix design", excellent: "The matrix covers exactly the versions in engines, the job name shows the version, fail-fast is chosen with a comment explaining why, and the README says how to add the next Node.js version.", good: "All three versions run and fail-fast is explicit.", needs_work: "Versions are missing, or node-version is hard-coded so the matrix runs the same version three times." }
  - { criterion: "Fixing the code", excellent: "Each version-specific failure is traced to the API that is missing in that release, fixed with code that behaves the same everywhere, and the cursor format is shown to stay compatible.", good: "The tests pass on all versions.", needs_work: "Tests were deleted or skipped on older versions, or engines was raised instead of fixing the code without saying so." }
  - { criterion: "Speed and cost", excellent: "Cache keyed on the lockfile, npm ci, a timeout per job and cancellation of superseded runs; the matrix is no larger than it needs to be.", good: "Caching and npm ci are in place.", needs_work: "npm install without a cache, or a matrix that multiplies jobs without a reason." }
  - { criterion: "Supply-chain hygiene", excellent: "SHAs with the version in a comment, Dependabot configured for github-actions, read-only token.", good: "SHA pins and a read-only token.", needs_work: "Tags or branches, or no permissions block." }
hints:
  - "Add the matrix first and leave the code alone: the run turns red on 22 and 24 for different reasons — that is the point of the project. The lesson on pull requests shows a two-version matrix; use ${{ matrix.node-version }} in setup-node's node-version."
  - With fail-fast left at its default (true), GitHub cancels the remaining versions as soon as one fails. Decide what you want to see when 22 breaks, and write it down.
  - Read the error message on each version. "RegExp.escape is not a function" means the function does not exist in that release, not that your code is wrong. You can try one version locally with docker run --rm -v "$PWD:/w" -w /w node:22-bookworm-slim npm test.
  - Node.js has had Buffer's "base64url" encoding (no padding) for a long time; compare its output with the starter's encodeCursor on Node.js 26 before you replace it.
  - The lesson "Supply-chain hardening" lists the SHAs for actions/checkout v7.0.1 and actions/setup-node v7.1.0, and shows how to look one up with git ls-remote.
stretch_goals:
  - Add an operating-system dimension (ubuntu-latest and windows-latest) and use exclude so Windows runs only on the newest version.
  - Add a job outside the matrix that needs all matrix jobs, so a single required check can stand for "all versions passed".
  - Configure Dependabot for github-actions so the pinned SHAs are updated by pull request.
starter: starter
solution: solution
check_needs: [docker, node]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

`campus-search` is a small npm package that three campus apps use for search highlighting and "next page"
links. Its `package.json` says it supports Node.js 22 and newer, but CI tests only Node.js 26 — the version on
the maintainer's laptop. CI is green, and two of the three apps report that search is broken for them.

Turn the workflow into a proper test matrix over every version the package promises to support, and let it
show you what is wrong. Then fix the code so the same tests pass everywhere. Along the way, make the workflow
cheaper and safer: dependencies from the lockfile with a cache, outdated runs cancelled, actions pinned to
commit SHAs and a read-only token.

The check **expands your matrix the way GitHub does** (including `include` and `exclude`) and **runs the job
once per combination** in the matching pinned Node.js container (22.23.4, 24.22.2 or 26.13.0): your steps
really execute. It then runs DevForge's hidden tests on all three versions.

What the local run cannot show: GitHub's scheduling (fail-fast cancelling jobs, concurrency cancelling runs) and
the cache itself. The check verifies that those settings are present; push to GitHub to see them act.

## Getting started

1. Copy the starter and run the tests on your own Node.js version: `npm ci && npm test`.
2. Run the check (Docker and Node.js needed; the first run downloads three Node.js images, about 240 MB each):

   ```bash
   bash check.sh path/to/campus-search
   ```

3. Change `.github/workflows/test.yml` to a matrix and re-run the check. Read which versions fail and why.
4. Fix `src/index.js` without changing what it returns, then finish the workflow (pins, permissions, cache,
   concurrency).
