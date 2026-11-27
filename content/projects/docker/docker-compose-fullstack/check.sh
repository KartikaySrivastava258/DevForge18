#!/usr/bin/env bash
# Acceptance check for "Local full-stack application with Compose".
# Usage: bash check.sh path/to/your/project   (the folder with compose.yaml, api/ and web/)
# Needs Docker with Compose v2, and curl. Reads the resolved configuration (docker compose config) for pinned
# images, published ports, startup conditions and the data volume. If only the web service publishes a port, it
# starts the stack under a unique project name with WEB_PORT set to a free port, uses the app through that port,
# recreates the stack with docker compose down / up and checks the data is still there, then removes the
# project's containers, network, volumes and built images.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: ${1:-.} is not a folder"; exit 1; }
# Node.js 22.23.5 on Alpine, used only to read the JSON configuration (tag pushed 2026-11-12).
node_image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
project="devforge-check-compose-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/compose.yaml" ] || { fail "$dir/compose.yaml is missing"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }
# Compose v2 is often installed per user, in ~/.docker/cli-plugins. A test runner that sets HOME to a temporary
# folder hides it; then look in the account's real home folder.
if ! docker compose version > /dev/null 2>&1; then
  user_home="$(getent passwd "$(id -un)" 2> /dev/null | cut -d: -f6)"
  [ -n "$user_home" ] && [ -x "$user_home/.docker/cli-plugins/docker-compose" ] && export DOCKER_CONFIG="$user_home/.docker"
fi
docker compose version > /dev/null 2>&1 || { fail "this check needs Docker Compose v2 (docker compose version)"; finish; }

# A free port on this machine for WEB_PORT.
for _ in $(seq 1 50); do
  WEB_PORT=$((20000 + RANDOM % 20000))
  (exec 3<> "/dev/tcp/127.0.0.1/$WEB_PORT") 2> /dev/null || break
done
export WEB_PORT
compose() { docker compose -p "$project" -f "$dir/compose.yaml" --project-directory "$dir" "$@"; }
# Volumes attached to this project's containers, recorded before every "down": an anonymous volume left by an
# earlier container is not removed by "down -v" later, so cleanup removes each one by name.
created_volumes=""
note_volumes() {
  local ids
  ids="$(compose ps -a -q 2> /dev/null)"
  [ -n "$ids" ] && created_volumes="$created_volumes $(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' $ids 2> /dev/null)"
}
cleanup() {
  note_volumes
  compose down -v --rmi local --remove-orphans > /dev/null 2>&1
  for v in $created_volumes; do docker volume rm "$v" > /dev/null 2>&1; done
}
trap cleanup EXIT

# --- The configuration, as Compose resolves it ---
if ! config="$(compose config --format json 2> "/dev/null")"; then fail "docker compose config rejects compose.yaml: $(compose config 2>&1 | tail -n 1)"; finish; fi
facts_js='let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const services = JSON.parse(s).services || {}; const out = ["services=" + Object.keys(services).sort().join(",")];
  for (const [n, v] of Object.entries(services)) {
    out.push(`image.${n}=${v.image || ""}`);
    out.push(`build.${n}=${v.build ? v.build.context + "/" + (v.build.dockerfile || "Dockerfile") : ""}`);
    out.push(`ports.${n}=${(v.ports || []).map((p) => `${p.host_ip || "0.0.0.0"}:${p.published || ""}->${p.target}`).join(" ")}`);
    for (const [d, o] of Object.entries(v.depends_on || {})) out.push(`depends.${n}.${d}=${o.condition}`);
    out.push(`volumes.${n}=${(v.volumes || []).map((m) => `${m.type}:${m.source || ""}:${m.target}`).join(" ")}`);
  }
  console.log(out.join("\n"));
});'
facts="$(echo "$config" | docker run --rm -i "$node_image" node -e "$facts_js")" || { fail "could not read the configuration"; finish; }
fact() { echo "$facts" | sed -n "s/^$1=//p" | head -n 1; }

if [ "$(fact services)" = "api,redis,web" ]; then pass "compose.yaml is valid and defines the services web, api and redis"
else fail "compose.yaml should define exactly the services web, api and redis (found: $(fact services))"; fi

