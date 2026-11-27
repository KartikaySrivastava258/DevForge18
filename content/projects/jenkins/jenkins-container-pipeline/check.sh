#!/usr/bin/env bash
# Acceptance check for "Container build pipeline".
# Usage: bash check.sh path/to/campus-notes-api
# Needs Docker (Linux: your user can use the Docker socket), Git, curl and Python 3, internet access the first
# time, and about 4 minutes.
# Starts a real, throwaway Jenkins 2.580.2 and a private registry (registry:3), and RUNS your Jenkinsfile on
# main and on a feature branch. The pipeline uses your Docker engine through its socket — fine for this
# disposable Jenkins, never for a shared controller. The check then pulls the pushed image by tag, inspects it
# and runs it. Prints PASS or FAIL per criterion; exits non-zero on any FAIL.
JOB=campus-notes-api
# The Docker CLI (docker:29.9.2-cli, pushed 2026-10-22) is added to the check's Jenkins; the builds use your
# Docker engine through its socket. Fine for a Jenkins that lives for three minutes on your machine; on a real
# server, give builds a dedicated agent instead of the controller's socket.
IMAGE_EXTRA='COPY --from=docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx'
sock=/var/run/docker.sock
[ -S "$sock" ] || { echo "FAIL: this check needs the Docker socket at $sock (Docker Engine on Linux, or Docker Desktop's default socket)"; exit 1; }
JENKINS_RUN_EXTRA="-v $sock:/var/run/docker.sock --group-add $(stat -c %g "$sock" 2> /dev/null || stat -f %g "$sock")"
# A private registry (registry:3, released 2026-11-05) that requires a login. The password is a check-only
# placeholder; the line below is its bcrypt hash (made with Python bcrypt 4.3.0), as registry:3's htpasswd needs.
REG_USER=ci-bot
REG_PASSWORD=check-only-registry-password
REG_HTPASSWD='ci-bot:$2b$10$fhk8AmDKUT5w4ZiDKio/buRyAmZGdZtJQI4e5J9BBgWsmiS7rRQ6S'
BEFORE_CASC='
  mkdir -p "$work/auth" && printf "%s\n" "$REG_HTPASSWD" > "$work/auth/htpasswd"
  docker run -d --name "$P-registry" --network "$P-net" -p 127.0.0.1::5000 -v "$work/auth:/auth:ro" \
    -e REGISTRY_AUTH=htpasswd -e REGISTRY_AUTH_HTPASSWD_REALM=check -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
    registry:3@sha256:82f6ff4a7f982960c8aa51617fea3aabc485df6e55cce80d22deb1de36f1bc3c > /dev/null
  REGISTRY="127.0.0.1:$(docker port "$P-registry" 5000/tcp | head -n 1 | sed "s/.*://")"
  for _ in $(seq 1 30); do [ "$(curl -s -o /dev/null -w "%{http_code}" "http://$REGISTRY/v2/")" = 401 ] && break; sleep 1; done
  EXTRA_CLEANUP="docker ps -a --format \"{{.ID}} {{.Image}}\" | grep \" $REGISTRY/\" | cut -d\" \" -f1 | xargs -r docker rm -f -v; docker images --format \"{{.Repository}}:{{.Tag}}\" | grep \"^$REGISTRY/\" | xargs -r docker rmi -f"
  CASC_EXTRA="  globalNodeProperties:
    - envVars:
        env:
          - key: REGISTRY
            value: \"$REGISTRY\"
credentials:
  system:
    domainCredentials:
      - credentials:
          - usernamePassword:
              scope: GLOBAL
              id: registry-push
              username: $REG_USER
              password: \"$REG_PASSWORD\"
              description: Push access to the check registry"
'
JOB_DSL="      multibranchPipelineJob('campus-notes-api') {
        branchSources {
          git {
            id('campus-notes-api')
            remote('file:///repo')
          }
        }
      }"
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
for tool in docker git curl python3; do command -v "$tool" > /dev/null || { echo "FAIL: this check needs $tool"; exit 1; }; done
P="devforge-check-jenkins-$$"
work="$(mktemp -d)"
chmod 755 "$work"  # the containers (other users) read the repository and configuration mounted from here
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
cleanup() {
  docker ps -aq --filter "name=$P" | xargs -r docker rm -f -v > /dev/null 2>&1
  [ -n "${EXTRA_CLEANUP:-}" ] && eval "$EXTRA_CLEANUP" > /dev/null 2>&1
  docker rmi -f "$P-image" > /dev/null 2>&1
  docker network rm "$P-net" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
json() { python3 -c 'import json, sys
try:
    d = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        d = d[int(k)] if isinstance(d, list) else d.get(k)
    print("" if d is None else (json.dumps(d) if isinstance(d, (dict, list)) else d))
except Exception:
    print("")' "$1"; }

[ -f "$dir/Jenkinsfile" ] || { fail "there is no Jenkinsfile in $dir"; finish; }

# The learner's folder becomes a Git repository (branch main), which Jenkins checks out like any SCM.
mkdir -p "$work/repo" "$work/image" "$work/casc"
tar -C "$dir" --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./reports -cf - . | tar -C "$work/repo" -xf -
g() { git -C "$work/repo" -c user.name="DevForge check" -c user.email="check@devforge.example" "$@"; }
g init -q -b main && g add -A && g commit -q -m "Learner's work" || { fail "could not create a Git repository from $dir"; finish; }
commit="$(g rev-parse HEAD)"

# Jenkins 2.580.2 LTS (image published 2026-10-28) with pinned plugins — the lessons' versions, plus junit
# 1456.vdb_4425ca_0d4d (released 2026-11-01) for test reports. Node.js 24 (node:24.22.2-bookworm-slim, published
# 2026-11-05) is copied in as the build tool, the way a Node.js tool installation or agent image would provide it.
cat > "$work/image/plugins.txt" << 'EOF'
workflow-aggregator:608.v67378e9d3db_1
configuration-as-code:2148.v9d0c041b_a_13c
job-dsl:3732.v9a_c49a_61a_313
git:5.11.0
junit:1456.vdb_4425ca_0d4d
EOF
cat > "$work/image/Dockerfile" << 'EOF'
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS node
FROM jenkins/jenkins:2.580.2-lts-jdk21@sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && git config --system --add safe.directory '*'
EOF
[ -n "${IMAGE_EXTRA:-}" ] && printf '%s\n' "$IMAGE_EXTRA" >> "$work/image/Dockerfile"
cat >> "$work/image/Dockerfile" << 'EOF'
USER jenkins
COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
# The check's Jenkins clones the repository from a local folder (file:///repo); the Git plugin refuses that
# by default, which is right for a shared server and unnecessary for this throwaway one.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true" \
    CASC_JENKINS_CONFIG=/var/jenkins_home/casc
EOF
echo "Building the check's Jenkins image (about a minute; plugins are downloaded the first time)..." >&2
if ! docker build -q -t "$P-image" "$work/image" > "$work/build.log" 2>&1; then
  fail "could not build the Jenkins image: $(tail -n 5 "$work/build.log" | tr '\n' ' ')"
  finish
fi

ADMIN_PASSWORD="check-only-$(date +%s)$$"
docker network create "$P-net" > /dev/null
[ -n "${BEFORE_CASC:-}" ] && eval "$BEFORE_CASC"
if [ -z "${JOB_DSL:-}" ]; then
  JOB_DSL="$(cat << EOF
      pipelineJob('${JOB:-pipeline}') {
        definition {
          cpsScm {
            scm {
              git {
                remote { url('file:///repo') }
                branch('*/main')
              }
            }
            scriptPath('Jenkinsfile')
          }
        }
      }
EOF
)"
fi
cat > "$work/casc/jenkins.yaml" << EOF
jenkins:
  systemMessage: "DevForge check"
  numExecutors: 2
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: \${ADMIN_PASSWORD}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
${CASC_EXTRA:-}
jobs:
  - script: >
${JOB_DSL}
EOF
docker run -d --name "$P-jenkins" --network "$P-net" -p 127.0.0.1::8080 -e ADMIN_PASSWORD="$ADMIN_PASSWORD" ${JENKINS_RUN_EXTRA:-} \
  -v "$work/casc:/var/jenkins_home/casc:ro" -v "$work/repo:/repo:ro" "$P-image" > /dev/null || { fail "Jenkins did not start"; finish; }
J="http://$(docker port "$P-jenkins" 8080/tcp | head -n 1)"
A="admin:$ADMIN_PASSWORD"
ready=""
for _ in $(seq 1 150); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/job/${JOB:-pipeline}/api/json")" = 200 ]; then ready=1; break; fi
  sleep 2
