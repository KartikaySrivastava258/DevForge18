---
id: git-release-workflow
track: git-github
title: Release workflow with automated tests
level: advanced
estimated_hours: 8
prerequisites: [git-pull-requests-and-review, git-protected-branches-signing-secrets, github-actions-first-workflow]
related_tracks: [github-actions]
user_stories:
  - As a maintainer of a small library, I want the tests to run on every pull request so that a change that breaks them is visible before anyone merges it.
  - As a maintainer, I want pushing a version tag to publish a release only when the tests pass so that a broken build can never become a release.
  - As a user of the library, I want a changelog and tagged versions so that I know what changed and can pin the exact version I tested with.
  - As a security reviewer, I want the workflows to have least-privilege permissions and actions pinned to commit SHAs so that a compromised action tag cannot take over the release.
acceptance_criteria:
  - The bug in the README is fixed — compare("1.10.0", "1.9.0") is positive — and a test covers it; all tests pass.
  - A workflow runs the tests (npm test) on pull requests and on pushes to main.
  - A workflow triggered by pushing a version tag runs the tests and creates a GitHub release in a job that depends on them (needs:).
  - Every action used in a workflow is pinned to a full 40-character commit SHA.
  - "Every workflow sets top-level permissions (contents: read); only the release job is granted contents: write."
  - package.json says 1.0.0 or later, and CHANGELOG.md has a section for that version.
  - An annotated tag v<version> points at a commit on main whose package.json has that version.
  - The working tree is clean.
rubric:
  - { criterion: "Testing and the fix", excellent: "A failing test reproduced the bug before the fix (visible in the pull request), the fix is minimal, and edge cases such as 0.10.0 and 10.0.0 are covered.", good: "The fix is correct and has a test.", needs_work: "The fix has no test, or other behaviour changed with it." }
  - { criterion: "Workflow design", excellent: "CI and release share the same test steps, the release refuses a tag that does not match package.json or has no changelog section, and a test run of the release on a fork or a pre-release tag is documented.", good: "Both workflows work; the release depends on the tests.", needs_work: "The release can publish without the tests passing, or the workflows have never run." }
  - { criterion: "Supply-chain hygiene", excellent: "Actions are pinned to SHAs with the release noted in a comment, permissions are minimal per job, checkout does not persist credentials, and Dependabot (or a lockfile) keeps the pins up to date.", good: "Actions are pinned and permissions are read-only by default.", needs_work: "Actions are referenced by tag or branch, or the workflow has write-all permissions." }
  - { criterion: "Release hygiene", excellent: "CHANGELOG follows Keep a Changelog, versions follow Semantic Versioning, the tag is annotated (and signed), and the GitHub release notes match the changelog.", good: "Changelog, version and annotated tag agree.", needs_work: "The tag, package.json and changelog disagree, or the tag is lightweight." }
hints:
  - Start with the bug. Write a test that fails — compare("1.10.0", "1.9.0") should be positive — and then fix parse. Strings compare character by character, so "10" < "9".
  - Get the CI workflow green on a pull request before writing the release workflow. Use the SHAs from the official actions/checkout and actions/setup-node release tags (git ls-remote https://github.com/actions/checkout refs/tags/v7.0.1 prints one) and keep the version in a comment.
  - In the release workflow, put the tests in one job and the release in another with needs, so the release job — the only one with contents write — runs only after the tests pass.
  - gh, the GitHub CLI, is installed on GitHub-hosted runners; give it the job's token in GH_TOKEN. gh release create --verify-tag fails if the tag does not exist on GitHub.
  - Create the tag with git tag -a v1.0.0 -m "…" on the merged commit on main, then git push origin v1.0.0. To retry after a failed release, delete the tag locally and on GitHub, fix the problem, and tag again.
stretch_goals:
  - Run the tests on Node.js 22 and 24 with a matrix.
  - Add Dependabot version updates for GitHub Actions so the pinned SHAs are updated by pull request.
  - Generate a build provenance attestation for a packaged tarball (see "Supply-chain hardening" in the GitHub Actions track).
  - Protect v* tags with a ruleset so that only maintainers can create them.
starter: starter
solution: solution
check_needs: [git, node]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

`semver-lite` is a tiny library that compares version numbers. It is at 0.9.0, and its README lists three
problems blocking 1.0.0: a real bug (`1.10.0` sorts before `1.9.0`), no automated tests, and releases made by
hand with no changelog. Your job is to ship **1.0.0 through an automated, tested release** — the same pattern
used by many open-source projects:

1. Every pull request and push to main runs the tests (a CI workflow).
2. A maintainer prepares the release on main: the version in `package.json` and a changelog section.
3. Pushing an annotated tag such as `v1.0.0` starts a release workflow that runs the tests again and, only if
   they pass, publishes a GitHub release with the changelog's notes.

The workflows are part of your attack surface. A workflow that can write to the repository and runs an action
referenced by a movable tag (`@v7`) trusts whoever controls that tag. Pin actions to commit SHAs and give each
job only the permissions it needs.

The check script reads your repository and runs the tests locally. It cannot see whether the workflows ran on
GitHub; the rubric asks you to show that they did (a green CI run on a pull request and a published release).

## Getting started

1. Copy the starter into a new folder, commit it, and tag the starting point:

   ```bash
   cd ~/semver-lite
   git init -b main
   git add -A
   git commit -m "Import semver-lite 0.9.0"
   git tag -a v0.9.0 -m "semver-lite 0.9.0"
   npm test                      # 3 tests pass — and yet the bug is real:
   node --input-type=module -e "import { compare } from './src/semver.js'; console.log(compare('1.10.0', '1.9.0'))"
   ```

2. Create an empty repository on GitHub, push main and the tag, and protect main so changes arrive by pull
   request (see "Protected branches, signed commits and secrets").
3. Make each change on a branch with a pull request: the bug fix and its test, the CI workflow, the release
   workflow, then a release commit with the version and changelog.
4. Tag the merged release commit, push the tag, and watch the release workflow on the Actions tab.
5. Check your work on a fresh clone (tags included):

   ```bash
   git clone https://github.com/<you>/semver-lite /tmp/semver-check
   bash check.sh /tmp/semver-check
   ```
