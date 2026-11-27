#!/usr/bin/env bash
# Acceptance check for "Deploy a three-tier application".
# Usage: bash check.sh path/to/your/project   (the folder that contains k8s/)
# Needs Docker, kind (v0.32.0 in the lessons) and kubectl (v1.36.1). Creates a throwaway kind cluster with the
# node image the lessons pin, applies everything in k8s/, waits for the Deployments, inspects the Services'
# endpoints and sends requests through frontend -> api -> redis from a Pod inside the cluster. Prints PASS or
# FAIL per criterion, exits non-zero if any fails, and deletes the cluster. Takes two to three minutes.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
node_image="kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5"  # kind v0.32.0 release notes
client_image="busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"  # published 2026-10-28
ns=campus
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
[ -d "$dir/k8s" ] || fail "the folder k8s/ is missing"
[ "$failures" -eq 0 ] || finish

cluster="devforge-check-k8s3t-$$"
tmp="$(mktemp -d)"
export KUBECONFIG="$tmp/kubeconfig"   # never touches your own kubeconfig
trap 'kind delete cluster --name "$cluster" > /dev/null 2>&1; rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM
echo "Creating a throwaway kind cluster ($cluster) ..."
create() { kind create cluster --name "$cluster" --image "$node_image" --wait 120s > "$tmp/kind.log" 2>&1; }
# One retry: on a busy machine (or with several kind clusters running) kubeadm can time out once.
if ! create && ! { kind delete cluster --name "$cluster" > /dev/null 2>&1; sleep 5; create; }; then
  fail "could not create a kind cluster: $(grep -m 1 ERROR "$tmp/kind.log")"; finish
fi
k() { kubectl -n "$ns" "$@"; }
jp() { k get "$1" -o "jsonpath=$2" 2> /dev/null; }

# Start a client Pod now, so its image is pulled while the application starts.
kubectl create namespace devforge-client > /dev/null
kubectl -n devforge-client run client --image="$client_image" --restart=Never --command -- sleep 900 > /dev/null

if out="$(kubectl apply -R -f "$dir/k8s" 2>&1)"; then
  pass "kubectl apply -R -f k8s/ succeeds ($(echo "$out" | grep -c .) objects)"
else
  fail "kubectl apply -R -f k8s/ fails: $(echo "$out" | grep -i error | head -n 3 | tr '\n' ' ')"
fi
kubectl get namespace "$ns" > /dev/null 2>&1 || { fail "namespace $ns does not exist — every object belongs in it"; finish; }

# 1. The Deployments become Available with all replicas ready.
declare -A min=([frontend]=2 [api]=2 [redis]=1) tier=([frontend]=frontend [api]=api [redis]=database)
deadline=$((SECONDS + 150))
for d in redis api frontend; do
  if ! k get deployment "$d" > /dev/null 2>&1; then fail "Deployment $d not found in namespace $ns"; continue; fi
  left=$((deadline - SECONDS)); [ "$left" -lt 10 ] && left=10
  k rollout status "deployment/$d" --timeout="${left}s" > /dev/null 2>&1
  want="$(jp "deployment/$d" '{.spec.replicas}')"; ready="$(jp "deployment/$d" '{.status.readyReplicas}')"
  avail="$(jp "deployment/$d" '{.status.conditions[?(@.type=="Available")].status}')"
  if [ "$avail" = True ] && [ "${ready:-0}" = "$want" ] && [ "${want:-0}" -ge "${min[$d]}" ]; then
    pass "Deployment $d is Available with $ready/$want Pods ready"
  elif [ "${want:-0}" -lt "${min[$d]}" ]; then
    fail "Deployment $d should run at least ${min[$d]} replicas (it asks for ${want:-0})"
  else
    why="$(k get pods -l "tier=${tier[$d]}" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{" "}{end}' 2> /dev/null)"
    fail "Deployment $d is not Available (${ready:-0}/${want:-?} ready${why:+; Pods: $why})"
  fi
  labels="$(jp "deployment/$d" '{.spec.template.metadata.labels.app}/{.spec.template.metadata.labels.tier}')"
  [ "$labels" = "campus/${tier[$d]}" ] || fail "Pods of $d need the labels app: campus and tier: ${tier[$d]} (found app/tier = ${labels:-none})"
done

