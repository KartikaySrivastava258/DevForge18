#!/usr/bin/env bash
# Acceptance check for "Rolling deployment and rollback demo".
# Usage: bash check.sh path/to/your/project   (the folder with deployment.yaml and release.sh)
# Needs Docker, kind (v0.32.0 in the lessons) and kubectl (v1.36.1). Creates a throwaway kind cluster, applies
# your manifests, then runs your release.sh twice while a Pod inside the cluster keeps requesting the Service:
# first a good release (nginx 1.27 -> 1.28), then a broken build that starts but never answers (the pause
# image). Prints PASS or FAIL per criterion, exits non-zero if any fails, deletes the cluster. About 3 minutes.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
node_image="kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5"  # kind v0.32.0 release notes
client_image="busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"      # published 2026-10-28
good_image="nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236"    # published 2026-03-25
# A "broken build": the pause image runs forever and never listens on a port (created 2024-05-23).
broken_image="registry.k8s.io/pause:3.10@sha256:ee6521f290b2168b6e0935a181d4cff9be1ac3f505666ef0e3c98fae8199917a"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
for tool in docker kind kubectl; do
  command -v "$tool" > /dev/null || fail "$tool is not installed — this check needs Docker, kind and kubectl (see the project page)"
done
for f in deployment.yaml release.sh; do [ -f "$dir/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

cluster="devforge-check-k8sroll-$$"
tmp="$(mktemp -d)"
export KUBECONFIG="$tmp/kubeconfig"   # release.sh uses this throwaway cluster, never your own
trap 'kind delete cluster --name "$cluster" > /dev/null 2>&1; rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM
echo "Creating a throwaway kind cluster ($cluster) ..."
create() { kind create cluster --name "$cluster" --image "$node_image" --wait 120s > "$tmp/kind.log" 2>&1; }
if ! create && ! { kind delete cluster --name "$cluster" > /dev/null 2>&1; sleep 5; create; }; then
  fail "could not create a kind cluster: $(grep -m 1 ERROR "$tmp/kind.log")"; finish
fi
jp() { kubectl get "$1" -o "jsonpath=$2" 2> /dev/null; }
kubectl run client --image="$client_image" --restart=Never --command -- sleep 900 > /dev/null

# sample N GAP: N requests to http://web/ from inside the cluster; one line each: the Server header or ERR.
sample() {
  kubectl exec client -- sh -c "for i in \$(seq 1 $1); do s=\$(wget -S -q -T 2 -O /dev/null http://web/ 2>&1 | sed -n 's/^ *Server: *//p' | tr -d '\r'); echo \${s:-ERR}; sleep $2; done" 2> /dev/null
}
summary() { sort | uniq -c | awk '{ printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1 }'; }
image() { jp deployment/web '{.spec.template.spec.containers[0].image}'; }
complete() { kubectl rollout status deployment/web --timeout="$1" > /dev/null 2>&1; }
# After a rollout, wait until the replaced Pods have gone, so no request races a Pod that is shutting down.
settle() {
  complete 120s
  for _ in $(seq 1 60); do
    [ "$(kubectl get pods -o jsonpath='{range .items[*]}{.metadata.labels.pod-template-hash} {.metadata.deletionTimestamp}{"\n"}{end}' 2> /dev/null | grep -vc '^ *$')" -eq "$(jp deployment/web '{.spec.replicas}')" ] && \
      [ -z "$(kubectl get pods -o jsonpath='{range .items[*]}{.metadata.deletionTimestamp}{end}' 2> /dev/null)" ] && break
    sleep 1
  done
  sleep 2
}

# 1. The first version runs and the Service serves it.
if out="$(kubectl apply -f "$dir/deployment.yaml" 2>&1)"; then :; else fail "kubectl apply -f deployment.yaml fails: $(echo "$out" | tr '\n' ' ')"; finish; fi
kubectl get deployment web > /dev/null 2>&1 && kubectl get service web > /dev/null 2>&1 || { fail "deployment.yaml must define the Deployment web and the Service web"; finish; }
complete 150s
kubectl wait --for=condition=Ready pod/client --timeout=60s > /dev/null 2>&1
replicas="$(jp deployment/web '{.spec.replicas}')"; ready="$(jp deployment/web '{.status.readyReplicas}')"
if [ "${replicas:-0}" -ge 3 ] && [ "${ready:-0}" = "$replicas" ]; then pass "Deployment web is Available with $ready/$replicas Pods ready"
else fail "Deployment web should run at least 3 replicas, all ready (ready ${ready:-0} of ${replicas:-0})"; fi
first="$(sample 10 0.2)"
if [ "$(echo "$first" | grep -c '^nginx/1\.27\.')" -eq 10 ]; then pass "the Service web serves the first version: $(echo "$first" | summary)"
else fail "the Service web should answer every request with nginx 1.27 before any release (got: $(echo "$first" | summary))"; fi

# 2. The rollout strategy and the readiness probe.
strategy="$(jp deployment/web '{.spec.strategy.type} {.spec.strategy.rollingUpdate.maxUnavailable}')"
case "$strategy" in
  "RollingUpdate 0"|"RollingUpdate 0%") pass "rolling update with maxUnavailable 0 — no serving Pod is removed before its replacement is ready" ;;
  *) fail "use a RollingUpdate with maxUnavailable: 0 (found: ${strategy:-default, which is 25%})" ;;
