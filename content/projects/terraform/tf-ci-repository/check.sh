#!/usr/bin/env bash
# Acceptance check for "CI-validated infrastructure repository".
# Usage: bash check.sh path/to/your/repository   (the folder with infra/, .github/workflows/ and .gitignore)
# Needs Docker only. Terraform 1.15.6 (and git) run from the official hashicorp/terraform image, actionlint from
# its official image, both pinned by digest. Checks repository hygiene, the committed lock file, formatting,
# validation, terraform test, input validation, plan/apply/plan/destroy on a temporary copy, and the CI workflow
# (actionlint, triggers, permissions, SHA-pinned actions, the Terraform steps). Prints PASS or FAIL per criterion.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
tf_image="hashicorp/terraform:1.15.6@sha256:adae45661e45d3c88beef071ee1277b4621cea73517aae7f0844657c8e85f641"        # published 2026-06-10
actionlint_image="rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"  # published 2026-03-30
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
command -v docker > /dev/null || { fail "docker is not installed"; finish; }
ls "$dir"/infra/*.tf > /dev/null 2>&1 || { fail "no .tf files in infra/"; finish; }

tmp="$(mktemp -d)"; repo="$tmp/repo"; work="$repo/infra"; mkdir -p "$repo" "$tmp/plugins" "$tmp/home"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM
cp -R "$dir/." "$repo/"
as_user=(); [ "$(uname -s)" = Linux ] && as_user=(--user "$(id -u):$(id -g)")
run_in() {  # run_in DIR ENTRYPOINT ARGS... — inside the Terraform image (it also contains git)
  local wd="$1" ep="$2"; shift 2
  docker run --rm "${as_user[@]}" -v "$tmp:$tmp" -w "$wd" --entrypoint "$ep" \
    -e HOME="$tmp/home" -e TF_PLUGIN_CACHE_DIR="$tmp/plugins" -e TF_IN_AUTOMATION=1 -e TF_INPUT=0 -e CHECKPOINT_DISABLE=1 \
    -e GIT_CONFIG_NOSYSTEM=1 "$tf_image" "$@"
}
tf() { run_in "$work" terraform "$@"; }
oneline() { grep -E 'Error|error|│ [A-Za-z]' | sed 's/^[│ ]*//' | head -n 3 | tr '\n' ' '; }

# 1. Repository hygiene: nothing generated or secret committed; .gitignore keeps it that way, but keeps the lock file.
junk="$(cd "$dir" && find . \( -name '*.tfstate' -o -name '*.tfstate.*' -o -name tfplan -o -name '*.tfplan' \) -type f -print -o -name .terraform -type d -print -prune | sed 's#^\./##' | tr '\n' ' ')"
if [ -z "$junk" ]; then pass "no state files, saved plans or .terraform/ folders are in the repository"
else fail "remove files that must never be committed (state and plans can hold secrets in plain text): $junk"; fi
find "$repo" \( -name '*.tfstate' -o -name '*.tfstate.*' -o -name tfplan \) -type f -delete; find "$repo" -name .terraform -type d -prune -exec rm -rf {} +
run_in "$repo" git init -q > /dev/null 2>&1
ignored() { run_in "$repo" git check-ignore -q --no-index "$1" > /dev/null 2>&1; }
if ignored infra/.terraform/providers/x && ignored infra/terraform.tfstate && ignored infra/terraform.tfstate.backup && ! ignored infra/.terraform.lock.hcl; then
  pass ".gitignore ignores .terraform/ and state files, and does not ignore .terraform.lock.hcl"
else fail ".gitignore must ignore .terraform/, *.tfstate and *.tfstate.* — but not .terraform.lock.hcl"; fi
rm -rf "$repo/.git"

