#!/usr/bin/env bash
# Acceptance check for "Resource-limited service with health probes".
# Usage: bash check.sh path/to/your/project   (the folder with app.yaml and deployment.yaml)
# Needs Docker, kind (v0.32.0 in the lessons) and kubectl (v1.36.1). Creates a throwaway kind cluster, applies
# your files, checks start-up, resources and probes, then — on three different Pods at once — drains one, hangs
# one and makes one leak memory, and reads from the Pod status and events what Kubernetes did. Prints PASS or
# FAIL per criterion, exits non-zero if any fails, deletes the cluster. About three minutes.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
node_image="kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5"  # kind v0.32.0 release notes
client_image="busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec"      # published 2026-10-28
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
for f in app.yaml deployment.yaml; do [ -f "$dir/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

cluster="devforge-check-k8sprobe-$$"
tmp="$(mktemp -d)"
export KUBECONFIG="$tmp/kubeconfig"
trap 'kind delete cluster --name "$cluster" > /dev/null 2>&1; rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM
echo "Creating a throwaway kind cluster ($cluster) ..."
create() { kind create cluster --name "$cluster" --image "$node_image" --wait 120s > "$tmp/kind.log" 2>&1; }
if ! create && ! { kind delete cluster --name "$cluster" > /dev/null 2>&1; sleep 5; create; }; then
  fail "could not create a kind cluster: $(grep -m 1 ERROR "$tmp/kind.log")"; finish
fi
jp() { kubectl get "$1" -o "jsonpath=$2" 2> /dev/null; }
c0='{.spec.template.spec.containers[0]'
# Quantity -> bytes (Ki, Mi, Gi, k, M, G or plain); -1 if unknown.
bytes() { awk -v v="$1" 'BEGIN { n = v + 0; u = v; sub(/^[0-9.]+/, "", u); m["Ki"] = 1024; m["Mi"] = 1048576; m["Gi"] = 1073741824; m["k"] = 1e3; m["M"] = 1e6; m["G"] = 1e9; m[""] = 1; if (v == "" || !(u in m)) print -1; else printf "%d\n", n * m[u] }'; }
kubectl run client --image="$client_image" --restart=Never --command -- sleep 900 > /dev/null

if out="$(kubectl apply -f "$dir/app.yaml" -f "$dir/deployment.yaml" 2>&1)"; then :; else fail "kubectl apply fails: $(echo "$out" | grep -i error | head -n 2 | tr '\n' ' ')"; finish; fi
kubectl get deployment grades > /dev/null 2>&1 || { fail "deployment.yaml must define the Deployment grades"; finish; }
command="$(jp deployment/grades "$c0.command}")"
case "$command" in
  *"sleep 12 "*"httpd -f -p 8080 -h /www"*) ;;  # (jsonpath prints & as \u0026)
  *) fail "keep the container's command from the starter — the check relies on its 12-second start-up" ;;
esac

# 1. Start-up: all replicas become ready, and no container is restarted while it loads.
kubectl rollout status deployment/grades --timeout=120s > /dev/null 2>&1
sleep 5
replicas="$(jp deployment/grades '{.spec.replicas}')"; ready="$(jp deployment/grades '{.status.readyReplicas}')"
restarts="$(kubectl get pods -l app=grades -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\n"}{end}' | awk '{ s += $1 } END { print s + 0 }')"
if [ "${replicas:-0}" -ge 3 ] && [ "${ready:-0}" = "$replicas" ] && [ "$restarts" -eq 0 ]; then
  pass "Deployment grades started $ready/$replicas Pods with no restarts during the 12-second start-up"
elif [ "$restarts" -gt 0 ]; then
  fail "containers were restarted $restarts time(s) during start-up — a liveness probe killed them while they were loading; give start-up time with a startup probe"
else
  fail "Deployment grades should have at least 3 replicas, all ready (ready ${ready:-0} of ${replicas:-0})"
fi

