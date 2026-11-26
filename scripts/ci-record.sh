#!/usr/bin/env bash
# Record lessons in CI instead of on this machine (no local Docker images, kind, Jenkins, Kafka …).
#
#   npm run ci:record -- <lesson-or-lab-id> [more ids …]
#
# Pushes the current commit to a temporary branch, runs the "Record lessons" workflow there, downloads the
# patch it produces, applies it to the working tree for review (git diff), and deletes the branch.
# Commit the lesson first: the workflow records what is committed.
set -euo pipefail
[ "$#" -ge 1 ] || { echo "usage: npm run ci:record -- <lesson-or-lab-id> [more ids …]"; exit 2; }
for id in "$@"; do [[ "$id" =~ ^[a-z0-9-]+$ ]] || { echo "invalid id: $id"; exit 2; }; done
if [ -n "$(git status --porcelain -- content/)" ]; then
  echo "content/ has uncommitted changes; commit them first (the workflow records the committed state)."; exit 1
fi
branch="record/$(date +%Y%m%d-%H%M%S)"
retry() { for i in 1 2 3 4 5; do "$@" && return 0; sleep 15; done; return 1; }
retry git push -q origin "HEAD:refs/heads/$branch"
trap 'retry git push -q origin --delete "$branch" || echo "could not delete branch $branch; delete it by hand"' EXIT
retry gh workflow run record-lessons.yml --ref "$branch" -f ids="$*"
id=""
for i in $(seq 1 30); do
  id=$(gh run list --workflow record-lessons.yml --branch "$branch" --limit 1 --json databaseId -q '.[0].databaseId' 2> /dev/null || true)
  [ -n "$id" ] && break; sleep 5
done
[ -n "$id" ] || { echo "the workflow run did not appear"; exit 1; }
echo "recording in CI: run $id (branch $branch)"
until [ "$(gh run view "$id" --json status -q .status 2> /dev/null || true)" = completed ]; do sleep 30; done
dir="$(mktemp -d)"
retry gh run download "$id" -n recorded-lessons -D "$dir"
grep -E 'output block|stopped early|skipped|exit code' "$dir/record.log" || tail -n 20 "$dir/record.log"
if [ -s "$dir/recorded.patch" ]; then
  git apply "$dir/recorded.patch" && echo "applied; review with: git diff -- content/"
else
  echo "no output changed"
fi
echo "full log: $dir/record.log"