# 2. Formatting, the committed lock file, validation.
if out="$(run_in "$repo" terraform fmt -check -recursive -no-color 2>&1)"; then pass "terraform fmt -check -recursive: all files are formatted"
else fail "terraform fmt -check lists unformatted files: $(echo "$out" | tr '\n' ' ')"; fi
lock="$work/.terraform.lock.hcl"
if [ ! -f "$lock" ]; then fail "infra/.terraform.lock.hcl is not committed — run terraform init (or terraform providers lock) and commit it"
else
  version="$(sed -n '/hashicorp\/local/,/}/s/^ *version *= *"\(.*\)"/\1/p' "$lock" | head -n 1)"
  h1="$(sed -n '/hashicorp\/local/,/^}/p' "$lock" | grep -c '"h1:')"
  if [ "$version" = 2.9.1 ] && [ "$h1" -ge 3 ]; then pass "the lock file pins hashicorp/local 2.9.1 with h1 hashes for $h1 platforms"
  else fail "the lock file should record hashicorp/local 2.9.1 with h1 hashes for Linux, macOS and Windows — terraform providers lock -platform=… (found version ${version:-none}, $h1 h1 hash(es))"; fi
fi
init_ok=false
for _ in 1 2 3; do  # provider downloads can fail on a flaky network; try three times
  if out="$(tf init -input=false -no-color -lockfile=readonly 2>&1)"; then init_ok=true; break; fi
  echo "$out" | grep -q "Failed to install provider\|could not query provider" || break
  sleep 3
done
if [ "$init_ok" = true ]; then pass "terraform init -lockfile=readonly succeeds: the downloaded provider matches the committed checksums"
else
  fail "terraform init -lockfile=readonly fails — the lock file is missing, out of date or does not match: $(echo "$out" | oneline)"
  tf init -input=false -no-color -upgrade > /dev/null 2>&1 || { fail "terraform init -upgrade fails too"; finish; }  # carry on with the other criteria
fi
if out="$(tf validate -no-color 2>&1)"; then pass "terraform validate succeeds"; else fail "terraform validate: $(echo "$out" | oneline)"; fi

# 3. terraform test, including tests that bad input is refused.
out="$(tf test -no-color 2>&1)"; summary="$(echo "$out" | grep -E '^(Success|Failure)!' | tail -n 1)"
passed="$(echo "$summary" | sed -n 's/^Success! \([0-9]*\) passed, 0 failed.*/\1/p')"
expects="$(cat "$work"/tests/*.tftest.hcl 2> /dev/null | grep -c 'expect_failures')"
if [ "${passed:-0}" -ge 3 ] && [ "$expects" -ge 1 ]; then pass "terraform test: $summary (with $expects run(s) that expect validation to fail)"
elif [ -n "$passed" ]; then fail "terraform test passes ($summary) but needs at least 3 runs, at least one with expect_failures"
else fail "terraform test does not pass: ${summary:-no tests found in infra/tests/*.tftest.hcl} $(echo "$out" | grep -E 'run "|Error:' | head -n 4 | tr '\n' ' ')"; fi

# 4. Input validation (a valid plan first), then apply, idempotence and destroy on the temporary copy.
if out="$(tf plan -input=false -no-color -var environment=staging 2>&1)"; then pass "plan succeeds with environment=staging"
else fail "plan with -var environment=staging fails: $(echo "$out" | oneline)"; finish; fi
if out="$(tf plan -input=false -no-color -var environment=qa 2>&1)"; then fail "plan accepts environment=qa — validate var.environment (dev, staging, prod)"
elif echo "$out" | grep -q "Invalid value for variable" && echo "$out" | grep -q 'var\.environment'; then pass "validation refuses environment=qa"
else fail "environment=qa fails, but not because of validation on var.environment: $(echo "$out" | oneline)"; fi
if out="$(tf apply -auto-approve -input=false -no-color -var environment=staging 2>&1)"; then
  files="$(tf output -json config_files 2> /dev/null | tr -d ' \n')"
  ok=true
  for svc in timetable library; do
    f="$work/out/staging/$svc.json"
    [ -f "$f" ] && grep -q "\"environment\":\"staging\"" "$f" && [[ "$files" == *"\"$svc\":"*"out/staging/$svc.json\""* ]] || ok=false
  done
  if [ "$ok" = true ]; then pass "apply renders out/staging/timetable.json and library.json, and the output config_files lists them"
  else fail "apply should render out/staging/<service>.json for timetable and library and list them in the output config_files (got: ${files:-no output})"; fi
  tf plan -input=false -no-color -detailed-exitcode -var environment=staging > "$tmp/plan2.txt" 2>&1; code=$?
  if [ "$code" -eq 0 ]; then pass "a second plan shows no changes"; else fail "a second plan should show no changes (exit code $code): $(grep -E '^  # |^Plan:' "$tmp/plan2.txt" | head -n 3 | tr '\n' ' ')"; fi
  if tf destroy -auto-approve -no-color -var environment=staging > /dev/null 2>&1 && [ -z "$(find "$work/out" -type f 2> /dev/null)" ]; then pass "terraform destroy removes the rendered files"
  else fail "terraform destroy should remove every rendered file"; fi