# 2. Resources.
req_cpu="$(jp deployment/grades "$c0.resources.requests.cpu}")"; req_mem="$(jp deployment/grades "$c0.resources.requests.memory}")"
lim_cpu="$(jp deployment/grades "$c0.resources.limits.cpu}")"; lim_mem="$(jp deployment/grades "$c0.resources.limits.memory}")"
lim_bytes="$(bytes "$lim_mem")"; req_bytes="$(bytes "$req_mem")"
qos="$(kubectl get pods -l app=grades -o jsonpath='{.items[0].status.qosClass}' 2> /dev/null)"
if [ -n "$req_cpu" ] && [ -n "$req_mem" ] && [ -n "$lim_cpu" ] && [ -n "$lim_mem" ]; then
  pass "requests (cpu $req_cpu, memory $req_mem) and limits (cpu $lim_cpu, memory $lim_mem) are set; QoS class $qos"
else
  fail "set CPU and memory requests and limits (requests: cpu=${req_cpu:-none} memory=${req_mem:-none}; limits: cpu=${lim_cpu:-none} memory=${lim_mem:-none}; QoS class ${qos:-unknown})"
fi
memory_ok=false
if [ "$lim_bytes" -gt 0 ] && [ "$lim_bytes" -le $((256 * 1048576)) ] && [ "$req_bytes" -le "$lim_bytes" ]; then memory_ok=true
  pass "the memory limit ($lim_mem) is at most 256Mi and not below the request"
else fail "the memory limit must be set, at most 256Mi and not below the request (limit ${lim_mem:-none}, request ${req_mem:-none})"; fi

# 3. Probes.
missing=""
for p in startupProbe readinessProbe livenessProbe; do [ -n "$(jp deployment/grades "$c0.$p}")" ] || missing="$missing $p"; done
if [ -z "$missing" ]; then pass "the container has a startup, a readiness and a liveness probe"; else fail "the container is missing:$missing"; fi

