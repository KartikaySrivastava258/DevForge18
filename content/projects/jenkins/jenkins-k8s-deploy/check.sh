#!/usr/bin/env bash
# Acceptance check for "Jenkins + Kubernetes deployment lab".
# Usage: bash check.sh path/to/campus-notes-api
# Needs Docker, Git, curl and Python 3, internet access the first time, and about 4 minutes.
# Starts a throwaway Jenkins 2.580.2 and a Kubernetes control plane without nodes (etcd, kube-apiserver and
# kube-controller-manager v1.36.1); a small loop in this script plays the kubelet. RUNS your Jenkinsfile:
# deploy to staging, an approval, production, and a release whose pods never become ready, which must be
# rolled back. Prints PASS or FAIL per criterion; exits non-zero on any FAIL.
JOB=campus-notes-api
command -v openssl > /dev/null || { echo "FAIL: this check needs openssl (to make the cluster's service-account key)"; exit 1; }
# kubectl v1.36.1 (registry.k8s.io/kubectl, published 2026-05-12) is added to the check's Jenkins, behind a
# wrapper that records each command's arguments (so the check can see the order of dry runs and applies).
IMAGE_EXTRA="$(cat << 'EOF'
COPY --from=registry.k8s.io/kubectl:v1.36.1@sha256:d08f476d04d0e30f426f06bc6ff6c38913aaa4591943046b77e2f74a72d3611c /bin/kubectl /usr/local/lib/kubectl-real
RUN printf '%s\n' '#!/bin/sh' 'echo "$*" >> /tmp/kubectl-calls.log' 'exec /usr/local/lib/kubectl-real "$@"' > /usr/local/bin/kubectl && chmod 755 /usr/local/bin/kubectl
EOF
)"
# A Kubernetes control plane without nodes: etcd 3.6.16 (published 2026-10-23), kube-apiserver and
# kube-controller-manager v1.36.1 (published 2026-05-12). The API server validates and stores everything and the
# controllers run Deployments and ReplicaSets for real; no container is ever started. A small Python loop
# (kubelet.py below) plays the kubelet: it marks each pod Ready, except pods whose image is listed as broken,
# which it reports as ErrImagePull — so rollouts, rollout status and rollout undo behave as in a cluster.
ETCD_IMAGE=registry.k8s.io/etcd:3.6.16-0@sha256:b29d816b546a1966fe7034a33b34e231fa98c47ce4d2883f70b0555020b22132
APISERVER_IMAGE=registry.k8s.io/kube-apiserver:v1.36.1@sha256:2460df74307cafacf674573c88df511aeb1aece9daa7fbd968fe27cb1c8c4588
CM_IMAGE=registry.k8s.io/kube-controller-manager:v1.36.1@sha256:c8adb8daee5b30576bd87638a89351ab8388b3fda466bedb7eacf10cde77dbe7
REGISTRY_NAME=registry.campus.example
BEFORE_CASC='
  mkdir -p "$work/kube" && chmod 755 "$work/kube"
  openssl genrsa -out "$work/kube/sa.key" 2048 2> /dev/null && openssl rsa -in "$work/kube/sa.key" -pubout -out "$work/kube/sa.pub" 2> /dev/null
  chmod 644 "$work/kube/sa.key"
  KTOKEN="check-only-$(od -An -N12 -tx1 /dev/urandom | tr -d " \n")"
  echo "$KTOKEN,jenkins-deployer,jenkins-deployer,system:masters" > "$work/kube/tokens.csv"
  printf "%s\n" "apiVersion: v1" "kind: Config" "clusters:" "  - name: campus" "    cluster:" "      server: https://$P-api:6443" \
    "      insecure-skip-tls-verify: true" "users:" "  - name: jenkins-deployer" "    user:" "      token: $KTOKEN" "contexts:" \
    "  - name: campus" "    context:" "      cluster: campus" "      user: jenkins-deployer" "current-context: campus" > "$work/kube/kubeconfig"
  chmod 644 "$work/kube/kubeconfig"
  docker run -d --name "$P-etcd" --network "$P-net" "$ETCD_IMAGE" etcd --data-dir=/tmp/etcd \
    --listen-client-urls=http://0.0.0.0:2379 --advertise-client-urls="http://$P-etcd:2379" > /dev/null
  docker run -d --name "$P-api" --network "$P-net" -p 127.0.0.1::6443 -v "$work/kube:/k:ro" "$APISERVER_IMAGE" kube-apiserver \
    --etcd-servers="http://$P-etcd:2379" --service-account-issuer=https://kubernetes.default.svc.cluster.local \
    --service-account-key-file=/k/sa.pub --service-account-signing-key-file=/k/sa.key --token-auth-file=/k/tokens.csv \
    --authorization-mode=RBAC --cert-dir=/tmp/certs --secure-port=6443 --service-cluster-ip-range=10.96.0.0/16 > /dev/null
  docker run -d --name "$P-cm" --network "$P-net" -v "$work/kube:/k:ro" "$CM_IMAGE" kube-controller-manager --kubeconfig=/k/kubeconfig \
    --service-account-private-key-file=/k/sa.key --leader-elect=false > /dev/null
  KPORT="$(docker port "$P-api" 6443/tcp | head -n 1 | sed "s/.*://")"
  for _ in $(seq 1 60); do curl -sk -H "Authorization: Bearer $KTOKEN" "https://127.0.0.1:$KPORT/readyz" | grep -q "^ok" && break; sleep 1; done
  for ns in staging production; do
    curl -sk -o /dev/null -H "Authorization: Bearer $KTOKEN" -H "Content-Type: application/json" -X POST \
      -d "{\"apiVersion\":\"v1\",\"kind\":\"Namespace\",\"metadata\":{\"name\":\"$ns\"}}" "https://127.0.0.1:$KPORT/api/v1/namespaces"
  done
  : > "$work/kube/broken-images"
  cat > "$work/kubelet.py" << "PY"
