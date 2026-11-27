---
id: kubernetes-probes-requests-and-limits
title: Probes, requests and limits
track: kubernetes
order: 3
level: beginner
estimated_minutes: 40
prerequisites: [kubernetes-services-and-rollouts]
learning_objectives:
  - Use a readiness probe to keep traffic away from a Pod that is not ready, and a liveness probe to restart one that is stuck.
  - Explain how resource requests decide where — and whether — a Pod is scheduled.
  - Explain what happens when a container goes over its memory or CPU limit.
resources:
  - title: Liveness, readiness and startup probes
    url: https://kubernetes.io/docs/concepts/workloads/pods/probes/
    publisher: The Kubernetes Authors
    type: documentation
    level: beginner
    official: true
    why: What each probe is for and what Kubernetes does when one fails.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Resource management for Pods and containers
    url: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
    publisher: The Kubernetes Authors
    type: documentation
    level: beginner
    official: true
    why: Requests, limits, how the scheduler uses requests, and how memory and CPU limits are enforced.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: readiness-vs-liveness
    prompt: A Pod is running but its app is still loading data and cannot answer requests yet. Which probe should handle that?
    options:
      - { id: a, text: "A liveness probe — restart it until it is ready" }
      - { id: b, text: "A readiness probe — keep it out of the Service until it is ready, without restarting it" }
      - { id: c, text: "No probe is needed" }
    answer: b
    explanation: A failing readiness probe removes the Pod from the Service's endpoints and leaves the container running. A liveness probe would restart it — and a slow start could then turn into an endless restart loop.
  - id: pending
    prompt: A Pod asks for 100 CPUs and stays Pending. Why?
    options:
      - { id: a, text: "The image is still downloading" }
      - { id: b, text: "The scheduler only places a Pod on a node whose free capacity covers its requests, and no node has 100 CPUs" }
      - { id: c, text: "Kubernetes limits Pods to one CPU" }
    answer: b
    explanation: You see the FailedScheduling event in the lesson. Requests are what the scheduler reserves; a request no node can satisfy keeps the Pod Pending.
  - id: limits
    prompt: What is the difference between going over a memory limit and going over a CPU limit?
    options:
      - { id: a, text: "There is none" }
      - { id: b, text: "Over the memory limit, the kernel may kill the container (OOMKilled); over the CPU limit, the container is slowed down (throttled), not killed" }
      - { id: c, text: "Both delete the Pod" }
    answer: b
    explanation: Memory cannot be taken back from a running process, so the kernel kills it; CPU time can simply be rationed.
verification:
  method: executed
  details: Every command is run by the test suite in CI on a kind cluster (kindest/node v1.36.1, pinned by digest) with kubectl v1.36.1; the output shown was recorded from that run. Facts about probes, requests and limits were checked against the Kubernetes documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Probes** let Kubernetes check each container — a **readiness** probe decides whether a Pod gets traffic, a **liveness** probe decides whether a container must be restarted — and **requests** and **limits** say how much CPU and memory a container is guaranteed and allowed, which decides where a Pod can run and what happens when it uses too much.

## Explain it like I'm twelve

A restaurant kitchen has cooks. Before a new cook takes orders, the manager asks "are you ready?" — if not, no orders go to them yet (**readiness**). If a cook freezes and stops responding, the manager sends them on a break and brings them back fresh (**liveness**). Each cook is promised a part of the counter to work on (**request**), and nobody may spread out beyond their area (**limit**).

Where the analogy breaks: a cook who takes too much counter space just gets told off; a container that takes too much memory may be stopped on the spot.

## What problem it solves

Without probes, Kubernetes only knows whether a process is running — not whether it can serve. Traffic goes to Pods that are still starting, and a hung app keeps "running" forever. Without requests, the scheduler cannot tell whether a node has room; without limits, one greedy container can starve everything else on its node.

## How it works

```diagram steps=kubernetes/probes
```

- A **readiness probe** (for example an HTTP GET) runs regularly. While it fails, the Pod is not ready and is removed from the endpoints of its Services — it gets no traffic — but its container keeps running.
- A **liveness probe** that keeps failing makes the kubelet restart the container.
- A **startup probe** gives slow-starting containers time: the other probes wait until it succeeds.
- **Requests** are what the scheduler reserves: a Pod only goes on a node whose free capacity covers them, and stays Pending while no node does.
- **Limits** are enforced on the node: memory limits by the kernel's out-of-memory killer, CPU limits by throttling.

## Try it yourself

> **Local lab** — needs Docker, kind and kubectl, as in the previous lessons. The previous lesson deleted its cluster, so this one starts a new one. Every command is run automatically in DevForge's tests (in CI).

### 1. A fresh cluster

```bash run
kind create cluster --name devforge --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5 --wait 120s > /dev/null 2>&1
kubectl wait --for=condition=Ready node --all --timeout=180s
```

```text output
node/devforge-control-plane condition met
```

### 2. A readiness probe that fails

```bash run
cat > web.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          readinessProbe:
            httpGet: { path: /ready, port: 80 }
            periodSeconds: 2
EOF
kubectl apply -f web.yaml
kubectl expose deployment web --port=80
for i in $(seq 1 120); do [ "$(kubectl get pods -l app=web --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l)" -eq 2 ] && break; sleep 1; done
sleep 6
kubectl get pods -l app=web --no-headers | awk '{ print $2, $3 }'
kubectl get endpointslices -l kubernetes.io/service-name=web -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\n"}{end}'
```

