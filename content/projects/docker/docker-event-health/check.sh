#!/usr/bin/env bash
# Acceptance check for "Multi-service event application with health checks".
# Usage: bash check.sh path/to/your/project   (the folder with compose.yaml, Dockerfile, .dockerignore and app/)
# Needs Docker with Compose v2, and curl. Copies your folder to a temporary place and writes a random API key to
# secrets/api_key.txt there. Reads the resolved configuration for pinned images, published ports and startup
# conditions; if only the api publishes a port, starts the stack under a unique project name with API_PORT set to
# a free port and checks it while it runs: health of every service, hardening of api and worker, the API key
# (accepted, and nowhere in the environment or the image), events processed, events queued while the worker is
# stopped, a clean worker shutdown, and the api's health following Redis down and back up. Removes the project's
# containers, network, volumes and built images.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: ${1:-.} is not a folder"; exit 1; }
# Node.js 22.23.5 on Alpine, used only to read the JSON configuration (tag pushed 2026-11-12).
node_image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
# Alpine 3.20, as pinned in the Docker lessons, for the build-context probe (tag pushed 2026-04-17).
probe_base="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
project="devforge-check-events-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$src/compose.yaml" ] || { fail "$src/compose.yaml is missing"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }
# Compose v2 is often installed per user, in ~/.docker/cli-plugins. A test runner that sets HOME to a temporary
# folder hides it; then look in the account's real home folder.
if ! docker compose version > /dev/null 2>&1; then
  user_home="$(getent passwd "$(id -un)" 2> /dev/null | cut -d: -f6)"
  [ -n "$user_home" ] && [ -x "$user_home/.docker/cli-plugins/docker-compose" ] && export DOCKER_CONFIG="$user_home/.docker"
fi
docker compose version > /dev/null 2>&1 || { fail "this check needs Docker Compose v2 (docker compose version)"; finish; }

# Work on a copy, with a fresh random API key where compose.yaml is expected to read it.
dir="$(mktemp -d)"
cp -R "$src/." "$dir/"
api_key="check-key-$RANDOM$RANDOM$RANDOM$RANDOM"
mkdir -p "$dir/secrets" && printf '%s\n' "$api_key" > "$dir/secrets/api_key.txt" && chmod 644 "$dir/secrets/api_key.txt"

for _ in $(seq 1 50); do
  API_PORT=$((20000 + RANDOM % 20000))
  (exec 3<> "/dev/tcp/127.0.0.1/$API_PORT") 2> /dev/null || break
done
export API_PORT
compose() { docker compose -p "$project" -f "$dir/compose.yaml" --project-directory "$dir" "$@"; }
# Volumes attached to this project's containers are recorded, so cleanup also removes anonymous ones.
created_volumes=""
note_volumes() {
  local ids
  ids="$(compose ps -a -q 2> /dev/null)"
  [ -n "$ids" ] && created_volumes="$created_volumes $(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' $ids 2> /dev/null)"
}
cleanup() {
  note_volumes
  docker rm -f -v "$project-files" > /dev/null 2>&1
  docker image rm -f "$project-probe:latest" > /dev/null 2>&1
  compose down -v --rmi local --remove-orphans > /dev/null 2>&1
  for v in $created_volumes; do docker volume rm "$v" > /dev/null 2>&1; done
  rm -rf "$dir" "$dir.probe.Dockerfile"
}
trap cleanup EXIT

# --- The configuration, as Compose resolves it ---
if ! config="$(compose config --format json 2> /dev/null)"; then fail "docker compose config rejects compose.yaml: $(compose config 2>&1 | tail -n 1)"; finish; fi
facts_js='let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const services = JSON.parse(s).services || {}; const out = ["services=" + Object.keys(services).sort().join(",")];
  for (const [n, v] of Object.entries(services)) {
    out.push(`image.${n}=${v.image || ""}`);
    out.push(`build.${n}=${v.build ? v.build.context + "/" + (v.build.dockerfile || "Dockerfile") : ""}`);
    out.push(`ports.${n}=${(v.ports || []).map((p) => `${p.host_ip || "0.0.0.0"}:${p.published || ""}->${p.target}`).join(" ")}`);
    for (const [d, o] of Object.entries(v.depends_on || {})) out.push(`depends.${n}.${d}=${o.condition}`);
  }
  console.log(out.join("\n"));
});'
facts="$(echo "$config" | docker run --rm -i "$node_image" node -e "$facts_js")" || { fail "could not read the configuration"; finish; }
fact() { echo "$facts" | sed -n "s/^$1=//p" | head -n 1; }

if [ "$(fact services)" = "api,redis,worker" ]; then pass "compose.yaml is valid and defines the services api, worker and redis"
else fail "compose.yaml should define exactly the services api, worker and redis (found: $(fact services))"; fi

