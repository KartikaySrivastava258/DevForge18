#!/usr/bin/env bash
# Acceptance check for "Reusable infrastructure module".
# Usage: bash check.sh path/to/your/project   (the folder with the root configuration and modules/static-site)
# Needs Docker only: Terraform 1.15.6 runs from the official image (pinned by digest) with this machine's Docker
# socket, on a temporary copy of your folder. First the module is called on its own from a small configuration
# the check writes (its inputs, outputs and validation); then your root configuration is applied with two sites,
# the pages are requested, a site is added and one removed in plans, and everything is destroyed.
# Prints PASS or FAIL per criterion and exits non-zero if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
tf_image="hashicorp/terraform:1.15.6@sha256:adae45661e45d3c88beef071ee1277b4621cea73517aae7f0844657c8e85f641"  # published 2026-06-10
nginx_image="nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"       # published 2025-04-16
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
command -v docker > /dev/null || { fail "docker is not installed"; finish; }
ls "$dir"/*.tf > /dev/null 2>&1 || { fail "no .tf files in $dir"; finish; }
[ -d "$dir/modules/static-site" ] || { fail "the module folder modules/static-site is missing"; finish; }

prefix="dfchk-$$"
p1=$((20000 + $$ % 20000)); p2=$((p1 + 1)); p3=$((p1 + 2))
tmp="$(mktemp -d)"; work="$tmp/work"; probe="$tmp/probe"; mkdir -p "$work" "$probe" "$tmp/plugins" "$tmp/home"
cp -R "$dir/." "$work/"; find "$work" -name .terraform -type d -prune -exec rm -rf {} +; rm -f "$work"/terraform.tfstate*
had_nginx_image=false; docker image inspect "$nginx_image" > /dev/null 2>&1 && had_nginx_image=true
sock=/var/run/docker.sock; case "${DOCKER_HOST:-}" in unix://*) sock="${DOCKER_HOST#unix://}" ;; esac
as_user=(); [ "$(uname -s)" = Linux ] && as_user=(--user "$(id -u):$(id -g)" --group-add "$(stat -c %g "$sock")")
tf_in() {
  local wd="$1"; shift
  docker run --rm "${as_user[@]}" -v "$sock:/var/run/docker.sock" -v "$tmp:$tmp" -w "$wd" \
    -e HOME="$tmp/home" -e TF_PLUGIN_CACHE_DIR="$tmp/plugins" -e TF_IN_AUTOMATION=1 -e TF_INPUT=0 -e CHECKPOINT_DISABLE=1 \
    "$tf_image" "$@"
}
tf() { tf_in "$work" "$@"; }
init_in() {  # provider downloads can fail on a flaky network; try three times
  for _ in 1 2 3; do
    out="$(tf_in "$1" init -input=false -no-color 2>&1)" && return 0
    echo "$out" | grep_quiet "Failed to install provider" || return 1
    sleep 3
  done
  return 1
}
two="{timetable = { port = $p1, title = \"Timetable\" }, library = { port = $p2, title = \"Library\" }}"
three="{timetable = { port = $p1, title = \"Timetable\" }, library = { port = $p2, title = \"Library\" }, exams = { port = $p3, title = \"Exams\" }}"
one="{timetable = { port = $p1, title = \"Timetable\" }}"
applied=false
cleanup() {
  [ "$applied" = true ] && tf destroy -auto-approve -no-color -var "prefix=$prefix" -var "sites=$two" > /dev/null 2>&1
  docker ps -aq --filter "name=^/$prefix-" | xargs -r docker rm -f -v > /dev/null 2>&1
  [ "$had_nginx_image" = false ] && docker rmi "$nginx_image" > /dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
oneline() { grep -E 'Error|error|│ [A-Za-z]' | sed 's/^[│ ]*//' | head -n 3 | tr '\n' ' '; }
because() { echo "$1" | sed 's/^[│ ]*//' | awk '/^var\.[a-z_]+ is /{p=1; next} /^This was checked/{p=0} p' | grep . | tr '\n' ' '; }

# 1. Formatting and validation of the whole tree.
if out="$(tf fmt -check -recursive -no-color 2>&1)"; then pass "terraform fmt -check -recursive: all files are formatted"
else fail "terraform fmt -check lists unformatted files: $(echo "$out" | tr '\n' ' ') — run terraform fmt -recursive"; fi
init_in "$work" || { fail "terraform init fails: $(echo "$out" | oneline)"; finish; }
if out="$(tf validate -no-color 2>&1)"; then pass "terraform validate succeeds"; else fail "terraform validate: $(echo "$out" | oneline)"; finish; fi
if tf providers -no-color 2> /dev/null | grep_quiet -E 'provider\[registry\.terraform\.io/kreuzwerker/docker\] (= )?4\.6\.0$'; then pass "the root module pins kreuzwerker/docker to 4.6.0"
else fail "pin kreuzwerker/docker to exactly 4.6.0 in the root module's required_providers"; fi

