#!/usr/bin/env bash
# Replays, from the starter, the commits and the tag a maintainer would make for this reference solution.
# DevForge's tests run it inside a copy of the solution folder, with STARTER_DIR pointing at the starter.
set -euo pipefail
: "${STARTER_DIR:?set STARTER_DIR to a copy of the starter folder}"
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Run this in a fresh copy of the solution folder, outside any Git repository." >&2
  exit 1
fi
final="$(mktemp -d)"
trap 'rm -rf "$final"' EXIT
cp -a . "$final"
find . -mindepth 1 -delete
cp -a "$STARTER_DIR"/. .

git init -q -b main
git config user.name "Example Maintainer"
git config user.email "maintainer@example.edu"
git add -A
git commit -q -m "Import semver-lite 0.9.0"
git tag -a v0.9.0 -m "semver-lite 0.9.0"

# In a team, each step below is a branch and a pull request; CI (added in the next commit) checks each one.
cp "$final/src/semver.js" src/semver.js
cp "$final/test/semver.test.js" test/semver.test.js
git commit -q -am "Compare version parts as numbers so 1.10.0 sorts after 1.9.0"

mkdir -p .github/workflows
cp "$final/.github/workflows/ci.yml" .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -q -m "Run the tests on pushes to main and on pull requests"

cp "$final/.github/workflows/release.yml" .github/workflows/release.yml
git add .github/workflows/release.yml
git commit -q -m "Publish a GitHub release when a version tag is pushed"

cp "$final/CHANGELOG.md" CHANGELOG.md
cp "$final/README.md" README.md
cp "$final/package.json" package.json
git add -A
git commit -q -m "Release 1.0.0"
git tag -a v1.0.0 -m "semver-lite 1.0.0"

diff -r --exclude=.git "$final" . > /dev/null || { echo "replayed history does not match the solution files" >&2; diff -r --exclude=.git "$final" . >&2; exit 1; }
git log --oneline --decorate