esac
probe="$(jp deployment/web '{.spec.template.spec.containers[0].readinessProbe}')"
if [ -n "$probe" ]; then pass "container web has a readiness probe"
else fail "container web has no readiness probe — without one, a Pod gets traffic as soon as its process starts"; fi

# 3. A good release: release.sh waits for it, records it, and every request ends up on the new version.
ROLLOUT_TIMEOUT=100s timeout 150 bash "$dir/release.sh" "$good_image" > "$tmp/good.log" 2>&1; rc=$?
if [ "$rc" -eq 0 ] && [ "$(image)" = "$good_image" ] && complete 2s; then pass "release.sh $good_image exits 0 after the rollout has finished"
elif [ "$rc" -ne 0 ]; then fail "release.sh with a good image should exit 0 (exit $rc: $(tail -n 2 "$tmp/good.log" | tr '\n' ' '))"
else fail "release.sh exited 0 before the rollout had finished — wait with kubectl rollout status"; fi
settle
after="$(sample 10 0.2)"
if [ "$(echo "$after" | grep -c '^nginx/1\.28\.')" -eq 10 ]; then pass "after the release the Service serves only the new version: $(echo "$after" | summary)"
else fail "after the release every request should be answered by nginx 1.28 (got: $(echo "$after" | summary))"; fi
if kubectl rollout history deployment/web 2> /dev/null | grep -q '1\.28'; then pass "kubectl rollout history records the release in CHANGE-CAUSE"
else fail "kubectl rollout history shows no change-cause for the release — set the kubernetes.io/change-cause annotation in release.sh"; fi

# 4. A broken release: watch capacity and traffic while it is stuck, then let release.sh react.
ROLLOUT_TIMEOUT=40s timeout 120 bash "$dir/release.sh" "$broken_image" > "$tmp/broken.log" 2>&1 &
release_pid=$!
for _ in $(seq 1 30); do
  kubectl get pods -l "$(jp deployment/web '{.spec.selector.matchLabels}' | tr -d '{}"' | tr ':' '=')" \
    -o jsonpath='{range .items[*]}{.spec.containers[0].image} {.status.phase}{"\n"}{end}' 2> /dev/null | grep -q "^registry.k8s.io/pause.* Running" && break
  sleep 1
done
min_ready="$replicas"
during="$(sample 20 0.4)"
for _ in 1 2 3; do
  r="$(kubectl get pods -o jsonpath='{range .items[*]}{.spec.containers[0].image} {.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2> /dev/null | grep -c "^$good_image True$")"
  [ "${r:-0}" -lt "$min_ready" ] && min_ready="${r:-0}"
  sleep 1
done
broken_endpoints=0
while read -r pod ready; do
  [ "$ready" = true ] || continue
  jp "pod/$pod" '{.spec.containers[0].image}' | grep -q pause && broken_endpoints=$((broken_endpoints + 1))
done <<< "$(kubectl get endpointslices -l kubernetes.io/service-name=web -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name} {.conditions.ready}{"\n"}{end}' 2> /dev/null)"
if [ "$(echo "$during" | grep -c '^nginx/1\.28\.')" -eq 20 ] && [ "$broken_endpoints" -eq 0 ]; then
  pass "during the broken release the Service sent no traffic to the broken Pods: $(echo "$during" | summary)"
else
  fail "during the broken release requests failed or reached the broken Pods ($(echo "$during" | summary); ready broken endpoints: $broken_endpoints) — a readiness probe keeps unready Pods out of the Service"
fi
if [ "$min_ready" -ge "$replicas" ]; then pass "capacity never dropped: $min_ready of $replicas working Pods stayed ready while the broken release was stuck"
else fail "only $min_ready of $replicas working (nginx 1.28) Pods were ready during the broken release — with maxUnavailable 0 and a readiness probe none would have been removed"; fi
wait "$release_pid"; rc=$?
if [ "$rc" -ne 0 ] && [ "$(image)" = "$good_image" ]; then pass "release.sh detected the stuck rollout (exit $rc) and rolled back to the previous image"
elif [ "$rc" -eq 0 ]; then fail "release.sh exited 0 for a release that never became ready — wait with kubectl rollout status --timeout and roll back"
else fail "release.sh failed (exit $rc) but the Deployment still runs $(image) — roll back with kubectl rollout undo"; fi
complete 60s
# Pods being deleted are left out: the pause process ignores SIGTERM, so they linger for the grace period.
left="$(kubectl get pods -o jsonpath='{range .items[*]}{.spec.containers[0].image} {.metadata.deletionTimestamp}{"\n"}{end}' 2> /dev/null | grep -c 'pause.* $')"
final="$(sample 6 0.2)"
if [ "$left" -eq 0 ] && [ "$(echo "$final" | grep -c '^nginx/1\.28\.')" -eq 6 ]; then pass "after the rollback no broken Pods are left and every request is served by nginx 1.28"
else fail "after the rollback $left broken Pod(s) remain (not being deleted); traffic: $(echo "$final" | summary)"; fi
finish