done
[ -n "$ready" ] || { fail "Jenkins did not become ready within 5 minutes: $(docker logs "$P-jenkins" 2>&1 | grep -iE 'severe|error' | tail -n 3 | tr '\n' ' ')"; finish; }
crumb="$(curl -s -c "$work/cookies" -u "$A" "$J/crumbIssuer/api/json" | python3 -c 'import json, sys; c = json.load(sys.stdin); print(c["crumbRequestField"] + ":" + c["crumb"])')"
post() { curl -s -b "$work/cookies" -H "$crumb" -u "$A" -X POST "$@"; }
get() { curl -sg -u "$A" "$J$1"; }

# Jenkins' own declarative linter (pipeline-model-definition), the same validation a build does first.
lint_out="$(post -F "jenkinsfile=<$work/repo/Jenkinsfile" "$J/pipeline-model-converter/validate")"
if echo "$lint_out" | grep_quiet "successfully validated"; then pass "Jenkins' declarative linter accepts the Jenkinsfile"; else fail "Jenkins' declarative linter rejects the Jenkinsfile: $(echo "$lint_out" | head -n 6 | tr '\n' ' ')"; fi

# Runs the job and waits for its result; prints the result (SUCCESS, UNSTABLE, FAILURE, ABORTED or TIMEOUT).
build() { # <number> [parameters as name=value ...]
  local n="$1" result=""
  if [ "$#" -gt 1 ]; then shift; local args=(); for kv in "$@"; do args+=(--data-urlencode "$kv"); done; post "${args[@]}" "$J/job/${JOB:-pipeline}/buildWithParameters" > /dev/null
  else post "$J/job/${JOB:-pipeline}/build" > /dev/null; fi
  for _ in $(seq 1 150); do
    # Finished means "building" is false; a result can be set while post actions still run.
    state="$(get "/job/${JOB:-pipeline}/$n/api/json?tree=result,building" | python3 -c 'import json, sys
try:
    d = json.load(sys.stdin); print(d["result"] if d.get("result") and not d.get("building") else "")
except Exception:
    print("")')"
    [ -n "$state" ] && { result="$state"; break; }
    [ -n "${ON_WAIT:-}" ] && eval "$ON_WAIT"
    sleep 2
  done
  echo "${result:-TIMEOUT}"
}
finished() { # <job path, e.g. /job/x/job/main/1>: the result once the build has finished, else empty
  get "$1/api/json?tree=result,building" | python3 -c 'import json, sys
try:
    d = json.load(sys.stdin); print(d["result"] if d.get("result") and not d.get("building") else "")
except Exception:
    print("")'
}
console() { get "/job/${JOB:-pipeline}/$1/consoleText"; }
artifacts() { get "/job/${JOB:-pipeline}/$1/api/json?tree=artifacts[relativePath]" | python3 -c 'import json, sys; [print(a["relativePath"]) for a in json.load(sys.stdin).get("artifacts", [])]' 2> /dev/null; }
tests() { get "/job/${JOB:-pipeline}/$1/testReport/api/json?tree=passCount,failCount,skipCount" | python3 -c 'import json, sys; d = json.load(sys.stdin); print(d["passCount"], d["failCount"])' 2> /dev/null || echo "none"; }
# A short excerpt of why a build failed: error lines from the console.
why() { console "$1" | grep -E 'ERROR|error|FAIL|not ok|Exception|script returned exit code' | grep -v '^\[Pipeline\]' | head -n 4 | tr '\n' ' ' | cut -c1-400; }
commit_change() { # <message> — commits whatever was changed in $work/repo
  g add -A && g commit -q -m "$1"
}

