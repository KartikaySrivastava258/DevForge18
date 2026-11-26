---
id: kubernetes-debug-broken-deployments
title: Break a configuration and debug events and logs
track: kubernetes
level: advanced
mode: read-through
estimated_minutes: 35
prerequisites: [kubernetes-deployments-and-self-healing]
objectives:
  - Tell ImagePullBackOff, CrashLoopBackOff and Pending apart, and know where each one's cause is recorded.
  - Read events with kubectl describe, and a crashed container's output with kubectl logs --previous.
  - Choose the fix that addresses the cause — and recognise fixes that would not help.
checkpoints:
  - { id: read, text: "I read each output and answered the questions below" }
questions:
  - id: typo-cause
    prompt: The typo Deployment's Pod shows ImagePullBackOff, and its events say the image reference was "not found". What is the most likely cause?
    options:
      - { id: a, text: "The node has run out of disk space" }
      - { id: b, text: "The image name or tag does not exist in the registry — here, a typo in the tag (alpne)" }
      - { id: c, text: "The container crashed after starting" }
      - { id: d, text: "The cluster has no internet access" }
    answer: b
    explanation: The kubelet reached the registry and was told the reference does not exist. BackOff means it keeps retrying with growing delays; fixing the image reference is the only cure.
  - id: crash-where
    prompt: The crasher Pod's phase is Running, yet it never becomes ready and its status is CrashLoopBackOff. Where do you find out why the program exits?
    options:
      - { id: a, text: "In kubectl logs --previous: the output of the container run that crashed" }
      - { id: b, text: "In the scheduler's events: the Pod could not be placed" }
      - { id: c, text: "Nowhere: Kubernetes does not keep the output of a crashed container" }
    answer: a
    explanation: The current container may have just restarted and printed nothing yet; --previous shows the run that ended. Here it prints "DATABASE_URL is not set", and the last state shows exit code 1.
  - id: pending-fix
    prompt: The greedy Pod stays Pending with "0/1 nodes are available - 1 Insufficient cpu". Which change fixes it?
    options:
      - { id: a, text: "Delete the Pod so the Deployment creates a new one" }
      - { id: b, text: "Lower the CPU request to what the app needs, or add nodes with enough free CPU" }
      - { id: c, text: "Change the image to a smaller one" }
    answer: b
    explanation: The scheduler only places a Pod on a node whose unrequested CPU covers the Pod's request. A new Pod with the same 64-CPU request would be just as unschedulable; the image size is irrelevant.
  - id: phase-misleads
    prompt: Why is "kubectl get pods" showing Running not proof that an app works?
    options:
      - { id: a, text: "Running only means a container has started (or is restarting); readiness and restart counts show whether it is actually healthy" }
      - { id: b, text: "Running is only shown for Pods on the control plane" }
      - { id: c, text: "It is proof: Running means the app passed its health checks" }
    answer: a
    explanation: The crasher Pod's phase stayed Running between crashes. READY 0/1, a rising RESTARTS count and the CrashLoopBackOff status tell the real story.
resources:
  - title: Debug Pods
    url: https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/
    publisher: Kubernetes documentation
    type: documentation
    level: intermediate
    official: true
    why: Pending, waiting and crashing Pods, and the commands to investigate each.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Pod Lifecycle
    url: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
    publisher: Kubernetes documentation
    type: documentation
    level: intermediate
    official: true
    why: Pod phases, container states and why a crashing container's Pod can still be Running.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every command on this page is run by DevForge's test suite on a real kind cluster (Kubernetes 1.36.1), and its output is compared with this page. Names, ages and timings that change on every run are shown as …. You read and interpret the output; running the commands yourself is optional.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Three Deployments are broken in three different ways. Your job is the one engineers do every week: read what the cluster says, find each **cause**, and pick the fix that addresses it. The output below comes from a real cluster; answer the questions at the end to complete the lab.

To try it yourself, use the kind cluster from *Deployments and self-healing* and run each command in order.

## The broken deployments

```bash run
kubectl create namespace debug-lab > /dev/null
cat > broken.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata: { name: typo, namespace: debug-lab }
spec:
  replicas: 1
  selector: { matchLabels: { app: typo } }
  template:
    metadata: { labels: { app: typo } }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpne
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: crasher, namespace: debug-lab }
spec:
  replicas: 1
  selector: { matchLabels: { app: crasher } }
  template:
    metadata: { labels: { app: crasher } }
    spec:
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo 'reading DATABASE_URL'; test -n \"$DATABASE_URL\" || { echo 'DATABASE_URL is not set' >&2; exit 1; }; echo 'connected'; sleep 3600"]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: greedy, namespace: debug-lab }
spec:
  replicas: 1
  selector: { matchLabels: { app: greedy } }
  template:
    metadata: { labels: { app: greedy } }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: "64", memory: 64Mi }
EOF
kubectl apply -f broken.yaml
```