else fail "terraform apply fails: $(echo "$out" | oneline)"; fi

# 5. The CI workflow.
wfs="$(cd "$dir" && ls .github/workflows/*.yml .github/workflows/*.yaml 2> /dev/null)"
if [ -z "$wfs" ]; then fail "no workflow in .github/workflows/"; finish; fi
# shellcheck disable=SC2086
if out="$(docker run --rm "${as_user[@]}" -v "$dir:/repo:ro" -w /repo "$actionlint_image" -oneline $wfs 2>&1)"; then pass "actionlint finds no problems in $(echo $wfs)"
else fail "actionlint: $(echo "$out" | head -n 4 | tr '\n' ' ')"; fi
all="$(cd "$dir" && cat $wfs)"
code_only="$(echo "$all" | sed 's/#.*$//')"
if echo "$code_only" | grep -Eq '^ *pull_request(_target)?:|^on: *\[?.*pull_request'; then pass "the workflow runs on pull requests"
else fail "run the workflow on pull_request, so every change is checked before it is merged"; fi
unpinned="$(echo "$code_only" | grep -E '^ *-? *uses:' | sed 's/.*uses: *//; s/["'"'"']//g' | grep -v '^\./' | grep -Ev '@[0-9a-f]{40} *$' | tr '\n' ' ')"
uses="$(echo "$code_only" | grep -cE '^ *-? *uses:')"
if [ "$uses" -gt 0 ] && [ -z "$unpinned" ]; then pass "all $uses actions are pinned to full commit SHAs"
else fail "pin every action to a full 40-character commit SHA (with the version in a comment): ${unpinned:-no actions used}"; fi
perms="$(echo "$code_only" | grep -E '^ *(permissions: *write-all|[a-z-]+: *write) *$' | tr -s ' ' | tr '\n' ' ')"
if echo "$code_only" | grep -Eq '^permissions:' && echo "$code_only" | grep -Eq '^ *contents: *read' && [ -z "$perms" ]; then pass "the token is read-only (permissions: contents: read)"
else fail "set top-level permissions to contents: read and grant nothing more (found: ${perms:-no permissions block})"; fi
missing=""
echo "$code_only" | grep -q 'terraform fmt -check' || missing="$missing fmt-check"
echo "$code_only" | grep -q 'terraform init.*-lockfile=readonly' || missing="$missing init-lockfile=readonly"
echo "$code_only" | grep -q 'terraform validate' || missing="$missing validate"
echo "$code_only" | grep -q 'terraform test' || missing="$missing test"
echo "$code_only" | grep -q 'terraform plan' || missing="$missing plan"
echo "$code_only" | grep -Eq 'terraform_version: *"?1\.15\.6"?|hashicorp/terraform:1\.15\.6' || missing="$missing terraform-1.15.6"
if [ -z "$missing" ]; then pass "the workflow runs Terraform 1.15.6: fmt -check, init -lockfile=readonly, validate, test and plan"
else fail "the workflow is missing:$missing"; fi
if echo "$code_only" | grep -Eq 'terraform apply.*-auto-approve|terraform apply *$'; then fail "the workflow applies without a reviewed saved plan — pull requests only plan"
else pass "the workflow never runs terraform apply -auto-approve"; fi
finish