# ---- Criteria: Container build pipeline -----------------------------------------------------------------------
reg() { curl -s -u "$REG_USER:$REG_PASSWORD" "$@"; }
ACCEPT='Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json'
digest_of() { reg -I -H "$ACCEPT" "http://$REGISTRY/v2/campus-notes-api/manifests/$1" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'; }
tags() { reg "http://$REGISTRY/v2/campus-notes-api/tags/list" | json tags | tr -d '[]" ' | tr ',' '\n'; }
branch_result() { # <branch> <build number>: waits for that branch build to finish
  local result=""
  for _ in $(seq 1 150); do
    result="$(finished "/job/$JOB/job/$1/$2")"
    [ -n "$result" ] && break
    sleep 2
  done
  echo "${result:-TIMEOUT}"
}
bconsole() { get "/job/$JOB/job/$1/$2/consoleText"; }
scan() { post "$J/job/$JOB/build?delay=0" > /dev/null; }

froms="$(grep -iE '^FROM ' "$work/repo/Dockerfile" 2> /dev/null)"
if [ -z "$froms" ]; then fail "there is no Dockerfile"
elif echo "$froms" | grep_quiet -vi '@sha256:[0-9a-f]\{64\}'; then fail "pin every base image by digest (FROM image:tag@sha256:…), so a rebuild of the same commit uses the same base: $(echo "$froms" | grep -vi '@sha256:' | head -n 1)"
else pass "every base image in the Dockerfile is pinned by digest"; fi

# A feature branch next to main; both are discovered and built by the multibranch job.
main_commit="$commit"
g checkout -q -b feature-search && echo "Search is planned." >> "$work/repo/README.md" && commit_change "Plan search" && feature_commit="$(g rev-parse HEAD)" && g checkout -q main
scan
rm_=$(branch_result main 1); rf=$(branch_result feature-search 1)
cm="$(bconsole main 1)"; cf="$(bconsole feature-search 1)"
short="${main_commit:0:7}"
if [ "$rm_" = SUCCESS ]; then pass "the main branch builds successfully (build #1)"; else fail "main build #1 ended $rm_: $(echo "$cm" | grep -E 'ERROR|error|denied|script returned exit code' | head -n 4 | tr '\n' ' ' | cut -c1-400)"; fi
order="$(echo "$cm" | grep -nE '^\+ (npm run test:ci|npm test|docker build)' | cut -d: -f2- | tr '\n' '|')"
case "$order" in
  *"npm run test:ci"*"docker build"*) pass "the tests run (and are reported) before the image is built" ;;
  *) fail "run npm run test:ci before docker build, so an untested commit never becomes an image (order seen: ${order:-none})" ;;