# 2. The module on its own: called with the documented inputs, it must offer the documented outputs.
cat > "$probe/main.tf" <<EOF
terraform {
  required_providers {
    docker = { source = "kreuzwerker/docker", version = "4.6.0" }
  }
}
variable "name" {}
variable "port" {}
variable "title" {}
module "probe" {
  source   = "../work/modules/static-site"
  name     = var.name
  port     = var.port
  title    = var.title
  image_id = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
output "url" { value = module.probe.url }
output "container_name" { value = module.probe.container_name }
EOF
init_in "$probe" || { fail "a configuration that calls modules/static-site cannot be initialised: $(echo "$out" | oneline)"; finish; }
if out="$(tf_in "$probe" plan -input=false -no-color -var name=probe-site -var port=$p3 -var title=Probe 2>&1)"; then
  if echo "$out" | grep_quiet "url *= \"http://127.0.0.1:$p3\"" && echo "$out" | grep_quiet 'container_name *= "probe-site"'; then
    pass "the module takes name, port, title and image_id and outputs url (http://127.0.0.1:$p3) and container_name"
  else fail "the module's outputs should be url = \"http://127.0.0.1:<port>\" and container_name = <name> ($(echo "$out" | grep -E '^\s+\+ (url|container_name)' | tr -s ' ' | tr '\n' ' '))"; fi
else
  fail "calling the module with name, port, title and image_id fails: $(echo "$out" | oneline)"; finish
fi
for bad in "name=Bad Name" "port=80" "title= "; do
  name="${bad%%=*}"; args=(-var name=probe-site -var port=$p3 -var title=Probe -var "$bad")
  if out="$(tf_in "$probe" plan -input=false -no-color "${args[@]}" 2>&1)"; then fail "the module accepts $name=\"${bad#*=}\" — add validation to its variable \"$name\""
  elif echo "$out" | grep_quiet "Invalid value for variable" && echo "$out" | grep_quiet "var\.$name"; then pass "the module's validation refuses $name=\"${bad#*=}\": $(because "$out")"
  else fail "$name=\"${bad#*=}\" fails, but not because of validation on the module's variable $name: $(echo "$out" | oneline)"; fi
done

# 3. The root configuration with two sites: apply, then request each page.
vars2=(-var "prefix=$prefix" -var "sites=$two")
if out="$(tf apply -auto-approve -input=false -no-color "${vars2[@]}" 2>&1)"; then applied=true; pass "terraform apply with two sites succeeds"
else applied=true; fail "terraform apply fails: $(echo "$out" | oneline)"; finish; fi
urls="$(tf output -json urls 2> /dev/null | tr -d ' \n')"
if [[ "$urls" == *"\"timetable\":\"http://127.0.0.1:$p1\""* && "$urls" == *"\"library\":\"http://127.0.0.1:$p2\""* ]]; then pass "output urls maps each site to its URL: $urls"
else fail "output urls should map timetable and library to http://127.0.0.1:<port> (got: ${urls:-missing})"; fi
http_get() { (exec 3<> "/dev/tcp/127.0.0.1/$1" && printf 'GET / HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3 && timeout 5 cat <&3) 2> /dev/null; }
for s in "timetable:$p1:Timetable" "library:$p2:Library"; do
  IFS=: read -r key port title <<< "$s"
  page="$(http_get "$port")"
  binding="$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' "$prefix-$key" 2> /dev/null)"
  if echo "$page" | head -n 1 | grep_quiet " 200" && echo "$page" | grep_quiet "<h1>$title</h1>\|<title>$title</title>" && [ "$binding" = "127.0.0.1:$port" ]; then
    pass "container $prefix-$key serves the $title page on 127.0.0.1:$port only"
  else fail "container $prefix-$key should serve a page titled $title on 127.0.0.1:$port only (binding: ${binding:-none}; response: $(echo "$page" | head -n 1 | tr -d '\r'))"; fi
done

# 4. Idempotence, and for_each: adding or removing a site touches only that site.
tf plan -input=false -no-color -detailed-exitcode "${vars2[@]}" > "$tmp/plan.txt" 2>&1; code=$?
if [ "$code" -eq 0 ]; then pass "a second plan shows no changes"
else fail "a second plan should show no changes (exit code $code): $(grep -E '^  # |^Plan:' "$tmp/plan.txt" | head -n 4 | tr '\n' ' ')"; fi
add="$(tf plan -input=false -no-color -var "prefix=$prefix" -var "sites=$three" 2>&1 | grep '^Plan:')"
remove="$(tf plan -input=false -no-color -var "prefix=$prefix" -var "sites=$one" 2>&1 | grep '^Plan:')"
if [ "$add" = "Plan: 1 to add, 0 to change, 0 to destroy." ] && [ "$remove" = "Plan: 0 to add, 0 to change, 1 to destroy." ]; then
  pass "adding a third site plans exactly 1 to add; removing library plans exactly 1 to destroy (sites are keyed, not numbered)"
else fail "adding a site should plan only that site, and removing one only that one — use for_each over var.sites (got: '${add:-no plan}' and '${remove:-no plan}')"; fi

# 5. Destroy.
if out="$(tf destroy -auto-approve -no-color "${vars2[@]}" 2>&1)"; then applied=false; else fail "terraform destroy fails: $(echo "$out" | oneline)"; fi
left="$(docker ps -aq --filter "name=^/$prefix-" | wc -l | tr -d ' ')"
if [ "$left" -eq 0 ] && { [ "$had_nginx_image" = false ] || docker image inspect "$nginx_image" > /dev/null 2>&1; }; then pass "terraform destroy removes both containers and keeps the shared nginx image"
else fail "after destroy $left container(s) remain, or the nginx image that was already on this machine was removed (use keep_locally = true)"; fi
finish
