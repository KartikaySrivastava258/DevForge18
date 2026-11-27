---
id: gha-release-pipeline
track: github-actions
title: Automated release workflow
level: advanced
estimated_hours: 10
prerequisites: [github-actions-reusable-workflows-and-composite-actions, github-actions-environments-and-deployments, github-actions-supply-chain-hardening, github-actions-caching-and-artifacts]
related_tracks: [git-github]
user_stories:
  - As a maintainer, I want pushing a version tag to test, build and publish a release automatically so that releasing is routine instead of a risky manual job.
  - As a user of the library, I want to verify that a release tarball was built by this repository's workflow from the tagged commit so that I can trust what I install.
  - As a release manager, I want a person to approve each release and a mismatched tag to be refused so that nothing is published by accident.
  - As a security reviewer, I want each job to hold only the permissions it needs so that a compromised test step cannot publish anything.
acceptance_criteria:
  - .github/workflows/test.yml is a reusable workflow (on workflow_call, input node-version) that runs npm ci and the tests, and both ci.yml and release.yml call it with valid inputs.
  - release.yml runs only when a version tag is pushed.
  - One job builds the package once, attests its provenance (actions/attest) and uploads it as an artifact; a separate release job needs the build and test jobs, runs in the environment "release", downloads the artifact and neither checks out nor rebuilds.
  - "Permissions are set per job: only the build job has id-token: write and attestations: write, only the release job has contents: write, and the workflow default grants nothing."
  - Every action is pinned to a full commit SHA, releases are serialised with concurrency (never cancelled halfway), and no ${{ }} context value is pasted into a run script.
  - scripts/check-version.mjs exits 0 only when GITHUB_REF_NAME is v plus the package.json version.
  - Run locally for tag v<version>, the tests run and gh release create publishes the very tarball the build job uploaded and attested; the tarball contains package.json and src/ only.
  - For a tag that does not match package.json, the workflow fails and nothing is published.
rubric:
  - { criterion: "Build once, promote", excellent: "One build produces the tarball and its checksums; the release job verifies and publishes exactly those bytes; the README explains why a rebuild would break the attestation's promise.", good: "The release job publishes the uploaded artifact without rebuilding.", needs_work: "The release job checks out and packs again, so the published file is not the tested and attested one." }
  - { criterion: "Least privilege", excellent: "permissions {} at the top, one small block per job with a comment saying why each write is needed, credentials not persisted by checkout.", good: "Per-job permissions with writes only where needed.", needs_work: "write-all, or contents: write for every job." }
  - { criterion: "Release safety", excellent: "Protected environment with reviewers and tag rules documented, version check before any publishing, concurrency without cancellation, gh release create --verify-tag, a written way to retry a failed release.", good: "Environment, version check and concurrency are in place.", needs_work: "Any tag publishes immediately, or a mismatched tag can be released." }
  - { criterion: "Reuse and supply chain", excellent: "CI and release share the reusable test workflow; actions pinned to SHAs with version comments; attestation verifiable with gh attestation verify, shown in the README.", good: "Reusable workflow and SHA pins are used.", needs_work: "Test steps are duplicated, or actions use tags." }
hints:
  - Draw the jobs first — test, build, release — and write next to each one what it needs to read and write. The permissions blocks follow from that drawing.
  - "The lesson on reusable workflows shows on: workflow_call with a typed input and a caller job with uses: ./.github/workflows/… and with:. A job that calls a reusable workflow has no steps of its own; needs: works on it like on any job."
  - "Pack in the build job (npm pack --pack-destination dist), attest dist/*.tgz there (the lesson on supply-chain hardening has the attest step and its permissions), and upload dist/. The release job starts on an empty runner: actions/download-artifact is how the files get there."
  - The release job cannot run npm in this check — it runs with npm and node replaced by stubs. If you need the version or the tag there, you already have the tag in GITHUB_REF_NAME; pass it into the script through env.
  - For the checksum, sha256sum in the build job and sha256sum -c in the release job catch a corrupted or swapped file.
  - '"files": ["src/"] in package.json limits what npm pack puts in the tarball; tar tzf shows what is inside.'
stretch_goals:
  - Publish to the npm registry as well, with npm publish --provenance and the registry's trusted publishing instead of a stored token.
  - Generate the release notes from CHANGELOG.md and fail the release if the version has no section.
  - Add a workflow_dispatch input that re-runs the release job for an existing tag (a retry path) without rebuilding.
  - Verify the attestation in a later job with gh attestation verify before publishing.
starter: starter
solution: solution
check_needs: [docker, node]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

`gradebook-lib` is used by two campus apps, and its release workflow is one job with a write-all token: it
checks out the code, tests it, packs it and publishes whatever it packed, for any tag starting with `v`. Once,
tag `v1.4.1` shipped version 1.4.0. Nobody can prove which workflow built a tarball, nobody approves a release,
and CI and the release define "the tests" differently.

Redesign the release as a small pipeline: a **reusable test workflow** shared with CI; a **build** job that
refuses a mismatched tag, packs the tarball **once**, writes checksums, **attests its build provenance** and
uploads it; and a **release** job in a **protected environment** that publishes exactly those bytes — no
checkout, no rebuild — with the only `contents: write` token in the workflow. Releases are serialised and never
cancelled halfway, and every action is pinned to a commit SHA.

This is the deeper sibling of the Git track's "Release workflow with automated tests", which gets a first
release out; here the focus is how the release is built, who may do what, and what users can verify.

The check reads the workflows and then **runs `release.yml` locally** as a push of tag `v<version>`: the test
and build jobs execute in pinned Node.js containers, the artifact and the attestation subject are recorded, and
the release job runs with `npm` and `node` replaced by stubs that fail (so a rebuild is caught) and `gh`
replaced by a recorder (so the check sees exactly which files would be published). It runs again with a tag
that does not match `package.json`, which must stop the release.

What the local run cannot show: the attestation is not really signed (no OIDC token outside GitHub), the
environment's reviewers and tag rules live in repository settings, and nothing is published to GitHub. Push the
repository to a GitHub repository of your own and tag a test release to see those parts.

## Getting started

1. Copy the starter, run `npm ci && npm test && npm pack`, and read its README.
2. Run the check (Docker and Node.js needed):

   ```bash
   bash check.sh path/to/gradebook-lib
   ```

3. Start with `scripts/check-version.mjs` and the reusable `test.yml`, then split `release.yml` into test,
   build and release jobs. Re-run the check after each step.
4. On GitHub (optional): create the environment `release` with yourself as a required reviewer, push a tag,
   approve the job, then run `gh attestation verify` on the downloaded tarball.
