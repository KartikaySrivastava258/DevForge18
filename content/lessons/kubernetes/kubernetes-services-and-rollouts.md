---
id: kubernetes-services-and-rollouts
title: Services, rolling updates and rollback
track: kubernetes
order: 2
level: beginner
estimated_minutes: 40
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Give Pods a stable address with a Service and reach it from your machine.
  - Roll out a new image version without downtime.
  - See how a failed rollout leaves the old version serving, and roll back.
  - Read a Deployment's rollout history.
resources:
  - title: kind quick start
    url: https://kind.sigs.k8s.io/docs/user/quick-start/
    publisher: Kubernetes SIGs
    type: tutorial
    level: beginner
    official: true
    why: Official installation and usage guide for kind (Kubernetes in Docker), the local cluster used here.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: kind releases
    url: https://github.com/kubernetes-sigs/kind/releases
    publisher: Kubernetes SIGs
    type: reference
    level: intermediate
    official: true
    why: Each release lists its default node image with an exact digest — the source of the pinned image in these lessons.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Kubernetes Basics tutorial
    url: https://kubernetes.io/docs/tutorials/kubernetes-basics/
    publisher: The Kubernetes Authors
    type: tutorial
    level: beginner
    official: true
    why: Official step-by-step introduction to deploying, exposing, scaling and updating an app.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: service
    prompt: Why connect to a Service rather than directly to a Pod's IP address?
    options:
      - { id: a, text: "Pod IP addresses are encrypted" }
      - { id: b, text: "Pods are replaced with new addresses; a Service keeps one stable name and address and sends traffic to whichever matching Pods are ready" }
      - { id: c, text: "Services make Pods start faster" }
    answer: b
    explanation: A Service selects Pods by label and load-balances across the ready ones. Other workloads in the cluster reach it by DNS name — here simply web.
  - id: failed-rollout
    prompt: A new image cannot be pulled. What happens to the users of the Deployment?
    options:
      - { id: a, text: "All Pods are stopped immediately and the site goes down" }
      - { id: b, text: "The rolling update stalls: new Pods never become ready, so Kubernetes stops replacing old ones, and the old version keeps serving" }
      - { id: c, text: "Kubernetes automatically picks a different image" }
    answer: b
    explanation: A rolling update only removes old Pods as new ones become ready, within the maxUnavailable limit (25% by default). A broken release therefore stalls instead of replacing everything — then you roll back.
  - id: rollback
    prompt: What does kubectl rollout undo deployment/web do?
    options:
      - { id: a, text: "It deletes the Deployment" }
      - { id: b, text: "It rolls the Deployment back to the previous revision of its Pod template, through a normal rolling update" }
      - { id: c, text: "It restarts the cluster" }
    answer: b
    explanation: Each change to the Pod template creates a revision. undo returns to the previous one (or a specific one with --to-revision), using the same safe rollout mechanism.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with a real kind 0.32.0 cluster running Kubernetes 1.36.1, after the previous lesson; the documented output was confirmed in CI run 45643638519 on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

A **Service** gives a changing set of Pods one stable address, and a **rolling update** replaces Pods gradually — so a bad release can be stopped and **rolled back** before users notice.

## Explain it like I'm twelve

A school office has one phone number, even though different staff answer it each day. That number is the Service; the staff on duty are the Pods. When new staff are trained (a new version), they start answering one at a time — and if a new person clearly cannot do the job, the experienced staff simply keep answering until the problem is sorted.

Where the analogy breaks: Kubernetes checks readiness automatically and only routes calls to staff who are ready.

## What problem it solves

Pods come and go, so their addresses cannot be written into other programs. And replacing every copy of an application at once means downtime — or a total outage if the new version is broken. Services and rolling updates solve both: a stable address, and releases that replace capacity gradually and can be reversed.

## How it works

```diagram steps=kubernetes/rolling-update
```


## Try it yourself

