#!/usr/bin/env bash
# Acceptance check for "Reproducible development environment".
# Usage: bash check.sh path/to/your/project   (the folder with your .tf files)
# Needs Docker only: Terraform 1.15.6 runs from the official image (pinned by digest) with this machine's Docker
# socket, on a temporary copy of your folder with a project name unique to this run. Runs fmt, init, validate,
# plans with good and bad input, apply, checks the containers, network, outputs and generated file, plans again
# (no changes expected) and destroys. Prints PASS or FAIL per criterion and exits non-zero if any fails.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
tf_image="hashicorp/terraform:1.15.6@sha256:adae45661e45d3c88beef071ee1277b4621cea73517aae7f0844657c8e85f641"  # published 2026-06-10
redis_image="redis:7.4-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe"        # published 2026-11-12
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

project="dfchk-$$"
port=$((20000 + $$ % 20000))
tmp="$(mktemp -d)"; work="$tmp/work"; mkdir -p "$work" "$tmp/plugins" "$tmp/home"
cp -R "$dir/." "$work/"; rm -rf "$work/.terraform" "$work"/terraform.tfstate* "$work/dev.env"
had_redis_image=false; docker image inspect "$redis_image" > /dev/null 2>&1 && had_redis_image=true
sock=/var/run/docker.sock; case "${DOCKER_HOST:-}" in unix://*) sock="${DOCKER_HOST#unix://}" ;; esac
# On Linux run as you (files stay yours) with the socket's group; Docker Desktop maps ownership itself.
as_user=(); [ "$(uname -s)" = Linux ] && as_user=(--user "$(id -u):$(id -g)" --group-add "$(stat -c %g "$sock")")
tf() {
  docker run --rm "${as_user[@]}" -v "$sock:/var/run/docker.sock" -v "$tmp:$tmp" -w "$work" \
    -e HOME="$tmp/home" -e TF_PLUGIN_CACHE_DIR="$tmp/plugins" -e TF_IN_AUTOMATION=1 -e TF_INPUT=0 -e CHECKPOINT_DISABLE=1 \
    "$tf_image" "$@"
}
vars=(-var "project=$project" -var "redis_port=$port")
applied=false
cleanup() {
  [ "$applied" = true ] && tf destroy -auto-approve -no-color "${vars[@]}" > /dev/null 2>&1
  # Belt and braces: everything this run could have created carries the unique project name.
  docker ps -aq --filter "name=^/$project-" | xargs -r docker rm -f -v > /dev/null 2>&1
  docker network ls -q --filter "name=^$project-" | xargs -r docker network rm > /dev/null 2>&1
  [ "$had_redis_image" = false ] && docker rmi "$redis_image" > /dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
oneline() { grep -E 'Error|error|│ [A-Za-z]' | sed 's/^[│ ]*//' | head -n 3 | tr '\n' ' '; }

# 1. Formatting, providers, validation.
if out="$(tf fmt -check -recursive -no-color 2>&1)"; then pass "terraform fmt -check: all files are formatted"
else fail "terraform fmt -check lists unformatted files: $(echo "$out" | tr '\n' ' ') — run terraform fmt"; fi
init_ok=false
for _ in 1 2 3; do  # provider downloads can fail on a flaky network; try three times
  if out="$(tf init -input=false -no-color 2>&1)"; then init_ok=true; break; fi
  echo "$out" | grep -q "Failed to install provider" || break
  sleep 3
done
[ "$init_ok" = true ] || { fail "terraform init fails: $(echo "$out" | oneline)"; finish; }
providers="$(tf providers -no-color 2>/dev/null)"
pinned=true
for p in kreuzwerker/docker hashicorp/local; do
  echo "$providers" | grep -E "provider\[registry\.terraform\.io/$p\] (= )?[0-9]+\.[0-9]+\.[0-9]+$" > /dev/null || pinned=false
done
if [ "$pinned" = true ]; then pass "required_providers pins exact versions of kreuzwerker/docker and hashicorp/local"
else fail "pin exact provider versions in required_providers (kreuzwerker/docker and hashicorp/local); terraform providers shows: $(echo "$providers" | grep provider | tr -s ' ' | tr '\n' ' ')"; fi
if out="$(tf validate -no-color 2>&1)"; then pass "terraform validate succeeds"; else fail "terraform validate: $(echo "$out" | oneline)"; finish; fi

# 2. Input validation: a valid plan first (positive control), then each bad value must be refused by validation.
if out="$(tf plan -input=false -no-color "${vars[@]}" 2>&1)"; then pass "plan succeeds with project=$project and redis_port=$port"
else fail "plan with -var project=… -var redis_port=… fails: $(echo "$out" | oneline)"; finish; fi
for bad in "project=Campus_API" "redis_port=80"; do
  name="${bad%%=*}"; other=(-var "project=$project" -var "redis_port=$port"); [ "$name" = project ] && other=(-var "redis_port=$port") || other=(-var "project=$project")
  if out="$(tf plan -input=false -no-color -var "$bad" "${other[@]}" 2>&1)"; then fail "plan accepts $bad — add a validation block to variable \"$name\""
  elif echo "$out" | grep -q "Invalid value for variable" && echo "$out" | grep -q "var\.$name"; then pass "validation refuses $bad: $(echo "$out" | sed 's/^[│ ]*//' | awk '/^var\.[a-z_]+ is /{p=1; next} /^This was checked/{p=0} p' | grep . | tr '\n' ' ')"
  else fail "plan with $bad fails, but not because of a validation block on var.$name: $(echo "$out" | oneline)"; fi
done

# 3. Apply, and look at what really exists.
if out="$(tf apply -auto-approve -input=false -no-color "${vars[@]}" 2>&1)"; then applied=true; pass "terraform apply succeeds"
else applied=true; fail "terraform apply fails: $(echo "$out" | oneline)"; finish; fi
o() { tf output -raw "$1" 2> /dev/null; }
net="$(o network_name)"; ctr="$(o redis_container)"; url="$(o redis_url)"; envf="$(o env_file)"
if [ "$net" = "$project-dev" ] && [ "$ctr" = "$project-redis" ] && [ "$url" = "redis://127.0.0.1:$port/0" ] && [ -n "$envf" ]; then
  pass "outputs network_name, redis_container, redis_url and env_file have the expected values"
else
  fail "outputs: network_name=${net:-missing} (want $project-dev), redis_container=${ctr:-missing} (want $project-redis), redis_url=${url:-missing} (want redis://127.0.0.1:$port/0), env_file=${envf:-missing}"
fi
state="$(docker inspect -f '{{.State.Running}}|{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{range $p, $b := .HostConfig.PortBindings}}{{$p}}={{range $b}}{{.HostIp}}:{{.HostPort}}{{end}} {{end}}|{{.Image}}' "$project-redis" 2> /dev/null)"
IFS='|' read -r running networks bindings image_id <<< "$state"
if [ "$running" = true ] && [[ " $networks " == *" $project-dev "* ]]; then pass "container $project-redis is running on the network $project-dev"
else fail "container $project-redis should be running and attached to the network $project-dev (running=${running:-no}, networks: ${networks:-none})"; fi
if [ "$(echo "$bindings" | tr -d ' ')" = "6379/tcp=127.0.0.1:$port" ]; then pass "Redis is published on 127.0.0.1:$port only"
else fail "publish Redis's port 6379 on 127.0.0.1:$port only (found: ${bindings:-no published ports})"; fi
if [ -n "$image_id" ] && [ "$image_id" = "$(docker image inspect -f '{{.Id}}' "$redis_image" 2> /dev/null)" ]; then pass "the container runs the pinned image redis:7.4-alpine@sha256:7f7d30b7…"
else fail "the container should run redis:7.4-alpine pinned by digest (sha256:7f7d30b7…)"; fi
reply="$(exec 3<> "/dev/tcp/127.0.0.1/$port" && printf 'PING\r\n' >&3 && timeout 3 head -n 1 <&3 | tr -d '\r')"
if [ "$reply" = "+PONG" ]; then pass "Redis answers PING on 127.0.0.1:$port"; else fail "Redis does not answer on 127.0.0.1:$port (${reply:-no reply})"; fi
env_path="$envf"; case "$env_path" in /*) ;; *) env_path="$work/$env_path" ;; esac
if [ -f "$env_path" ] && grep -qx "REDIS_URL=redis://127.0.0.1:$port/0" "$env_path" && grep -qx "PROJECT=$project" "$env_path"; then pass "the generated $(basename "$env_path") contains PROJECT and the same REDIS_URL"
else fail "the generated settings file should contain the lines PROJECT=$project and REDIS_URL=redis://127.0.0.1:$port/0 ($(cat "$env_path" 2> /dev/null | tr '\n' ' '))"; fi

# 4. Idempotence: a second plan has nothing to do.
tf plan -input=false -no-color -detailed-exitcode "${vars[@]}" > "$tmp/plan2.txt" 2>&1; code=$?
if [ "$code" -eq 0 ]; then pass "a second plan shows no changes"
else fail "a second plan should show no changes (exit code $code): $(grep -E '^  # |^Plan:' "$tmp/plan2.txt" | head -n 4 | tr '\n' ' ')"; fi

# 5. Destroy removes everything it created — and keeps an image other projects may use.
if out="$(tf destroy -auto-approve -no-color "${vars[@]}" 2>&1)"; then applied=false; else fail "terraform destroy fails: $(echo "$out" | oneline)"; fi
left="$(docker ps -aq --filter "name=^/$project-" | wc -l | tr -d ' ')$(docker network ls -q --filter "name=^$project-" | wc -l | tr -d ' ')"
if [ "$left" = 00 ] && [ ! -e "$env_path" ]; then pass "terraform destroy removes the container, the network and the generated file"
else fail "after destroy something is left (containers+networks: $left, settings file present: $([ -e "$env_path" ] && echo yes || echo no))"; fi
if [ "$had_redis_image" = false ] || docker image inspect "$redis_image" > /dev/null 2>&1; then pass "the Redis image is kept after destroy (keep_locally), so other projects are not affected"
else fail "destroy removed the Redis image that was already on this machine — set keep_locally = true on docker_image"; fi
finish
