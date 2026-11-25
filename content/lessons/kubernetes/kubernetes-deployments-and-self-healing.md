---
id: kubernetes-deployments-and-self-healing
title: Deployments, Pods and self-healing
track: kubernetes
order: 1
level: beginner
estimated_minutes: 40
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain desired state and how Kubernetes controllers keep reality matching it.
  - Create a local cluster with kind, pinned to an exact node image.
  - Run an application as a Deployment and read its status with kubectl.
  - Watch Kubernetes replace a deleted Pod and scale a Deployment.
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
  - id: desired-state
    prompt: You delete one of a Deployment's three Pods. Why does a new one appear?
    options:
      - { id: a, text: "kubectl automatically re-runs the create command" }
      - { id: b, text: "The Deployment declares three replicas; a controller keeps comparing desired and actual state and creates a Pod to close the gap" }
      - { id: c, text: "Deleted Pods are restored from a backup" }
    answer: b
    explanation: You declare the end state, and controllers reconcile continuously. That is why Kubernetes heals crashed or deleted Pods without anyone running a command.
  - id: pod-vs-container
    prompt: What is a Pod?
    options:
      - { id: a, text: "Another name for a Docker image" }
      - { id: b, text: "The smallest unit Kubernetes schedules: one or more containers that share a network address and can share storage" }
      - { id: c, text: "A whole cluster node" }
    answer: b
    explanation: Usually a Pod holds one application container. Pods are disposable and get new names and addresses when replaced — which is why you manage them through Deployments and reach them through Services.
  - id: digest
    prompt: Why pin the node image as kindest/node:v1.36.1@sha256:… instead of just kindest/node:v1.36.1?
    options:
      - { id: a, text: "The digest identifies the exact image bytes, so the cluster is reproducible even if the tag were ever moved" }
      - { id: b, text: "Digests download faster" }
      - { id: c, text: "kind refuses tags without digests" }
    answer: a
    explanation: A tag is a movable label; a digest is a content hash. kind's release notes publish the digest for each node image so that clusters can be recreated exactly.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, creating a real kind 0.32.0 cluster with Kubernetes 1.36.1 (node image pinned by digest) and kubectl 1.36.1; the documented output was confirmed in CI run 45643638519 on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Kubernetes** runs containers across a cluster and keeps them matching the **desired state** you declare — for example "three copies of this web server" — replacing anything that fails.

## Explain it like I'm twelve

Think of a thermostat. You don't switch the heater on and off yourself; you set the temperature you want, and the thermostat keeps checking and correcting. A Kubernetes Deployment is a thermostat for applications: you set "three copies", and if one disappears, Kubernetes notices and starts another.

Where the analogy breaks: Kubernetes has many such controllers working at once — for copies, rollouts, networking and more — all reading and updating the same record of desired state.

## What problem it solves

Running containers by hand on several servers means someone must restart crashed processes, spread load, roll out new versions without downtime and send traffic only to healthy copies. Kubernetes automates those jobs behind one declarative API. It is not needed for every project — a single server or Docker Compose is often simpler — but it shines when many services must stay up across many machines.

## How it works

![](media:kubernetes/desired-state.svg)


- A **Deployment** manages a **ReplicaSet**, which keeps the requested number of **Pods** running.
- Pods carry **labels** (here `app=web`); controllers and Services find Pods through label **selectors**, not by name.
- A **node** is a machine that runs Pods. **kind** runs each Kubernetes node as a Docker container — ideal for learning and for CI.

## Try it yourself

> **Local lab** — needs Docker, plus `kind` and `kubectl` from the official installation pages linked in the resources (on macOS with Homebrew: `brew install kind kubectl`; on Windows, WSL is the simplest route). The cluster is created and deleted on your own machine. Every command is run automatically in DevForge's CI with kind 0.32.0 and Kubernetes 1.36.1; see the note at the top for the current verification status. Values that change on every run, such as ages and Pod names, are shown as `…`.

### 1. Create a cluster

```bash run
kind create cluster --name devforge --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5 --wait 120s
```

The image is pinned by **digest** (`@sha256:…`), copied from kind's release notes, so this exact cluster can be recreated any time. Creating it takes a minute or two the first time, while the node image downloads.

```bash run
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl get nodes
```

```text output
node/devforge-control-plane condition met
NAME                     STATUS   ROLES           AGE…VERSION
devforge-control-plane   Ready    control-plane   …v1.36.1
```

`kubectl wait` blocks until the node is ready, instead of guessing with `sleep`.

### 2. Run three copies of a web server

```bash run
kubectl create deployment web --image=nginx:1.27-alpine --replicas=3
kubectl rollout status deployment/web --timeout=180s
```

```text output
deployment.apps/web created
…
deployment "web" successfully rolled out
```

```bash run
kubectl get deployment web
kubectl get pods -l app=web --no-headers | wc -l
```

```text output
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    3/3     3            3           …
3
```

`READY 3/3` means three of the three desired Pods are ready. `-l app=web` selects Pods by the label the Deployment gave them.

### 3. Delete a Pod and watch Kubernetes heal

```bash run
pod=$(kubectl get pods -l app=web -o name | head -n 1)
kubectl delete "$pod"
kubectl rollout status deployment/web --timeout=180s
kubectl get pods -l app=web --no-headers | wc -l
```

```text output
pod "web-…" deleted…
…
deployment "web" successfully rolled out
3
```

You deleted a Pod, yet there are still three: the ReplicaSet saw two where three were desired and created a replacement with a new name. Nobody had to restart anything.

### 4. Scale up

```bash run
kubectl scale deployment web --replicas=5
kubectl rollout status deployment/web --timeout=180s
kubectl get deployment web --no-headers -o custom-columns=READY:.status.readyReplicas
```

```text output
deployment.apps/web scaled
…
deployment "web" successfully rolled out
5
```

Keep the cluster running for the next lesson. To stop for now and remove everything, run `kind delete cluster --name devforge`.

## Common mistakes

- **Managing Pods directly.** A Pod created on its own is not replaced when it dies; use a Deployment.
- **Using `sleep` to wait for the cluster.** Use `kubectl wait` and `kubectl rollout status`, which wait for the real condition.
- **Unpinned images such as `nginx:latest`.** Every node may pull a different version; pin tags or digests.
- **Expecting Pod names to stay the same.** Replacements get new names and addresses; select by labels instead.
- **Reaching for Kubernetes too early.** For one small app, the operational cost can outweigh the benefits.

## Where this fits in a real system

CI pipelines in **GitHub Actions** or **Jenkins** build **Docker** images and update a Deployment's image; Kubernetes rolls it out across the cluster. **Terraform** often creates the cluster itself, and **Prometheus** watches the health of Pods and nodes.
