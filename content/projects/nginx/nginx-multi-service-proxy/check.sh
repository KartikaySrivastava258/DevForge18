#!/usr/bin/env bash
# Acceptance check for "Reverse proxy for a multi-service application".
# Usage: bash check.sh path/to/your/project   (the folder with nginx.conf)
# Needs Docker and curl. Starts four small echo services (web, courses, notices, admin) on a private Docker
# network, tests your nginx.conf with `nginx -t`, runs it in Nginx 1.24 (the version the Nginx lessons use) next to
# them, and sends real HTTP requests: which service answers each host and path, what the service receives (path,
# Host, X-Forwarded-For, X-Forwarded-Proto) and what Nginx sends back. Removes everything it started.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
# Nginx 1.24.0 on Alpine, the version the Nginx lessons were recorded with (tag pushed 2024-04-18).
nginx_image="nginx:1.24.0-alpine@sha256:77e5d4a6ad906c5d3793764085706577fa705b1dc6f244ea0241c4b5e2155385"
# Node.js 22.23.5 on Alpine, for the echo services (tag pushed 2026-11-12).
node_image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
id="devforge-check-ngx-proxy-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/nginx.conf" ] || { fail "$dir/nginx.conf is missing"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }

cleanup() {
  docker ps -aq --filter "label=devforge-check=$id" | xargs -r docker rm -f -v > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
}
trap cleanup EXIT

# The echo service: answers every request on port 8000 with what it received, one "name=value" per line.
echo_js=$(cat <<'EOF'
const http = require("node:http");
const name = process.env.NAME;
http.createServer((req, res) => {
  let bytes = 0;
  req.on("data", (c) => { bytes += c.length; });
  req.on("end", () => {
    const h = req.headers;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end([`service=${name}`, `method=${req.method}`, `uri=${req.url}`, `host=${h.host || ""}`,
      `x-forwarded-for=${h["x-forwarded-for"] || ""}`, `x-forwarded-proto=${h["x-forwarded-proto"] || ""}`,
      `body-bytes=${bytes}`, `peer=${String(req.socket.remoteAddress).replace(/^::ffff:/, "")}`].join("\n") + "\n");
  });
}).listen(8000, () => console.log("ready"));
process.on("SIGTERM", () => process.exit(0));
EOF
)

docker network create --label "devforge-check=$id" "$id" > /dev/null || { fail "could not create a Docker network"; finish; }
for svc in web courses notices admin; do
  docker run -d --name "$id-$svc" --label "devforge-check=$id" --network "$id" --network-alias "$svc" -e NAME="$svc" \
    "$node_image" node -e "$echo_js" > /dev/null || { fail "could not start the $svc service in Docker"; finish; }
done
for svc in web courses notices admin; do
  for _ in $(seq 1 50); do docker logs "$id-$svc" 2>&1 | grep_quiet ready && break; sleep 0.2; done
done

# nginx -t first, in a throwaway container on the same network (so the service names resolve).
docker create --name "$id-test" --label "devforge-check=$id" --network "$id" "$nginx_image" nginx -t > /dev/null
docker cp "$dir/nginx.conf" "$id-test:/etc/nginx/nginx.conf" > /dev/null
if out="$(docker start -a "$id-test" 2>&1)"; then pass "nginx -t accepts nginx.conf"; else fail "nginx -t rejects nginx.conf: $(echo "$out" | grep -m 1 emerg)"; finish; fi

docker create --name "$id-nginx" --label "devforge-check=$id" --network "$id" -p 127.0.0.1::80 "$nginx_image" > /dev/null
docker cp "$dir/nginx.conf" "$id-nginx:/etc/nginx/nginx.conf" > /dev/null
docker start "$id-nginx" > /dev/null
addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"
for _ in $(seq 1 50); do [ -n "$addr" ] && curl -s -o /dev/null -m 2 "http://$addr/" && break; sleep 0.2; addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"; done
if [ -z "$addr" ] || ! curl -s -o /dev/null -m 2 "http://$addr/"; then
  fail "Nginx did not answer on port 80 inside its container: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"
  finish
fi

