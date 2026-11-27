#!/usr/bin/env bash
# Acceptance check for "Containerised notes API".
# Usage: bash check.sh path/to/your/project   (the folder with Dockerfile, .dockerignore, server.js)
# Needs Docker and curl. Copies your folder to a temporary place and adds a fake .env and .git with a marker
# value, builds your Dockerfile, and checks the image (base pinned by digest, size, user, no secrets in ENV or
# files) and the build context (what .dockerignore lets through). Then it runs the image with a named volume:
# health and notes through the published port, data after the container is replaced, and how fast and cleanly
# it stops. Removes every container, volume and image it created.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
# Alpine 3.20, as pinned in the Docker lessons, for the build-context probe (tag pushed 2026-04-17).
probe_base="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
id="devforge-check-notes-$$"
image="$id:latest"
probe_image="$id-probe:latest"
volume="$id-data"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/Dockerfile" ] || { fail "$dir/Dockerfile is missing"; finish; }
[ -f "$dir/server.js" ] || { fail "$dir/server.js is missing (keep the API from the starter)"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }

work="$(mktemp -d)"
cleanup() {
  docker ps -aq --filter "label=devforge-check=$id" | xargs -r docker rm -f -v > /dev/null 2>&1
  docker volume rm "$volume" > /dev/null 2>&1
  docker image rm -f "$image" "$probe_image" > /dev/null 2>&1
  rm -rf "$work" "$work.probe.Dockerfile"
}
trap cleanup EXIT

# A copy of the project with secrets a real working folder would have: a .env and Git history.
canary="devforge-canary-$RANDOM$RANDOM"
cp -R "$dir/." "$work/"
printf 'NOTES_ADMIN_TOKEN=%s\n' "$canary" >> "$work/.env"
mkdir -p "$work/.git" && printf '[remote "origin"]\n\turl = https://%s@git.example/notes.git\n' "$canary" > "$work/.git/config"

# --- The Dockerfile and the image ---
# Every FROM must name an image by digest — except scratch and earlier stages of a multi-stage build (FROM build).
froms="$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$work/Dockerfile" | sed -E 's/--platform=[^ ]+ //I')"
stages="$(echo "$froms" | awk 'tolower($3) == "as" { print tolower($4) }')"
unpinned="$(echo "$froms" | awk '{ print $2 }' | while read -r ref; do
  echo "$stages" | grep_quiet -xF "$(echo "$ref" | tr 'A-Z' 'a-z')" && continue
  [ "$ref" = scratch ] && continue
  echo "$ref" | grep_quiet -E '@sha256:[0-9a-f]{64}$' || echo "$ref"
done)"
if [ -n "$froms" ] && [ -z "$unpinned" ]; then pass "every base image is pinned by digest (FROM …@sha256:…)"
else fail "pin every base image by digest, for example FROM node:22.23.5-alpine@sha256:… (not pinned: $(echo "$unpinned" | head -n 1))"; fi

if out="$(docker build -q -t "$image" "$work" 2>&1)"; then pass "the image builds"; else fail "the image does not build: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

size=$(docker image inspect -f '{{.Size}}' "$image")
mb=$((size / 1000000))
if [ "$mb" -lt 300 ]; then pass "the image is small (${mb} MB, limit 300 MB)"; else fail "the image is ${mb} MB; use a small base such as an -alpine or -slim image (limit 300 MB)"; fi

user="$(docker image inspect -f '{{.Config.User}}' "$image")"
if [ -n "$user" ] && [ "$user" != root ] && [ "${user%%:*}" != 0 ]; then pass "the image's default user is not root (USER $user)"
else fail "the image runs as root by default; add USER with an unprivileged user (the node image has one)"; fi

env_secrets="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image" | grep -iE '^[^=]*(TOKEN|PASSWORD|SECRET|KEY)[^=]*=' | cut -d= -f1 | tr '\n' ' ')"
if [ -z "$env_secrets" ]; then pass "no token, password or key is baked into the image's ENV"
else fail "the image's ENV contains $env_secrets— anyone with the image can read it; pass it with docker run -e at run time"; fi