```text output
deployment.apps/typo created
deployment.apps/crasher created
deployment.apps/greedy created
```

Every `apply` succeeded: Kubernetes accepted the *desired state*. Whether it can be *reached* only shows up afterwards. (The lab waits for each Pod to reach its failure state before looking. The crasher's STATUS alternates: `Error` right after each crash, then `CrashLoopBackOff` while Kubernetes waits before the next restart.)

```bash run
n="-n debug-lab"
kubectl $n wait pod -l app=typo --for=jsonpath='{.status.containerStatuses[0].state.waiting.reason}'=ImagePullBackOff --timeout=180s > /dev/null
kubectl $n wait pod -l app=crasher --for=jsonpath='{.status.containerStatuses[0].state.waiting.reason}'=CrashLoopBackOff --timeout=180s > /dev/null
kubectl $n wait pod -l app=greedy --for=condition=PodScheduled=false --timeout=120s > /dev/null
kubectl $n get pods
```

```text output
NAME   …   READY   STATUS   …
crasher-…   0/1     …
greedy-…    0/1     Pending   …
typo-…      0/1     ImagePullBackOff   …
```

## Case 1: ImagePullBackOff

```bash run
kubectl -n debug-lab describe pod -l app=typo | grep -o 'Failed to pull image "[^"]*".*not found$' | head -n 1
```

```text output
Failed to pull image "nginx:1.27-alpne": … not found
```

`describe` ends with the Pod's **events**. The kubelet reached the registry, asked for `nginx:1.27-alpne` — note the typo — and was told it does not exist. *BackOff* means Kubernetes keeps retrying, waiting longer each time.

## Case 2: CrashLoopBackOff

```bash run
for i in $(seq 1 15); do
  logs=$(kubectl -n debug-lab logs deploy/crasher --previous 2>&1)
  echo "$logs" | grep -q "is not set" && break
  sleep 2
done
echo "$logs"
kubectl -n debug-lab get pod -l app=crasher -o jsonpath='phase: {.items[0].status.phase}, last exit code: {.items[0].status.containerStatuses[0].lastState.terminated.exitCode}{"\n"}'
```

```text output
reading DATABASE_URL
DATABASE_URL is not set
phase: Running, last exit code: 1
```

(The loop retries for a moment: while Kubernetes is restarting the container, the previous run's logs can be briefly unavailable.)

The image pulled and the container started — then the program exited with code 1. Kubernetes restarts it, it fails again, and the delays grow: a crash *loop*. `--previous` shows the output of the run that crashed. Note the **phase**: Running.

## Case 3: Pending

```bash run
kubectl -n debug-lab get events --field-selector reason=FailedScheduling -o jsonpath='{.items[0].message}' | grep -o '^0/1 nodes are available: 1 Insufficient cpu'
```

```text output
0/1 nodes are available: 1 Insufficient cpu
```

No container ever started: the **scheduler** could not find a node with 64 CPUs of unrequested capacity. Nothing about the image or the program matters until the Pod is placed.

## The fixes

Each fix addresses its cause, and each goes through the Deployment, so it is recorded in the desired state. (`rollout status` waits until the new Pods are ready; `tail` keeps its last line. The logs are read from the newest crasher Pod, because the old one may still be shutting down.)

```bash run
n="-n debug-lab"
kubectl $n set image deploy/typo web=nginx:1.27-alpine > /dev/null
kubectl $n set env deploy/crasher DATABASE_URL=postgres://db.example/app > /dev/null
kubectl $n set resources deploy/greedy --requests=cpu=100m > /dev/null
for d in typo crasher greedy; do kubectl $n rollout status deploy/$d --timeout=180s | tail -n 1; done
newest=$(kubectl $n get pod -l app=crasher --sort-by=.metadata.creationTimestamp -o name | tail -n 1)
kubectl $n logs "$newest"
```

```text output
deployment "typo" successfully rolled out
deployment "crasher" successfully rolled out
deployment "greedy" successfully rolled out
reading DATABASE_URL
connected
```

In a real team, each fix would be a change to the YAML in Git, not a `kubectl set` command typed into a cluster — otherwise the next `kubectl apply -f broken.yaml` puts the bugs back.

## Clean up

```bash run
kubectl delete namespace debug-lab > /dev/null && echo "namespace deleted"
```

```text output
namespace deleted
```

## Reset

If you ran the commands yourself, delete the namespace (as above) and start again from the top.

## What you practised

Read Kubernetes failures by stage: **Pending** — the scheduler could not place the Pod (read the events); **ImagePullBackOff** — the node could not get the image (read the events); **CrashLoopBackOff** — the program started and exited (read `logs --previous`). The phase alone can mislead; READY, RESTARTS and the events do not.
