---
id: kubernetes-self-healing-and-rollouts
title: Change replica count and observe self-healing
track: kubernetes
level: intermediate
mode: simulation
estimated_minutes: 30
prerequisites: [kubernetes-deployments-and-self-healing, kubernetes-services-and-rollouts]
objectives:
  - Predict, then watch, how the Deployment and ReplicaSet controllers repair a deleted Pod and a change in replicas.
  - Choose maxSurge and maxUnavailable so a rolling update keeps enough Pods serving.
  - Diagnose a stalled rollout from Pod phases and events, and recover with a rollback.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: kubernetes-reconciliation
  challenges: [self-heal, update-keeping-four, recover-broken-release]
resources:
  - title: Deployments
    url: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
    publisher: Kubernetes documentation
    type: documentation
    level: intermediate
    official: true
    why: Rolling updates, maxSurge and maxUnavailable, rollout status and rollback.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model. Its rolling-update rules follow the Kubernetes Deployment documentation (checked 2026-11-26), and a stalled broken-image rollout matches what the Kubernetes lessons show on a real kind cluster. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the reconciliation simulation like a scientist: **predict** what the controllers will do, **run** the experiment, and **compare** with the event log. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of Kubernetes, not a cluster; the lessons *Deployments and self-healing* and *Services and rolling updates* show the same behaviour on a real kind cluster.

## Steps

### 1. Self-healing

Choose the scenario **Three replicas on two nodes**. Before you touch anything, write down:

- If you delete one Pod, which controller notices first?
- How many ticks until three Pods are ready again?

Now delete a Pod and press **Step** one tick at a time, reading the event log after each tick. Then try **scaling** to 5 and back to 2 and predict where the new Pods will be placed.

The ReplicaSet controller compares *desired* with *actual* Pods. Deleting a Pod is just a difference to fix — exactly what happens when a real node loses a Pod.

### 2. A rolling update that keeps four Pods serving

Choose **Five replicas with a risky update strategy**. Its strategy allows `maxUnavailable: 50%`.

- Work out how many Pods may be unavailable at once: 50 % of 5 is 2.5, and maxUnavailable **rounds down**, so 2.
- Predict the lowest number of available Pods during an update with this strategy.

Change the strategy so that at most one Pod can be unavailable, **then** set the image to `nginx:1.28-alpine` and step through the rollout. Watch the old and new ReplicaSets trade replicas.

### 3. Recover from a broken release

Choose **A release with a broken image**. Someone deployed `nginx:does-not-exist`.

- Read the new Pods' phase. What do `ErrImagePull` and `ImagePullBackOff` tell you?
- Why does the rollout stop instead of replacing every Pod? (Look at how many old Pods are still available.)

Recover by rolling back to the previous revision (or by setting a working image), and step until every Pod is ready.

## Simulation

```simulation kubernetes-reconciliation
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

Kubernetes does not run your commands step by step; it keeps comparing desired with actual state. The rollout limits (`maxSurge`, `maxUnavailable`) decide how much capacity an update may take away, and a stalled rollout is the system protecting you from a broken image.