# 4. The Service answers.
kubectl wait --for=condition=Ready pod/client --timeout=60s > /dev/null 2>&1
get() { kubectl exec client -- wget -qO- -T 3 http://grades/cgi-bin/grades 2> /dev/null; }
if get | grep -q '"served_by"'; then pass "the Service grades answers GET /cgi-bin/grades"; else fail "the Service grades does not answer GET /cgi-bin/grades — are Pods marked ready before they listen (no readiness probe)?"; fi

# 5. Trouble, on three different Pods at once.
read -r -a pods <<< "$(kubectl get pods -l app=grades --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}' 2> /dev/null)"
if [ "${#pods[@]}" -lt 3 ]; then fail "need 3 running Pods to test draining, hanging and a memory leak (found ${#pods[@]})"; finish; fi
drained="${pods[0]}"; hung="${pods[1]}"; leaky="${pods[2]}"
restarts_of() { jp "pod/$1" '{.status.containerStatuses[0].restartCount}'; }
endpoint_ready() { kubectl get endpointslices -l kubernetes.io/service-name=grades -o jsonpath="{range .items[*].endpoints[?(@.targetRef.name==\"$1\")]}{.conditions.ready}{end}" 2> /dev/null; }
call() { kubectl exec "$1" -- wget -qO- -T 3 "http://127.0.0.1:8080/cgi-bin/$2" > /dev/null 2>&1; }
d0="$(restarts_of "$drained")"; h0="$(restarts_of "$hung")"
call "$drained" drain; call "$hung" hang
if [ "$memory_ok" = true ]; then
  (timeout 60 kubectl exec "$leaky" -- wget -qO /dev/null -T 50 http://127.0.0.1:8080/cgi-bin/hog > /dev/null 2>&1 &)
fi
start=$SECONDS; d_out=""; d_restarted=false; h_out=""; h_restart=""; oom=""; oom_via=""
while [ $((SECONDS - start)) -lt 75 ]; do
  t=$((SECONDS - start))
  [ -z "$d_out" ] && [ "$(endpoint_ready "$drained")" = false ] && d_out=$t
  [ "$(restarts_of "$drained")" != "$d0" ] && d_restarted=true
  [ -z "$h_out" ] && [ "$(endpoint_ready "$hung")" = false ] && h_out=$t
  [ -z "$h_restart" ] && [ "$(restarts_of "$hung")" != "$h0" ] && h_restart=$t
  if [ -z "$oom" ] && [ "$memory_ok" = true ]; then
    case "$(jp "pod/$leaky" '{.status.containerStatuses[0].lastState.terminated.reason}/{.status.containerStatuses[0].lastState.terminated.exitCode}')" in
      OOMKilled/*) oom=$t ;;
      Error/137) oom=$t; oom_via=cgroup ;;   # killed by SIGKILL: was it the OOM killer? Checked below.
    esac
  fi
  # Done once the drained Pod has stayed out (and alive) for 25 s and the other two have been dealt with.
  [ -n "$d_out" ] && [ $((t - d_out)) -ge 25 ] && [ -n "$h_restart" ] && { [ -n "$oom" ] || [ "$memory_ok" != true ]; } && break
  sleep 1
done
if [ -n "$d_out" ] && [ "$d_restarted" = false ]; then pass "a draining Pod left the Service after ${d_out}s and was not restarted (readiness, not liveness)"
elif [ -z "$d_out" ]; then fail "a draining Pod (/cgi-bin/ready answers 503) stayed in the Service — the readiness probe should ask /cgi-bin/ready"
else fail "a draining Pod was restarted — the liveness probe must not fail while a Pod drains (use /cgi-bin/healthz for liveness)"; fi
liveness_event="$(kubectl get events --field-selector "involvedObject.name=$hung,reason=Unhealthy" -o jsonpath='{.items[*].message}' 2> /dev/null | grep -o 'Liveness probe failed' | head -n 1)"
if [ -n "$h_restart" ] && [ "$h_restart" -le 45 ] && [ -n "$liveness_event" ]; then
  pass "a hung container was restarted by its liveness probe after ${h_restart}s${h_out:+ (it left the Service after ${h_out}s)}"
elif [ -n "$h_restart" ]; then fail "the hung container was restarted after ${h_restart}s — it should take at most about 30 s (event: ${liveness_event:-no liveness failure recorded})"
else fail "a hung container (/cgi-bin/healthz no longer answers) was not restarted within 75 s — add a liveness probe on /cgi-bin/healthz"; fi
if [ "$memory_ok" != true ]; then fail "memory leak test skipped: without a memory limit of at most 256Mi a leak could use the whole node's memory"
elif [ -n "$oom" ] && [ -z "$oom_via" ]; then
  code="$(jp "pod/$leaky" '{.status.containerStatuses[0].lastState.terminated.exitCode}')"
  pass "a leaking container was stopped at its memory limit: lastState.terminated.reason = OOMKilled (exit code $code) after ${oom}s"
elif [ -n "$oom" ]; then
  # containerd reports OOMKilled only if it can watch the cgroup's OOM events. On a machine that has run out of
  # inotify instances (kind's known issue "too many open files") it reports Error/137 instead, so ask the kernel:
  # the Pod's memory cgroup counts every process the OOM killer stopped.
  uid="$(jp "pod/$leaky" '{.metadata.uid}' | tr '-' '_')"
  kills="$(docker exec "$cluster-control-plane" sh -c "d=\$(find /sys/fs/cgroup -maxdepth 5 -type d -name '*pod$uid.slice' | head -n 1); sed -n 's/^oom_kill //p' \"\$d/memory.events\"" 2> /dev/null)"
  if [ "${kills:-0}" -gt 0 ]; then
    pass "a leaking container was stopped at its memory limit after ${oom}s: the kernel's OOM killer stopped $kills process(es) in the Pod's memory cgroup (the Pod status says Error/137, not OOMKilled, because containerd on this machine could not watch OOM events — see kind's known issues about inotify limits)"
  else fail "the leaking container was killed (exit 137) but not by the OOM killer — check its probes and limits"; fi
else fail "a leaking container was not OOMKilled within 75 s (last state: $(jp "pod/$leaky" '{.status.containerStatuses[0].lastState.terminated.reason}'))"; fi

# 6. Everything recovers.
call "$drained" undrain
ok=false
for _ in $(seq 1 60); do
  [ "$(jp deployment/grades '{.status.readyReplicas}')" = "$replicas" ] && \
    [ "$(kubectl get endpointslices -l kubernetes.io/service-name=grades -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\n"}{end}' | grep -c true)" -eq "$replicas" ] && { ok=true; break; }
  sleep 1
done
if [ "$ok" = true ] && get | grep -q '"served_by"'; then pass "afterwards all $replicas Pods are ready and in the Service again"
else fail "the Pods did not all recover within 60 s (ready $(jp deployment/grades '{.status.readyReplicas}') of $replicas)"; fi
finish
