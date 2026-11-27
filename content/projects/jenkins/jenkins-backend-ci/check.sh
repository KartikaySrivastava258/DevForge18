#!/usr/bin/env bash
# Acceptance check for "Jenkins CI pipeline for a backend".
# Usage: bash check.sh path/to/campus-notes-api
# Needs Docker, Git, curl and Python 3, internet access the first time, and about 3 minutes.
# Starts a real, throwaway Jenkins 2.580.2 (pinned plugins, configured as code) with your folder as a Git
# repository, validates the Jenkinsfile with Jenkins' declarative linter and RUNS it three times: as it is,
# after a commit that breaks a test, and after a commit with a lint problem. Reads results, test reports and
# archived artifacts through Jenkins' JSON API. Prints PASS or FAIL per criterion; exits non-zero on any FAIL.
JOB=campus-notes-api
set -uo pipefail
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
if echo "$lint_out" | grep -q "successfully validated"; then pass "Jenkins' declarative linter accepts the Jenkinsfile"; else fail "Jenkins' declarative linter rejects the Jenkinsfile: $(echo "$lint_out" | head -n 6 | tr '\n' ' ')"; fi

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

# ---- Criteria: Jenkins CI pipeline for a backend --------------------------------------------------------------
jf="$work/repo/Jenkinsfile"
if grep -Eq 'timeout\(' "$jf"; then pass "the pipeline has a timeout"; else fail "add options { timeout(time: …, unit: 'MINUTES') } so a stuck build cannot hold an executor forever"; fi
if grep -Eq "^[^/]*['\"].*npm (install|i)( |'|\"|$)" "$jf"; then fail "install with npm ci, not npm install: CI must use exactly the versions in package-lock.json"; elif grep -q 'npm ci' "$jf"; then pass "dependencies are installed with npm ci"; else fail "install the dependencies with npm ci"; fi

# Build 1: the learner's work as it is.
r1="$(build 1)"
c1="$(console 1)"
if [ "$r1" = SUCCESS ]; then pass "build #1 of your repository succeeds in Jenkins"; else fail "build #1 ended $r1: $(why 1)"; fi
for step in "npm ci" "npm run lint" "npm run test:ci"; do
  echo "$c1" | grep -q "^+ $step" || missing_steps="${missing_steps:-} $step"
done
if [ -z "${missing_steps:-}" ] && echo "$c1" | grep -q '^\[Pipeline\] parallel'; then pass "the build runs npm ci, then lint and the tests in parallel stages"
else fail "the build should run npm ci, then npm run lint and npm run test:ci in parallel stages (missing:${missing_steps:- parallel stages})"; fi
t1="$(tests 1)"
if [ "$t1" != none ] && [ "${t1%% *}" -ge 6 ] && [ "${t1##* }" = 0 ]; then pass "Jenkins shows the test report: ${t1%% *} tests passed"; else fail "publish the JUnit report with junit (Jenkins found: ${t1/none/no test report}; npm run test:ci writes reports/junit.xml)"; fi
a1="$(artifacts 1 | grep -E '\.(tar\.gz|tgz)$' | head -n 1)"
if [ -n "$a1" ]; then
  get "/job/${JOB}/1/artifact/$a1" > "$work/a1.tgz"
  mkdir -p "$work/a1" && tar -xzf "$work/a1.tgz" -C "$work/a1" 2> /dev/null
  info="$(find "$work/a1" -name BUILD_INFO.json | head -n 1)"
  if [ -n "$info" ] && [ -n "$(find "$work/a1" -name server.js)" ] && grep -q "\"$commit\"" "$info" && grep -Eq '"build": "1"' "$info"; then
    pass "build #1 archives $a1 with the server and BUILD_INFO.json (commit ${commit:0:7}, build 1)"
  else fail "the archived $a1 should contain server.js and BUILD_INFO.json with the commit and build number (npm run build writes it from GIT_COMMIT and BUILD_NUMBER)"; fi
else fail "archive the packaged build (a .tar.gz) with archiveArtifacts (archived: $(artifacts 1 | tr '\n' ' '))"; fi

# Build 2: a commit that breaks a test. The build must not succeed, the report must still be published, and
# nothing may be archived.
if [ "$r1" = SUCCESS ]; then
  printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("DevForge: a deliberately failing test", () => assert.equal(1 + 1, 3));\n' > "$work/repo/test/devforge-broken.test.js"
  commit_change "Break a test"
  r2="$(build 2)"
  t2="$(tests 2)"
  if [ "$r2" = SUCCESS ]; then fail "build #2 has a failing test but succeeded: the test result must fail the build (no || true)"
  elif [ "$t2" = none ] || [ "${t2##* }" -lt 1 ]; then fail "build #2 ($r2) did not publish the failing test: run junit in post { always { … } } so the report appears exactly when you need it"
  elif [ -n "$(artifacts 2)" ]; then fail "build #2 had a failing test but still archived $(artifacts 2 | tr '\n' ' '): package only after the tests pass"
  else pass "with a failing test, build #2 is $(echo "$r2" | tr "[:upper:]" "[:lower:]"), its report shows ${t2##* } failure(s), and nothing is archived"; fi
  # Build 3: tests fixed again, but a console.log slipped into src/.
  rm "$work/repo/test/devforge-broken.test.js"
  printf 'export function debug(x) {\n  console.log("debug", x);\n}\n' > "$work/repo/src/devforge-debug.js"
  commit_change "Leave a console.log in"
  r3="$(build 3)"
  if [ "$r3" = FAILURE ]; then pass "with a lint problem, build #3 fails"; else fail "a lint problem should fail the build (build #3 ended $r3)"; fi
else
  fail "the failing-test and lint scenarios run only after build #1 succeeds"
fi
finish