import datetime, json, ssl, sys, time, urllib.request
base, token, broken_file = sys.argv[1:4]
tls = ssl._create_unverified_context()
def call(method, path, body=None, ctype="application/json"):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": ctype})
    with urllib.request.urlopen(req, context=tls, timeout=10) as r:
        return json.load(r)
while True:
    try:
        broken = set(open(broken_file).read().split())
        for pod in call("GET", "/api/v1/pods")["items"]:
            meta, spec, status = pod["metadata"], pod["spec"], pod.get("status", {})
            if meta.get("deletionTimestamp"):
                continue
            bad = any(c["image"] in broken for c in spec["containers"])
            ready = any(c["type"] == "Ready" and c["status"] == "True" for c in status.get("conditions", []))
            if (bad and status.get("containerStatuses")) or (not bad and ready):
                continue
            now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            cond = lambda t, s: {"type": t, "status": s, "lastTransitionTime": now}
            if bad:
                new = {"phase": "Pending", "conditions": [cond("PodScheduled", "True"), cond("Ready", "False"), cond("ContainersReady", "False")],
                       "containerStatuses": [{"name": c["name"], "image": c["image"], "imageID": "", "ready": False, "started": False, "restartCount": 0,
                                              "state": {"waiting": {"reason": "ErrImagePull", "message": "simulated by the DevForge check"}}} for c in spec["containers"]]}
            else:
                new = {"phase": "Running", "conditions": [cond(t, "True") for t in ("PodScheduled", "Initialized", "ContainersReady", "Ready")],
                       "containerStatuses": [{"name": c["name"], "image": c["image"], "imageID": "", "ready": True, "started": True, "restartCount": 0,
                                              "state": {"running": {"startedAt": now}}} for c in spec["containers"]]}
            call("PATCH", "/api/v1/namespaces/%s/pods/%s/status" % (meta["namespace"], meta["name"]), {"status": new}, "application/merge-patch+json")
    except Exception as err:
        print("kubelet.py:", err, file=sys.stderr)
    time.sleep(1)
PY
  python3 "$work/kubelet.py" "https://127.0.0.1:$KPORT" "$KTOKEN" "$work/kube/broken-images" 2> "$work/kubelet.log" &
  KUBELET_PID=$!
  EXTRA_CLEANUP="kill $KUBELET_PID"
  JENKINS_RUN_EXTRA="-v $work/kube/kubeconfig:/run/kube/kubeconfig:ro"
  CASC_EXTRA="  globalNodeProperties:
    - envVars:
        env:
          - key: REGISTRY
            value: \"$REGISTRY_NAME\"
credentials:
  system:
    domainCredentials:
      - credentials:
          - file:
              scope: GLOBAL
              id: kubeconfig
              fileName: kubeconfig
              secretBytes: \"\${readFileBase64:/run/kube/kubeconfig}\"
              description: Deploys to the staging and production namespaces"
'
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