unpinned=""
img="$(fact image.redis)"
[[ "$img" =~ @sha256:[0-9a-f]{64}$ ]] || unpinned="$unpinned; redis (${img:-no image})"
for svc in api worker; do
  dockerfile="$(fact "build.$svc")"
  if [ -n "$dockerfile" ] && [ -f "$dockerfile" ]; then
    [ -n "$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$dockerfile" | grep -viE '@sha256:[0-9a-f]{64}')" ] && unpinned="$unpinned; the Dockerfile ($svc)"
  else unpinned="$unpinned; $svc (must be built from the Dockerfile)"; fi
done
if [ -z "$unpinned" ]; then pass "the redis image and the Dockerfile's base image are pinned by digest"
else fail "pin every image by digest (name:tag@sha256:…); not pinned: ${unpinned#; }"; fi

ports_ok=1
[ "$(fact ports.api)" = "127.0.0.1:$API_PORT->3000" ] || ports_ok=0
[ -z "$(fact ports.worker)" ] && [ -z "$(fact ports.redis)" ] || ports_ok=0
if [ "$ports_ok" = 1 ]; then pass "only api publishes a port: 127.0.0.1, taken from API_PORT"
else fail "only api may publish a port, on 127.0.0.1 and taken from \${API_PORT} (with API_PORT=$API_PORT got api: \"$(fact ports.api)\", worker: \"$(fact ports.worker)\", redis: \"$(fact ports.redis)\")"; fi

if [ "$(fact depends.api.redis)" = service_healthy ] && [ "$(fact depends.worker.redis)" = service_healthy ]; then pass "api and worker wait until redis is healthy (condition: service_healthy)"
else fail "api and worker must wait for redis with depends_on condition: service_healthy (api: \"$(fact depends.api.redis)\", worker: \"$(fact depends.worker.redis)\")"; fi

if [ "$ports_ok" = 0 ]; then
  echo "Not starting the stack: it would publish ports on fixed or public addresses that may clash with other programs."
  finish
fi

# --- Running it ---
if out="$(compose up -d --build --wait --wait-timeout 120 2>&1)"; then pass "docker compose up --wait starts the stack"
else fail "docker compose up --build --wait failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

cid() { compose ps -a -q "$1"; }
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no health check{{end}}' "$(cid "$1")" 2> /dev/null; }
if [ "$(health api)" = healthy ] && [ "$(health worker)" = healthy ] && [ "$(health redis)" = healthy ]; then pass "api, worker and redis all have health checks and report healthy"
else fail "every service needs a health check that passes (api: $(health api), worker: $(health worker), redis: $(health redis))"; fi

# Hardening of the two application containers.
hc() { docker inspect -f "$2" "$(cid "$1")"; }
bad_user=""; bad_ro=""; bad_caps=""; bad_mem=""; bad_logs=""
for svc in api worker; do
  [ "$(docker exec "$(cid "$svc")" id -u 2> /dev/null)" = 0 ] && bad_user="$bad_user $svc"
  if [ "$(hc "$svc" '{{.HostConfig.ReadonlyRootfs}}')" != true ] || docker exec "$(cid "$svc")" sh -c 'echo x > /app/.devforge-write-test' 2> /dev/null; then bad_ro="$bad_ro $svc"; fi
  [[ "$(hc "$svc" '{{.HostConfig.CapDrop}}')" == *ALL* && "$(hc "$svc" '{{.HostConfig.SecurityOpt}}')" == *no-new-privileges* ]] || bad_caps="$bad_caps $svc"
  [ "$(hc "$svc" '{{.HostConfig.Memory}}')" -gt 0 ] || bad_mem="$bad_mem $svc"
  [[ "$(hc "$svc" '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}}')" =~ ^json-file\ [0-9]+[kmg]?$ ]] || bad_logs="$bad_logs $svc"
done
if [ -z "$bad_user" ]; then pass "api and worker run as an unprivileged user"; else fail "these run as root (uid 0):$bad_user"; fi
if [ -z "$bad_ro" ]; then pass "api and worker have a read-only root filesystem (writing to /app fails)"; else fail "give these a read-only root filesystem (read_only: true, with a tmpfs where the app must write):$bad_ro"; fi
if [ -z "$bad_caps" ]; then pass "api and worker drop all capabilities and set no-new-privileges"; else fail "these need cap_drop: [ALL] and security_opt: [no-new-privileges:true]:$bad_caps"; fi
if [ -z "$bad_mem" ]; then pass "api and worker have a memory limit"; else fail "set a memory limit (mem_limit) for:$bad_mem"; fi
if [ -z "$bad_logs" ]; then pass "api and worker rotate their logs (json-file with max-size)"; else fail "rotate the logs (logging: json-file with max-size) of:$bad_logs"; fi

