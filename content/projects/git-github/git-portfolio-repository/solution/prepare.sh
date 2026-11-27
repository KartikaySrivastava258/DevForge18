#!/usr/bin/env bash
# Replays, in order, the commands a learner would run to build this reference repository from the starter.
# DevForge's tests run it inside a copy of the solution folder, with STARTER_DIR pointing at the starter.
set -euo pipefail
: "${STARTER_DIR:?set STARTER_DIR to a copy of the starter folder}"
if git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Run this in a fresh copy of the solution folder, outside any Git repository." >&2
  exit 1
fi
git init -q -b main
git config user.name "Example Student"
git config user.email "student@example.edu"

cp "$STARTER_DIR/.env" .env                      # the starter's local settings: must stay out of Git
git add .gitignore
git commit -q -m "Ignore local settings, logs and editor files"

git add README.md
git commit -q -m "Write the README introduction and contact section"

git add projects/weather-dashboard.md
git commit -q -m "Add the campus weather dashboard write-up"

git add projects/library-queue-simulator.md
git commit -q -m "Add the library queue simulator write-up"

git add LICENSE
git commit -q -m "License the repository under MIT"

echo "local preview started" > preview.log        # a tool writes a log; .gitignore keeps it out
git log --oneline