# ---- Criteria: Jenkins + Kubernetes deployment lab ----------------------------------------------------------
kget() { curl -sk -H "Authorization: Bearer $KTOKEN" "https://127.0.0.1:$KPORT$1"; }
deployment() { kget "/apis/apps/v1/namespaces/$1/deployments/campus-notes-api"; }
# Prints "<image> <ready>" for a namespace's Deployment: ready is yes when the rollout is complete.
state() { deployment "$1" | python3 -c 'import json, sys
try:
    d = json.load(sys.stdin); s = d.get("status", {}); want = d["spec"].get("replicas", 1)
    done = s.get("observedGeneration", 0) >= d["metadata"]["generation"] and s.get("updatedReplicas", 0) == want and s.get("availableReplicas", 0) == want and s.get("replicas", 0) == want
    print(d["spec"]["template"]["spec"]["containers"][0]["image"], "yes" if done else "no")
except Exception:
    print("none no")'; }
image_for() { echo "$REGISTRY_NAME/campus-notes-api:sha-${1:0:7}"; }
start() { post "$J/job/$JOB/build" > /dev/null; }
# Waits until build <n> waits for the approval (prints "input") or has finished (prints its result).
wait_input_or_end() {
  local r=""
  for _ in $(seq 1 150); do
    r="$(finished "/job/$JOB/$1")"
    [ -n "$r" ] && { echo "$r"; return; }
    [ "$(curl -sg -o /dev/null -w '%{http_code}' -u "$A" "$J/job/$JOB/$1/input/Promote/")" = 200 ] && { echo input; return; }
    sleep 2
  done
  echo TIMEOUT
}
wait_end() { local r=""; for _ in $(seq 1 150); do r="$(finished "/job/$JOB/$1")"; [ -n "$r" ] && break; sleep 2; done; echo "${r:-TIMEOUT}"; }

jf="$work/repo/Jenkinsfile"
if grep -q "$KTOKEN" "$jf" || grep -Eq -- '--token|insecure-skip-tls-verify' "$jf"; then fail "no cluster token or TLS shortcut in the Jenkinsfile: use the Jenkins credential kubeconfig (withCredentials file)"
else pass "the Jenkinsfile contains no cluster credentials"; fi

# Build 1: commit A. Staging first; production only after the approval.
img_a="$(image_for "$commit")"
start
s1="$(wait_input_or_end 1)"
if [ "$s1" = input ]; then
  read -r st_img st_ready <<< "$(state staging)"
  read -r pr_img _ <<< "$(state production)"
  if [ "$st_img" = "$img_a" ] && [ "$st_ready" = yes ]; then pass "build #1 deploys $img_a to staging and the rollout completes before anyone is asked"
  else fail "before the approval, staging should run $img_a with a completed rollout (it runs: $st_img, rolled out: $st_ready)"; fi
  if [ "$pr_img" = none ]; then pass "production is untouched while the approval is pending"; else fail "production was changed before the approval (it runs $pr_img)"; fi
  post "$J/job/$JOB/1/input/Promote/proceedEmpty" > /dev/null
  r1="$(wait_end 1)"
else
  r1="$s1"
  fail "build #1 ended $r1 without waiting for an approval before production: use an input step with id 'Promote'$( [ "$r1" != SUCCESS ] && echo " — $(why 1)")"
fi
read -r pr_img pr_ready <<< "$(state production)"
if [ "$r1" = SUCCESS ] && [ "$pr_img" = "$img_a" ] && [ "$pr_ready" = yes ]; then pass "after the approval, build #1 succeeds and production runs the same image, fully rolled out"
else fail "after the approval, build #1 should succeed with production running $img_a (build: $r1; production: $pr_img, rolled out: $pr_ready)"; fi
# The order of kubectl commands (recorded by the check's kubectl wrapper): a server-side dry run (or kubectl
# diff) must come before the first real apply in each namespace.
docker exec "$P-jenkins" cat /tmp/kubectl-calls.log > "$work/kubectl-calls.log" 2> /dev/null
unvalidated=""
for ns in staging production; do
  order="$(grep -E "(^| )(-n|--namespace)[ =]$ns( |$)|^.*apply .*$ns" "$work/kubectl-calls.log" | grep -E '^(apply|diff)' | sed -E 's/^(apply|diff).*--dry-run=server.*/check/; s/^diff.*/check/; s/^apply.*/apply/' | tr '\n' ' ')"
  case "$order" in check*apply*) ;; *) unvalidated="$unvalidated $ns(${order:-no apply})" ;; esac
done
if [ -z "$unvalidated" ]; then pass "in both namespaces the manifests are validated by the API server (server-side dry run) before they are applied"
else fail "validate the rendered manifests against the cluster before applying them (kubectl apply --dry-run=server): order seen:$unvalidated"; fi
console 1 | grep -q "$KTOKEN" && fail "the cluster token appears in the console log"