# Search the image's whole filesystem on this machine (docker export), so it works for any image, even one
# without a shell. Positive control first: the marker must be found when it is there.
docker create --name "$id-files" --label "devforge-check=$id" "$image" > /dev/null
docker cp "$work/.env" "$id-files:/devforge-control" > /dev/null 2>&1
# (grep -c reads to the end: with pipefail, grep -q would stop early and fail the pipeline through SIGPIPE.)
found() { docker export "$id-files" | tar -xOf - 2> /dev/null | grep -cF "$canary"; }
if [ "$(found)" -gt 0 ]; then
  docker rm -f -v "$id-files" > /dev/null
  docker create --name "$id-files" --label "devforge-check=$id" "$image" > /dev/null
  names="$(docker export "$id-files" | tar -tf - 2> /dev/null | grep -E '(^|/)\.env$|(^|/)\.git/' | head -n 3 | tr '\n' ' ')"
  if [ "$(found)" = 0 ]; then pass "no file in the image contains the project's .env or .git contents"
  else fail "the image contains the contents of your .env or .git${names:+ ($names)}"; fi
else fail "could not search the image's files (the positive control was not found)"; fi
docker rm -f -v "$id-files" > /dev/null 2>&1

# What the builder receives at all: build a throwaway image that copies the whole context with the same .dockerignore.
printf 'FROM %s\nCOPY . /context/\n' "$probe_base" > "$work.probe.Dockerfile"
if docker build -q -t "$probe_image" -f "$work.probe.Dockerfile" "$work" > /dev/null 2>&1; then
  sent="$(docker run --rm "$probe_image" sh -c 'cd /context && ls -A' | tr '\n' ' ')"
  if [[ " $sent " != *" .env "* && " $sent " != *" .git "* ]]; then pass ".dockerignore keeps .env and .git out of the build context (sent: $sent)"
  else fail ".dockerignore must keep .env and .git out of the build context (the builder received: $sent)"; fi
else fail "could not probe the build context"; fi
rm -f "$work.probe.Dockerfile"

# --- Running it ---
run() { docker run -d --name "$1" --label "devforge-check=$id" -p 127.0.0.1::3000 -v "$volume:/data" -e NOTES_ADMIN_TOKEN=check-token "$image" > /dev/null; }
port_of() { docker port "$1" 3000/tcp 2> /dev/null | head -n 1; }
wait_up() { # CONTAINER — sets $addr
  addr=""
  for _ in $(seq 1 50); do
    addr="$(port_of "$1")"
    [ -n "$addr" ] && curl -s -o /dev/null -m 2 "http://$addr/health" && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2> /dev/null)" = true ] || return 1
    sleep 0.2
  done
  return 1
}
docker volume create --label "devforge-check=$id" "$volume" > /dev/null
run "$id-first"
if ! wait_up "$id-first"; then
  fail "the container does not answer on port 3000: $(docker logs "$id-first" 2>&1 | tail -n 3 | tr '\n' ' ')"
  finish
fi
uid="$(docker exec "$id-first" id -u)"
if [ "$uid" != 0 ]; then pass "the API process runs as an unprivileged user (uid $uid)"; else fail "the API process runs as root (uid 0)"; fi

health="$(curl -s -m 5 -w ' %{http_code}' "http://$addr/health")"
if [ "${health##* }" = 200 ]; then pass "GET /health answers 200 through the published port"
else fail "GET /health should answer 200 through the published port (got: $health)"; fi

note="check note $RANDOM"
created="$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$note\"}" "http://$addr/notes")"
if [ "$created" = 201 ] && [[ "$(curl -s -m 5 "http://$addr/notes")" == *"$note"* ]]; then pass "a note can be created and listed (the data folder is writable by the app's user)"
else fail "POST /notes should answer 201 and the note should be listed (got $created: $(docker logs "$id-first" 2>&1 | grep -m 1 -iE 'EACCES|error'))"; fi

# docker stop: SIGTERM, a 10-second grace period, then SIGKILL.
t0=$(date +%s%N)
docker stop -t 10 "$id-first" > /dev/null
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
code="$(docker inspect -f '{{.State.ExitCode}}' "$id-first")"
if [ "$ms" -lt 5000 ] && [ "$code" = 0 ]; then pass "docker stop ends the API cleanly in under 5 seconds (exit code 0)"
else fail "docker stop should end the API at once with exit code 0 — node must receive SIGTERM (took ${ms} ms, exit code $code; use the exec form CMD [\"node\", \"server.js\"])"; fi

docker rm -f -v "$id-first" > /dev/null
run "$id-second"
if wait_up "$id-second" && [[ "$(curl -s -m 5 "http://$addr/notes")" == *"$note"* ]]; then pass "the note survives replacing the container (the named volume at /data keeps it)"
else fail "after the container was removed and a new one started with the same volume, the note should still be listed"; fi
finish