unpinned=""
for svc in web redis; do
  img="$(fact "image.$svc")"
  echo "$img" | grep_quiet -E '@sha256:[0-9a-f]{64}$' || unpinned="$unpinned $svc (${img:-no image})"
done
api_dockerfile="$(fact build.api)"
if [ -n "$api_dockerfile" ] && [ -f "$api_dockerfile" ]; then
  [ -n "$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$api_dockerfile" | grep -viE '@sha256:[0-9a-f]{64}')" ] && unpinned="$unpinned api's Dockerfile"
else unpinned="$unpinned api (must be built from ./api)"; fi
if [ -z "$unpinned" ]; then pass "web and redis images, and the api's base image, are pinned by digest"
else fail "pin every image by digest (image: name:tag@sha256:…); not pinned:$unpinned"; fi

ports_ok=1
[ "$(fact ports.web)" = "127.0.0.1:$WEB_PORT->80" ] || ports_ok=0
[ -z "$(fact ports.api)" ] && [ -z "$(fact ports.redis)" ] || ports_ok=0
if [ "$ports_ok" = 1 ]; then pass "only web publishes a port: 127.0.0.1, taken from WEB_PORT"
else fail "only web may publish a port, on 127.0.0.1 and taken from \${WEB_PORT} (with WEB_PORT=$WEB_PORT got web: \"$(fact ports.web)\", api: \"$(fact ports.api)\", redis: \"$(fact ports.redis)\")"; fi

if [ "$(fact depends.api.redis)" = service_healthy ]; then pass "api waits until redis is healthy (depends_on condition: service_healthy)"
else fail "api must wait for redis to be healthy: depends_on redis with condition: service_healthy (got: \"$(fact depends.api.redis)\")"; fi
if [ "$(fact depends.web.api)" = service_healthy ]; then pass "web waits until api is healthy (depends_on condition: service_healthy)"
else fail "web must wait for api to be healthy: depends_on api with condition: service_healthy (got: \"$(fact depends.web.api)\")"; fi

redis_volume="$(fact volumes.redis | tr ' ' '\n' | grep -E '^volume:[^:]+:/data$' | head -n 1)"
if [ -n "$redis_volume" ]; then pass "redis keeps /data in a named volume ($(echo "$redis_volume" | cut -d: -f2))"
else fail "redis must keep /data in a named volume (got: \"$(fact volumes.redis)\")"; fi

if [ "$ports_ok" = 0 ]; then
  echo "Not starting the stack: it would publish ports on fixed or public addresses that may clash with other programs."
  finish
fi

# --- Running it ---
if out="$(compose up -d --build --wait --wait-timeout 120 2>&1)"; then pass "docker compose up --wait starts the stack"
else fail "docker compose up --build --wait failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; compose ps -a; finish; fi

health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no health check{{end}}' "$(compose ps -q "$1")" 2> /dev/null; }
if [ "$(health redis)" = healthy ] && [ "$(health api)" = healthy ]; then pass "redis and api report healthy"
else fail "redis and api should both have a health check that passes (redis: $(health redis), api: $(health api))"; fi

base="http://127.0.0.1:$WEB_PORT"
if [[ "$(curl -s -m 5 "$base/")" == *'<title>Campus Noticeboard</title>'* ]]; then pass "the page is served through web on 127.0.0.1:$WEB_PORT"
else fail "GET / on 127.0.0.1:$WEB_PORT should return the noticeboard page"; fi

title="Check notice $RANDOM"
created="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"title\":\"$title\"}" "$base/api/notices")"
if [ "$created" = 201 ] && [[ "$(curl -s -m 5 "$base/api/notices")" == *"$title"* ]]; then pass "a notice posted through web reaches the API and Redis, and is listed"
else fail "POST /api/notices through web should answer 201 and the notice should be listed (got $created)"; fi

note_volumes
compose down > /dev/null 2>&1
left="$(compose ps -a -q | wc -l | tr -d ' ')"
if out="$(compose up -d --wait --wait-timeout 120 2>&1)" && [ "$left" = 0 ] && [[ "$(curl -s -m 5 "$base/api/notices")" == *"$title"* ]]; then
  pass "after docker compose down and up, the notice is still there (the containers were new; the volume was not)"
else fail "after docker compose down and up again, the notice should still be listed ($( [ "$left" = 0 ] || echo "containers left after down: $left; ")$(echo "$out" | tail -n 1))"; fi
finish