# get HOST PATH [curl options…] — sets $body and $code.
get() {
  local host="$1" path="$2"; shift 2
  local out
  out="$(curl -s -m 10 -w '\n%{http_code}' -H "Host: $host" "$@" "http://$addr$path")"
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
}
field() { echo "$body" | sed -n "s/^$1=//p" | head -n 1; }
routed() { # DESCRIPTION HOST PATH SERVICE URI
  get "$2" "$3"
  if [ "$code" = 200 ] && [ "$(field service)" = "$4" ] && [ "$(field uri)" = "$5" ]; then pass "$1"
  else fail "$1 (expected the $4 service to receive $5; got HTTP $code${body:+ from $(field service) with $(field uri)})"; fi
}

routed "campus.example / goes to the web service" campus.example / web /
routed "campus.example /timetable (a frontend page) goes to the web service unchanged" campus.example /timetable web /timetable
routed "campus.example /api/courses/42?term=2 goes to the courses service with the path and query unchanged" campus.example "/api/courses/42?term=2" courses "/api/courses/42?term=2"
routed "campus.example /api/notices/ goes to the notices service" campus.example /api/notices/ notices /api/notices/
routed "campus.example /api/notices/latest goes to the notices service" campus.example /api/notices/latest notices /api/notices/latest

get campus.example /api/grades/7
if [ "$code" = 404 ] && [ -z "$(field service)" ]; then pass "an /api/ path with no service behind it gets 404 from Nginx and reaches no service"
else fail "/api/grades/7 should get 404 from Nginx without reaching a service (got HTTP $code${body:+ from $(field service)})"; fi

routed "admin.campus.example / goes to the admin service" admin.campus.example / admin /
routed "admin.campus.example sends every path to the admin service, /api/ included" admin.campus.example /api/courses/1 admin /api/courses/1

get unknown.example /
if [ -z "$(field service)" ] && { [ "$code" = 000 ] || [ "${code:0:1}" = 4 ]; }; then pass "a request for another host name is refused by a default server and reaches no service"
else fail "a request with Host: unknown.example should be refused (404, 444 …) without reaching a service (got HTTP $code${body:+ from $(field service)})"; fi
get "" /api/courses/1 -H "Host;"
if [ -z "$(field service)" ]; then pass "a request with an empty Host header reaches no service"
else fail "a request with an empty Host header should be refused, but the $(field service) service answered"; fi

get campus.example /api/courses/1
if [ "$(field host)" = campus.example ]; then pass "the service receives the original Host header (campus.example)"
else fail "the courses service should receive Host: campus.example, not \"$(field host)\""; fi
xff="$(field x-forwarded-for)"; peer="$(field peer)"
if [[ "$xff" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ "$xff" != "$peer" ]; then pass "the service receives the client's address in X-Forwarded-For ($xff)"
else fail "the service should receive the client's address in X-Forwarded-For (got \"$xff\"; Nginx's own address is $peer)"; fi
get campus.example /api/courses/1 -H "X-Forwarded-For: 203.0.113.7"
if [ -n "$xff" ] && [ "$(field x-forwarded-for)" = "203.0.113.7, $xff" ]; then pass "X-Forwarded-For keeps the addresses of earlier proxies and appends the client's"
else fail "with X-Forwarded-For: 203.0.113.7 from the client, the service should receive \"203.0.113.7, <client address>\" (got \"$(field x-forwarded-for)\")"; fi
get campus.example /api/notices/
if [ "$(field x-forwarded-proto)" = http ]; then pass "the service receives X-Forwarded-Proto: http"
else fail "the notices service should receive X-Forwarded-Proto: http (got \"$(field x-forwarded-proto)\")"; fi
get admin.campus.example /
if [ "$(field host)" = admin.campus.example ] && [ -n "$(field x-forwarded-for)" ] && [ "$(field x-forwarded-proto)" = http ]; then pass "the admin service receives the same forwarding headers"
else fail "the admin service should also receive Host, X-Forwarded-For and X-Forwarded-Proto (got host=\"$(field host)\", x-forwarded-for=\"$(field x-forwarded-for)\", x-forwarded-proto=\"$(field x-forwarded-proto)\")"; fi

server_header="$(curl -s -o /dev/null -D - -m 10 -H "Host: campus.example" "http://$addr/" | tr -d '\r' | sed -n 's/^[Ss]erver: //p')"
if [ "$server_header" = nginx ]; then pass "responses say Server: nginx, without the version number"
else fail "the Server header should be just \"nginx\" (server_tokens off), not \"$server_header\""; fi

if [ "$(docker inspect -f '{{.State.Running}}' "$id-nginx")" = true ]; then pass "Nginx is still running after all requests"
else fail "Nginx stopped during the check: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"; fi
finish