> **Local lab** — continue with the `devforge` cluster from the previous lesson. Every command is run automatically in DevForge's CI with kind 0.32.0 and Kubernetes 1.36.1; see the note at the top for the current verification status. Values that change on every run are shown as `…`.

### 1. Expose the Deployment

```bash run
kubectl expose deployment web --port=80
kubectl get service web -o jsonpath='{.spec.type}{"\n"}'
```

```text output
service/web exposed
ClusterIP
```

A `ClusterIP` Service is reachable inside the cluster at the name `web`. To reach it from your own machine for testing, forward a local port:

```bash run
kubectl port-forward service/web 8086:80 > /dev/null 2>&1 &
forward_pid=$!
curl -s --retry 10 --retry-connrefused --retry-delay 1 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8086/
kill "$forward_pid"
```

```text output
200
```

`--retry-connrefused` waits until the port-forward is listening — another example of waiting for a condition rather than sleeping.

### 2. Roll out a new version

```bash run
kubectl set image deployment/web nginx=nginx:1.28-alpine
kubectl rollout status deployment/web --timeout=180s
kubectl rollout history deployment/web
```

```text output
deployment.apps/web image updated
…
deployment "web" successfully rolled out
deployment.apps/web…
REVISION…CHANGE-CAUSE
1…<none>
2…<none>
```

`nginx` is the container's name inside the Pod template (taken from the image name when the Deployment was created). Each template change is a new **revision**.

### 3. Ship a broken release

Now deploy an image tag that does not exist, as if a pipeline had a typo:

```bash run fails
kubectl set image deployment/web nginx=nginx:does-not-exist
kubectl rollout status deployment/web --timeout=60s
```

```text output
deployment.apps/web image updated
…
error: timed out waiting for the condition
```

The rollout is stuck. What are users getting meanwhile?

```bash run
reasons=$(kubectl get pods -l app=web -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}')
echo "$reasons" | grep -E 'ErrImagePull|ImagePullBackOff' > /dev/null && echo "new pods cannot pull their image"
available=$(kubectl get deployment web -o jsonpath='{.status.availableReplicas}')
echo "old pods still serving: $available available"
```

```text output
new pods cannot pull their image
old pods still serving: 4 available
```

With five replicas, the default `maxUnavailable` of 25% allows only one Pod to be taken away. The new Pods never became ready, so Kubernetes stopped there: four Pods of the previous version are still serving.

### 4. Roll back

```bash run
kubectl rollout undo deployment/web
kubectl rollout status deployment/web --timeout=180s
kubectl get deployment web -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

```text output
deployment.apps/web rolled back
…
deployment "web" successfully rolled out
nginx:1.28-alpine
```

### 5. Delete the cluster

```bash run
kind delete cluster --name devforge
```

```text output
Deleting cluster "devforge" ...
…
```

## Try it in the simulation

Replay this lesson's broken release in the simulation, then try the other challenges: change the rollout strategy and see how many Pods stay available. It is a labelled teaching model of the reconciliation loop, not a real cluster.

```simulation kubernetes-reconciliation scenario=broken-release
```

## Common mistakes

- **Connecting to Pod IPs.** They change; use Services.
- **No readiness probe.** Without one, Kubernetes may send traffic to a Pod before the application inside is ready. Real Deployments define readiness and liveness probes.
- **Deploying `latest`.** You cannot tell which version is running, and rollback cannot return to "the previous latest".
- **Ignoring a stuck rollout.** `rollout status` with a timeout in CI turns a stalled release into a visible failure.
- **Using `port-forward` as production access.** It is for debugging; production traffic arrives through an Ingress or Gateway controller or a load balancer.

## Where this fits in a real system

A delivery pipeline builds an image in **GitHub Actions** or **Jenkins**, updates the Deployment, and runs `kubectl rollout status`; if it fails, the pipeline rolls back automatically. **Prometheus** and **Grafana** show error rates during a rollout, so a bad release is visible within minutes, and **Nginx**-style ingress controllers route outside traffic to Services.