# 2. Each Service is ClusterIP, on the right port, and its ready endpoints are exactly the Pods of its tier.
for spec in frontend:80:frontend api:8080:api redis:6379:database; do
  IFS=: read -r svc port want_tier <<< "$spec"
  if ! k get service "$svc" > /dev/null 2>&1; then fail "Service $svc not found in namespace $ns"; continue; fi
  type="$(jp "service/$svc" '{.spec.type}')"; ports="$(jp "service/$svc" '{.spec.ports[*].port}')"
  [ "$type" = ClusterIP ] || fail "Service $svc should be ClusterIP — nothing in this project is exposed outside the cluster (it is $type)"
  case " $ports " in *" $port "*) ;; *) fail "Service $svc should listen on port $port (it has: ${ports:-none})" ;; esac
  eps="$(k get endpointslices -l "kubernetes.io/service-name=$svc" -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{" "}{.conditions.ready}{"\n"}{end}' 2> /dev/null)"
  pods="$(k get pods -l "app=campus,tier=$want_tier" --field-selector=status.phase=Running -o name 2> /dev/null | grep -c .)"
  n=0; wrong=""
  while read -r pod ready; do
    [ -n "$pod" ] && [ "$ready" = true ] || continue
    n=$((n + 1))
    t="$(jp "pod/$pod" '{.metadata.labels.tier}')"
    [ "$t" = "$want_tier" ] || wrong="$wrong $pod(tier=${t:-none})"
  done <<< "$eps"
  if [ "$n" -eq 0 ]; then fail "Service $svc routes to no ready Pods — compare its selector with the Pod labels (kubectl -n $ns get endpointslices)"
  elif [ -n "$wrong" ]; then fail "Service $svc routes to Pods that are not $want_tier Pods:$wrong"
  elif [ "$n" -ne "$pods" ]; then fail "Service $svc routes to $n Pods, but $pods $want_tier Pods are running"
  else pass "Service $svc ($type, port $port) routes to exactly the $n ready $want_tier Pod(s)"; fi
done

# 3. The API takes REDIS_HOST from the ConfigMap api-config.
ref="$(jp deployment/api '{.spec.template.spec.containers[0].env[?(@.name=="REDIS_HOST")].valueFrom.configMapKeyRef.name}')"
[ -z "$ref" ] && jp deployment/api '{.spec.template.spec.containers[0].envFrom[*].configMapRef.name}' | grep_quiet -w api-config && ref=api-config
host="$(jp configmap/api-config '{.data.REDIS_HOST}')"
if [ "$ref" = api-config ] && [ -n "$host" ]; then pass "the api Deployment takes REDIS_HOST ($host) from the ConfigMap api-config"
else fail "the api Deployment should take REDIS_HOST from the ConfigMap api-config (configMapKeyRef or envFrom), not a value written into the Deployment"; fi

# 4. Every image is pinned: a tag that is not "latest", or a digest.
images="$(k get deployments -o jsonpath='{range .items[*].spec.template.spec.containers[*]}{.image}{"\n"}{end}' 2> /dev/null)"
unpinned="$(echo "$images" | grep . | grep -v '@sha256:' | grep -Ev ':[^/]+$|:latest$' ; echo "$images" | grep -E ':latest(@|$)')"
if [ -n "$images" ] && [ -z "$unpinned" ]; then pass "every image is pinned ($(echo "$images" | grep -c .) containers)"
else fail "pin every image to a version (and preferably a digest), never latest: ${unpinned:-no Deployments found}"; fi

# 5. End to end, from inside the cluster: the page, then two visits that the counter in Redis records.
# The client Pod is the check's own tool, not part of your work: if it is not ready, say so instead of blaming the app.
client_note=""
if ! kubectl -n devforge-client wait --for=condition=Ready pod/client --timeout=180s > /dev/null 2>&1; then
  client_note=" [the check's client Pod is not ready: $(kubectl -n devforge-client get pod client -o jsonpath='{.status.phase} {.status.containerStatuses[0].state}' 2>&1 | head -c 200)]"
fi
get_err="$tmp/get-err"
# wget without -q: on an error it says why (connection refused, 502 ...) in $get_err.
get() { kubectl -n devforge-client exec client -- wget -O- -T 5 "http://$1" 2> "$get_err"; }
# Service routing can trail Pod readiness by a few seconds, so allow up to 30 s for the first answer;
# a broken application never returns the page, however long it is given.
for _ in $(seq 1 15); do
  page="$(get "frontend.$ns.svc.cluster.local/")"
  echo "$page" | grep_quiet "Campus notice board" && break
  sleep 2
done
if echo "$page" | grep_quiet "Campus notice board"; then pass "GET / on the frontend Service returns the notice board page"
else fail "GET http://frontend.$ns/ does not return the notice board page (${page:0:80})${client_note} $(tail -n 1 "$get_err" | head -c 200)"; fi
v1="$(get "frontend.$ns.svc.cluster.local/api/visits" | sed -n 's/.*"visits": *\([0-9]*\).*/\1/p')"
v2="$(get "frontend.$ns.svc.cluster.local/api/visits" | sed -n 's/.*"visits": *\([0-9]*\).*/\1/p')"
if [ -n "$v1" ] && [ -n "$v2" ] && [ "$v2" -gt "$v1" ]; then pass "GET /api/visits goes frontend -> api -> redis: the counter went from $v1 to $v2"
else fail "GET /api/visits through the frontend should return {\"visits\": N} with N growing (got '${v1}', then '${v2}') — follow the request: frontend Service, nginx proxy to api, api to redis"; fi
finish
