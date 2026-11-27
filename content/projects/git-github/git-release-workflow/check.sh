#!/usr/bin/env bash
# Acceptance check for "Release workflow with automated tests".
# Usage: bash check.sh path/to/your/semver-lite
# Reads the repository (a local one or a fresh clone with tags) and runs the tests on a copy of main.
# Prints PASS or FAIL for each criterion and exits non-zero if any fails. Needs git and Node.js 22+.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
repo="${1:-.}"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
g() { git -C "$repo" "$@"; }

if [ "$(g rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ] || ! g rev-parse -q --verify main^{commit} > /dev/null; then
  fail "$repo is not a Git repository with a main branch"
  echo "1 or more criteria failed."
  exit 1
fi

copy="$(mktemp -d)"
trap 'rm -rf "$copy"' EXIT
g archive main | tar -x -C "$copy"
version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$copy/package.json" 2>/dev/null)"

# 1. The bug from the README is fixed, and the tests pass.
order="$(cd "$copy" && node --input-type=module -e "import { compare } from './src/semver.js'; console.log(compare('1.10.0', '1.9.0') > 0, JSON.stringify(['1.10.0', '1.2.0', '1.9.3'].sort(compare)))" 2>&1)"
if [ "$order" = 'true ["1.2.0","1.9.3","1.10.0"]' ]; then pass "compare puts 1.10.0 after 1.9.0"; else fail "compare(\"1.10.0\", \"1.9.0\") must be positive and sorting must give 1.2.0, 1.9.3, 1.10.0 (got: $order)"; fi
tests="$(cd "$copy" && node --test 2>&1)"; tests_status=$?
count="$(echo "$tests" | sed -n 's/^# pass \([0-9]*\)$/\1/p')"
if [ "$tests_status" -eq 0 ] && [ "${count:-0}" -ge 4 ]; then pass "the tests pass ($count tests; the starter has 3)"; else fail "the tests must pass and include a test for the fix (pass: ${count:-0}, status $tests_status)"; fi

# 2. Workflows.
workflows="$(g ls-tree --name-only main .github/workflows/ 2>/dev/null | grep -E '\.ya?ml$')"
show() { g show "main:$1"; }
ci="" release=""
for wf in $workflows; do
  body="$(show "$wf")"
  if echo "$body" | grep_quiet -E '^[[:space:]]*pull_request' && echo "$body" | grep_quiet -E 'npm test|node --test'; then ci="$wf"; fi
  if echo "$body" | grep_quiet -E '^[[:space:]]*tags:' && echo "$body" | grep_quiet -E 'gh release create|action-gh-release'; then release="$wf"; fi
done
if [ -n "$ci" ]; then pass "$ci runs the tests on pull requests"; else fail "no workflow in .github/workflows runs npm test on pull_request"; fi
if [ -z "$release" ]; then
  fail "no workflow publishes a release (gh release create) when a tag is pushed"
elif show "$release" | grep_quiet -E '^[[:space:]]+needs:' && show "$release" | grep_quiet -E 'npm test|node --test'; then
  pass "$release runs the tests and publishes only after they pass (needs:)"
else
  fail "$release must run the tests and make the release job depend on them with needs:"
fi

unpinned=""
for wf in $workflows; do
  while IFS= read -r ref; do
    case "$ref" in ./*|docker://*) continue ;; esac
    echo "$ref" | grep_quiet -E '@[0-9a-f]{40}$' || unpinned="$unpinned $wf:$ref"
  done < <(show "$wf" | sed -n 's/^[[:space:]-]*uses:[[:space:]]*\([^[:space:]#]*\).*/\1/p')
done
if [ -n "$workflows" ] && [ -z "$unpinned" ]; then pass "every action is pinned to a full commit SHA"; else fail "pin every action to a full 40-character commit SHA:${unpinned:- (no workflows found)}"; fi

loose=""
for wf in $workflows; do show "$wf" | grep_quiet '^permissions:' || loose="$loose $wf"; done
if [ -n "$ci" ] && show "$ci" | grep_quiet -E ':[[:space:]]*write'; then loose="$loose $ci(grants write)"; fi
if [ -n "$workflows" ] && [ -z "$loose" ]; then pass "every workflow sets top-level permissions, and the CI workflow is read-only"; else fail "set a top-level permissions: block (contents: read) in every workflow and grant write only to the release job:${loose:- (no workflows found)}"; fi

# 3. Changelog, version and tag.
if g show main:CHANGELOG.md 2> /dev/null | grep_quiet -E "^## \[${version//./\\.}\]"; then pass "CHANGELOG.md has a section for $version"; else fail "CHANGELOG.md needs a \"## [${version:-?}]\" section for the version in package.json"; fi
case "$version" in
  0.*|"") fail "package.json version is ${version:-missing}; release 1.0.0 or later" ;;
  *) pass "package.json version is $version" ;;
esac
tag="v$version"
if [ "$(g cat-file -t "refs/tags/$tag" 2>/dev/null)" != "tag" ]; then
  fail "there is no annotated tag $tag (git tag -a $tag -m \"...\"; a lightweight tag has no author or message)"
elif ! g merge-base --is-ancestor "$tag^{commit}" main; then
  fail "tag $tag points at a commit that is not on main"
elif [ "$(g show "$tag:package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")" != "$version" ]; then
  fail "package.json at tag $tag does not say $version"
else
  pass "annotated tag $tag is on main and matches package.json"
fi

dirty="$(g status --porcelain)"
if [ -z "$dirty" ]; then pass "the working tree is clean"; else fail "uncommitted or untracked changes: $(echo "$dirty" | tr '\n' ' ')"; fi

if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
echo "All criteria pass."