# The API key: accepted from secrets/api_key.txt, nowhere in the environment or the image.
base="http://127.0.0.1:$API_PORT"
post() { curl -s -m 5 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' "$@" -d '{"type":"room-booking","payload":{"room":"LT-2"}}' "$base/events"; }
no_key="$(post | tail -n 1)"
wrong_key="$(post -H 'Authorization: Bearer wrong-key' | tail -n 1)"
reply="$(post -H "Authorization: Bearer $api_key")"
event_id="$(echo "$reply" | sed -n 's/.*"id":"\([0-9a-f-]*\)".*/\1/p')"
if [ "$no_key" = 401 ] && [ "$wrong_key" = 401 ] && [ "$(echo "$reply" | tail -n 1)" = 202 ] && [ -n "$event_id" ]; then pass "POST /events needs the key from secrets/api_key.txt (202 with it, 401 without or with a wrong one)"
else fail "POST /events should answer 202 with the key from secrets/api_key.txt and 401 otherwise (no key: $no_key, wrong key: $wrong_key, right key: $(echo "$reply" | tail -n 1))"; fi
in_env=""
for svc in api worker redis; do
  [[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(cid "$svc")")" == *"$api_key"* ]] && in_env="$in_env $svc"
done
# Search every file of the api image (docker export). Positive control: worker.js's queue name must be found.
api_image="$(hc api '{{.Image}}')"
docker create --name "$project-files" "$api_image" > /dev/null 2>&1
count_in_image() { docker export "$project-files" 2> /dev/null | tar -xOf - 2> /dev/null | grep -cF "$1"; }
control="$(count_in_image 'events:queue')"
in_image="$(count_in_image "$api_key")"
docker rm -f -v "$project-files" > /dev/null 2>&1
if [ "${control:-0}" = 0 ]; then fail "could not search the image's files (the positive control was not found)"
elif [ -z "$in_env" ] && [ "${in_image:-0}" = 0 ]; then pass "the API key is in no container's environment and in no file of the image"
else fail "the API key must not be in the environment or the image (environment of:${in_env:- none}; lines in the image's files: ${in_image:-?})"; fi

# What the builder receives: a throwaway build that copies the whole context, with the same .dockerignore.
probe_image="$project-probe:latest"
printf 'FROM %s\nCOPY . /context/\n' "$probe_base" > "$dir.probe.Dockerfile"
if docker build -q -t "$probe_image" -f "$dir.probe.Dockerfile" "$dir" > /dev/null 2>&1; then
  sent="$(docker run --rm "$probe_image" sh -c 'cd /context && ls -A' | tr '\n' ' ')"
  if [[ " $sent " != *" secrets "* ]]; then pass ".dockerignore keeps secrets/ out of the build context (sent: $sent)"
  else fail ".dockerignore must keep secrets/ out of the build context (the builder received: $sent)"; fi
else fail "could not probe the build context"; fi
docker image rm -f "$probe_image" > /dev/null 2>&1
rm -f "$dir.probe.Dockerfile"

# Events are processed in the background.
status_of() { curl -s -m 5 "$base/events/$1" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p'; }
wait_status() { for _ in $(seq 1 40); do [ "$(status_of "$1")" = "$2" ] && return 0; sleep 0.25; done; return 1; }
if [ -n "$event_id" ] && wait_status "$event_id" processed; then pass "the worker processes a posted event within 10 seconds"
else fail "a posted event should be processed by the worker within 10 seconds (status: $( [ -n "$event_id" ] && status_of "$event_id"))"; fi

# The worker stops cleanly, and events wait in the queue while it is away.
t0=$(date +%s%N)
compose stop worker > /dev/null 2>&1
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
code="$(hc worker '{{.State.ExitCode}}')"
if [ "$ms" -lt 5000 ] && [ "$code" = 0 ]; then pass "docker compose stop worker ends it cleanly in under 5 seconds (exit code 0)"
else fail "stopping the worker should take under 5 seconds and exit with 0 — it must receive SIGTERM itself (took ${ms} ms, exit code $code)"; fi
queued_id="$(post -H "Authorization: Bearer $api_key" | sed -n 's/.*"id":"\([0-9a-f-]*\)".*/\1/p')"
sleep 2
queued_status="$(status_of "$queued_id")"
compose start worker > /dev/null 2>&1
if [ -n "$queued_id" ] && [ "$queued_status" = queued ] && wait_status "$queued_id" processed; then pass "an event posted while the worker was stopped waits in the queue and is processed when it is back"
else fail "an event posted while the worker is stopped should stay queued, then be processed when it starts again (status while stopped: ${queued_status:-?}, after: $(status_of "$queued_id"))"; fi

# The api's health follows Redis.
compose stop redis > /dev/null 2>&1
for _ in $(seq 1 60); do [ "$(health api)" = unhealthy ] && break; sleep 0.5; done
if [ "$(health api)" = unhealthy ]; then pass "with redis stopped, api reports unhealthy within 30 seconds"
else fail "with redis stopped, api's health check should fail (it must test /health, which needs Redis); after 30 s it is: $(health api)"; fi
compose start redis > /dev/null 2>&1
for _ in $(seq 1 60); do [ "$(health api)" = healthy ] && break; sleep 0.5; done
if [ "$(health api)" = healthy ]; then pass "when redis is back, api reports healthy again without a restart"
else fail "when redis is back, api should become healthy again (after 30 s it is: $(health api))"; fi
finish