# What was deployed: read the Deployment and Service back from the API server.
deployment production > "$work/deploy.json"
kget "/api/v1/namespaces/production/services/campus-notes-api" > "$work/service.json"
python3 - "$work/deploy.json" "$work/service.json" << 'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try:
    d = json.load(open(sys.argv[1])); spec = d["spec"]; pod = spec["template"]["spec"]; c = pod["containers"][0]
except Exception:
    print("FAIL: there is no Deployment campus-notes-api in production to inspect"); sys.exit(1)
(ok if spec.get("replicas", 1) >= 2 else bad)(f"production runs {spec.get('replicas', 1)} replicas" + ("" if spec.get("replicas", 1) >= 2 else ": use at least 2, so one pod can fail or be replaced without downtime"))
probe = (c.get("readinessProbe") or {}).get("httpGet") or {}
if probe.get("path") == "/health" and str(probe.get("port")) in ("3000", "http"): ok("a readiness probe on /health decides when a pod gets traffic")
else: bad("add a readinessProbe (httpGet /health, port 3000): without it a pod counts as ready the moment it starts")
res = c.get("resources") or {}
if all(k in res.get(s, {}) for s in ("requests", "limits") for k in ("cpu", "memory")): ok("CPU and memory requests and limits are set")
else: bad("set resources.requests and resources.limits for cpu and memory")
non_root = (pod.get("securityContext") or {}).get("runAsNonRoot") or (c.get("securityContext") or {}).get("runAsNonRoot")
(ok if non_root else bad)("the pod must run as non-root (securityContext.runAsNonRoot: true)" if not non_root else "the pod is required to run as non-root (runAsNonRoot)")
try:
    s = json.load(open(sys.argv[2]))["spec"]
    labels = spec["template"]["metadata"].get("labels", {})
    sel = s.get("selector") or {}
    port = s["ports"][0]
    if sel and all(labels.get(k) == v for k, v in sel.items()) and str(port.get("targetPort")) in ("3000", "http"):
        ok("the Service campus-notes-api selects the Deployment's pods and forwards to port 3000")
    else:
        bad(f"the Service must select the pods' labels and target port 3000 (selector {sel}, targetPort {port.get('targetPort')})")
except Exception:
    bad("there is no Service campus-notes-api in production")
sys.exit(fails)
PY

# Build 2: commit B, whose image never becomes ready. Staging must be rolled back; production untouched.
if [ "$r1" = SUCCESS ]; then
  echo "Release notes: B" >> "$work/repo/README.md"; commit_change "Release B"; commit_b="$(g rev-parse HEAD)"
  image_for "$commit_b" > "$work/kube/broken-images"
  start
  s2="$(wait_input_or_end 2)"
  if [ "$s2" = input ]; then
    post "$J/job/$JOB/2/input/Promote/abort" > /dev/null; wait_end 2 > /dev/null
    fail "build #2's pods never became ready, yet the pipeline asked to promote it: wait for the rollout (kubectl rollout status) and stop if it fails"
  else
    read -r st_img st_ready <<< "$(state staging)"
    read -r pr_img _ <<< "$(state production)"
    if [ "$s2" = FAILURE ] && [ "$st_img" = "$img_a" ] && [ "$st_ready" = yes ] && [ "$pr_img" = "$img_a" ]; then
      pass "a release whose pods never become ready fails build #2, staging is rolled back to $img_a, and production is untouched"
    else fail "with pods that never become ready, build #2 should fail and roll staging back (build: $s2; staging: $st_img, rolled out: $st_ready; production: $pr_img)"; fi
  fi
  : > "$work/kube/broken-images"
  # Build 3: commit C is fine, but the reviewer says no.
  echo "Release notes: C" >> "$work/repo/README.md"; commit_change "Release C"
  start
  s3="$(wait_input_or_end 3)"
  if [ "$s3" = input ]; then
    post "$J/job/$JOB/3/input/Promote/abort" > /dev/null
    r3="$(wait_end 3)"
    read -r pr_img _ <<< "$(state production)"
    if [ "$r3" = ABORTED ] && [ "$pr_img" = "$img_a" ]; then pass "when the reviewer rejects build #3, it is aborted and production keeps $img_a"
    else fail "a rejected approval should abort the build and leave production alone (build: $r3; production: $pr_img)"; fi
  else fail "build #3 should wait for the approval again (it ended $s3)"; fi
else
  fail "the rollback and rejection scenarios run only after build #1 succeeds"
fi
finish