esac
if [ "$(get "/job/$JOB/job/main/1/testReport/api/json?tree=passCount" | json passCount)" != "" ]; then pass "main build #1 publishes the JUnit test report"; else fail "publish the test report with junit (npm run test:ci writes reports/junit.xml)"; fi

d_sha="$(digest_of "sha-$short")"; d_main="$(digest_of main)"
if [ -n "$d_sha" ] && [ "$d_sha" = "$d_main" ]; then pass "the registry has campus-notes-api:sha-$short and :main, one image (${d_sha:0:19}…)"
else fail "after main build #1 the registry should hold campus-notes-api:sha-$short and :main pointing to the same image (tags found: $(tags | tr '\n' ' '))"; fi

if [ -n "$d_sha" ]; then
  manifest="$(reg -H "$ACCEPT" "http://$REGISTRY/v2/campus-notes-api/manifests/$d_sha")"
  # An image index (several platforms) points to a manifest per platform: take the first.
  inner="$(echo "$manifest" | json manifests.0.digest)"
  [ -n "$inner" ] && manifest="$(reg -H "$ACCEPT" "http://$REGISTRY/v2/campus-notes-api/manifests/$inner")"
  cfg="$(reg "http://$REGISTRY/v2/campus-notes-api/blobs/$(echo "$manifest" | json config.digest)")"
  user="$(echo "$cfg" | json config.User)"; health="$(echo "$cfg" | json config.Healthcheck.Test)"
  rev="$(echo "$cfg" | python3 -c 'import json, sys; print((json.load(sys.stdin).get("config", {}).get("Labels") or {}).get("org.opencontainers.image.revision", ""))' 2> /dev/null)"
  if [ -n "$user" ] && [ "$user" != root ] && [ "$user" != 0 ] && [ "${user%%:*}" != 0 ]; then pass "the image runs as an unprivileged user ($user)"; else fail "the image runs as root: add a USER (the Node.js images have a user called node)"; fi
  if [ "$rev" = "$main_commit" ]; then pass "the image's org.opencontainers.image.revision label is the commit it was built from"; else fail "label the image with org.opencontainers.image.revision = the full commit (GIT_COMMIT); found: ${rev:-none}"; fi
  if [ -n "$health" ] && [ "$health" != "[\"NONE\"]" ]; then
    export DOCKER_CONFIG="$work/docker-config"; mkdir -p "$DOCKER_CONFIG"
    echo "$REG_PASSWORD" | docker login "$REGISTRY" -u "$REG_USER" --password-stdin > /dev/null 2>&1
    docker pull -q "$REGISTRY/campus-notes-api:sha-$short" > /dev/null 2>&1
    docker run -d --name "$P-app" "$REGISTRY/campus-notes-api:sha-$short" > /dev/null 2>&1
    state=""
    for _ in $(seq 1 40); do state="$(docker inspect --format '{{.State.Health.Status}}' "$P-app" 2> /dev/null)"; [ "$state" = healthy ] && break; sleep 1; done
    body="$(docker exec "$P-app" node -e "fetch('http://127.0.0.1:3000/health').then((r) => r.text()).then(console.log)" 2> /dev/null)"
    leftovers="$(docker exec "$P-app" sh -c 'ls -d /app/test /app/node_modules/.cache /app/Jenkinsfile 2> /dev/null')"
    if [ "$state" = healthy ] && echo "$body" | grep_quiet '"ok"'; then pass "the pushed image starts, its HEALTHCHECK reports healthy and /health answers ok"
    else fail "the pushed image should become healthy and answer /health (health: ${state:-none}; logs: $(docker logs "$P-app" 2>&1 | tail -n 2 | tr '\n' ' '))"; fi
    if [ -z "$leftovers" ]; then pass "the image contains the application, not the tests or the Jenkinsfile (.dockerignore)"; else fail "keep tests and CI files out of the image (found: $(echo "$leftovers" | tr '\n' ' '))"; fi
    docker logout "$REGISTRY" > /dev/null 2>&1; unset DOCKER_CONFIG
  else
    fail "the image has no HEALTHCHECK, so neither the smoke test nor an orchestrator can tell when it is ready"
  fi