```text output
deployment.apps/web created
service/web exposed
0/1 Running
0/1 Running
false
false
```

- nginx serves `/`, but there is no `/ready` page: the probe gets a 404 every 2 seconds, so both Pods are **Running** but **not ready** (`0/1`).
- The Service `web` exists, but its endpoints are marked not ready — it sends them no traffic.
- The `sleep 6` lets the probe fail a few times after the containers start, so the state is settled.

### 3. Fix the probe

```bash run
sed -i 's#path: /ready#path: /#' web.yaml
kubectl apply -f web.yaml
kubectl rollout status deployment/web --timeout=180s
for i in $(seq 1 60); do
  eps=$(kubectl get endpointslices -l kubernetes.io/service-name=web -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\n"}{end}')
  [ "$(echo "$eps" | grep -c true)" -eq 2 ] && ! echo "$eps" | grep false > /dev/null && break
  sleep 1
done
echo "$eps"
```

```text output
deployment.apps/web configured
…
deployment "web" successfully rolled out
true
true
```

Changing the Pod template rolls out new Pods; their probe asks for `/`, gets 200, and they become ready — and so do the Service's endpoints. (The loop waits until the old Pods' endpoints have gone, so only the two new ones are listed.)

### 4. A liveness probe restarts a stuck container

This is the example from the Kubernetes documentation: the container creates `/tmp/healthy`, removes it after 30 seconds, and the probe checks that the file exists.

```bash run
cat > liveness.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: liveness
spec:
  containers:
    - name: app
      image: busybox:1.37
      args: ["/bin/sh", "-c", "touch /tmp/healthy; sleep 30; rm -f /tmp/healthy; sleep 600"]
      livenessProbe:
        exec: { command: ["cat", "/tmp/healthy"] }
        initialDelaySeconds: 5
        periodSeconds: 5
EOF
kubectl apply -f liveness.yaml
for i in $(seq 1 180); do [ "$(kubectl get pod liveness -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null)" -ge 1 ] 2>/dev/null && break; sleep 1; done
kubectl get pod liveness -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}'
kubectl get events --field-selector involvedObject.name=liveness,reason=Unhealthy -o jsonpath='{.items[0].message}{"\n"}' | grep -o '^Liveness probe failed'
```

```text output
pod/liveness created
1
Liveness probe failed
```

- For 30 seconds the probe succeeds. Then `cat /tmp/healthy` fails; after three failures in a row (the default), the kubelet kills and restarts the container: `restartCount` becomes 1.
- The **Unhealthy** event records why.

### 5. Requests: a Pod that cannot be placed

```bash run
kubectl run greedy --image=nginx:1.27-alpine --overrides='{"spec":{"containers":[{"name":"greedy","image":"nginx:1.27-alpine","resources":{"requests":{"cpu":"100"}}}]}}'
for i in $(seq 1 60); do kubectl get events --field-selector involvedObject.name=greedy,reason=FailedScheduling --no-headers 2>/dev/null | grep . > /dev/null && break; sleep 1; done
kubectl get pod greedy --no-headers | awk '{ print $3 }'
kubectl get events --field-selector involvedObject.name=greedy,reason=FailedScheduling -o jsonpath='{.items[0].message}{"\n"}' | grep -o 'Insufficient cpu'
```

```text output
pod/greedy created
Pending
Insufficient cpu
```

The Pod asks for 100 CPUs. No node has them, so the scheduler leaves it **Pending** and records why.

### 6. Limits: a container that uses too much memory

```bash run
cat > hungry.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: hungry
spec:
  restartPolicy: Never
  containers:
    - name: app
      image: busybox:1.37
      args: ["/bin/sh", "-c", "tail /dev/zero"]
      resources:
        requests: { memory: 32Mi }
        limits: { memory: 64Mi }
EOF
kubectl apply -f hungry.yaml
for i in $(seq 1 120); do [ -n "$(kubectl get pod hungry -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}' 2>/dev/null)" ] && break; sleep 1; done
kubectl get pod hungry -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}{"\n"}'
```

```text output
pod/hungry created
OOMKilled
```

`tail /dev/zero` keeps reading a "line" that never ends, so its memory grows until it hits the 64 MiB limit — and the kernel kills it: **OOMKilled**. (`restartPolicy: Never` keeps it from being restarted, so the state stays visible.) A container over its **CPU** limit is slowed down instead, never killed for it.

### 7. Delete the cluster

```bash run
kind delete cluster --name devforge
```

```text output
Deleting cluster "devforge" ...
Deleted nodes: ["devforge-control-plane"]
```

## Common mistakes

- **Using a liveness probe for slow starts.** The container is killed before it ever finishes starting. Use a startup probe, or a generous `initialDelaySeconds`.
- **A liveness probe that checks other services** (the database). When the database is down, every Pod restarts — and nothing gets better.
- **No requests.** The scheduler then places Pods as if they need nothing, and nodes get overloaded.
- **Memory limits far below real use.** The container is OOMKilled again and again; measure first (**Prometheus** helps), then set limits.
- **Probes that hit expensive endpoints.** They run every few seconds on every Pod; keep them cheap.

## Where this fits in a real system

Readiness probes are what make the rolling updates of the previous lesson safe: new Pods get traffic only when ready. Requests and limits feed cluster capacity planning, and **Prometheus** and **Grafana** show restarts, OOM kills and throttling — usually the first signs that probes or limits need tuning.