fi

# Credentials: in Jenkins only, never on a command line, never through Groovy, not left behind.
leak=""
echo "$cm" | grep_quiet -- "--password via the CLI is insecure" && leak="$leak docker login -p (use --password-stdin);"
echo "$cm" | grep_quiet "Groovy String interpolation" && leak="$leak a secret passed to sh through Groovy string interpolation (use single quotes);"
echo "$cm$cf" | grep_quiet "$REG_PASSWORD" && leak="$leak the password appears in the console;"
grep -q "$REG_PASSWORD" "$work/repo/Jenkinsfile" && leak="$leak the password is written in the Jenkinsfile;"
if [ "$rm_" != SUCCESS ]; then fail "the credential handling can only be judged on a successful main build"
elif [ -n "$leak" ]; then fail "registry credentials:$leak"
elif ! echo "$cm" | grep_quiet "^+ docker login"; then fail "log in to the registry with the Jenkins credential registry-push (withCredentials and docker login --password-stdin)"
else pass "the registry password comes from the Jenkins credential, through --password-stdin, and never appears in the log"; fi
dockercfg="$(docker exec "$P-jenkins" cat /var/jenkins_home/.docker/config.json 2> /dev/null)"
if echo "$dockercfg" | grep_quiet "$REGISTRY"; then fail "the build left a registry login behind in Jenkins' ~/.docker/config.json: docker logout in post { always { … } }"; else pass "no registry login is left behind on the agent"; fi
left="$(docker ps -a --format '{{.Names}} {{.Image}}' | grep " $REGISTRY/" | grep -v "^$P-")"
if [ -z "$left" ]; then pass "no smoke-test container is left running"; else fail "the pipeline left containers behind: $(echo "$left" | tr '\n' ' ')"; fi

# The feature branch is built and tested, but not pushed.
if [ "$rf" = SUCCESS ] && ! tags | grep_quiet -x "sha-${feature_commit:0:7}" && [ "$(digest_of main)" = "$d_main" ]; then pass "the feature branch builds and tests the image but pushes nothing"
elif [ "$rf" != SUCCESS ]; then fail "the feature-search branch should build successfully (it ended $rf)"
else fail "the feature-search branch pushed to the registry: push only from main (when { branch 'main' })"; fi

# A failing test on main: no image may reach the registry.
if [ "$rm_" = SUCCESS ]; then
  printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("DevForge: a deliberately failing test", () => assert.equal(1 + 1, 3));\n' > "$work/repo/test/devforge-broken.test.js"
  commit_change "Break a test"
  broken="$(g rev-parse HEAD)"
  scan
  r2="$(branch_result main 2)"
  if [ "$r2" != SUCCESS ] && ! tags | grep_quiet -x "sha-${broken:0:7}" && [ "$(digest_of main)" = "$d_main" ]; then pass "with a failing test, main build #2 is $(echo "$r2" | tr "[:upper:]" "[:lower:]") and nothing new is pushed"
  else fail "with a failing test, main build #2 ended $r2 and the registry has: $(tags | tr '\n' ' ') — failing tests must stop the pipeline before docker build and push"; fi
else
  fail "the failing-test scenario runs only after main build #1 succeeds"
fi
finish
