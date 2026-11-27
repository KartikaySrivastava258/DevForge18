---
id: k8s-probes-and-limits
track: kubernetes
title: Resource-limited service with health probes
level: advanced
estimated_hours: 6
prerequisites: [kubernetes-probes-requests-and-limits, kubernetes-services-and-rollouts, kubernetes-deployments-and-self-healing]
related_tracks: [prometheus-grafana]
user_stories:
  - As a platform engineer, I want every container to declare CPU and memory requests and limits so that the scheduler can place it and a leaking container cannot starve its neighbours.
  - As an on-call engineer, I want a hung container restarted automatically and a draining Pod taken out of traffic without a restart so that most incidents fix themselves without paging anyone.
  - As a developer of a slow-starting service, I want start-up protected by a startup probe so that a strict liveness probe never kills a container that is still loading.
acceptance_criteria:
  - The Deployment grades starts 3 replicas, all ready, with no container restarted during the 12-second start-up.
  - The container sets CPU and memory requests and limits; the memory limit is at most 256Mi and not below the request.
  - The container has a startup, a readiness and a liveness probe.
  - A Pod that is draining (/cgi-bin/ready answers 503) leaves the Service's ready endpoints and is not restarted.
  - A hung container (/cgi-bin/healthz stops answering) is restarted by its liveness probe within 45 seconds.
  - A container whose memory keeps growing is killed at its limit — its status shows lastState.terminated.reason OOMKilled.
  - Afterwards all Pods are ready and back in the Service.
rubric:
  - { criterion: "Probe design", excellent: "Each probe answers one question (started? ready for traffic? stuck?), thresholds are derived from the 12 s start-up and the 30 s restart target and written down, and liveness checks nothing outside the container.", good: "Startup, readiness and liveness use the right endpoints and pass every scenario.", needs_work: "Liveness on the readiness endpoint, no startup probe with a tight liveness probe, or probes copied without knowing the timings." }
  - { criterion: "Resources", excellent: "Requests and limits justified from measurements (kubectl top or Prometheus), the QoS class chosen on purpose and explained, CPU throttling versus OOM kill explained.", good: "Sensible requests and limits; the leak is stopped at the limit.", needs_work: "No requests or limits, or a memory limit far above what the service needs." }
  - { criterion: "Operations", excellent: "A short runbook in the README: how to drain a Pod, how to read restart counts, OOMKilled and Unhealthy events, and what to change if each one starts happening often.", good: "The learner can show each scenario with kubectl get pods and kubectl describe.", needs_work: "No way to tell what happened after the fact." }
hints:
  - "Readiness answers \"should this Pod get traffic now?\"; liveness answers \"is this process stuck beyond repair?\". A draining Pod is ready = no, alive = yes."
  - "A liveness probe that fails 3 times 3 seconds apart restarts a container in about 10 seconds — and also during the 12-second start-up, unless a startup probe holds it back."
  - "The startup probe's periodSeconds × failureThreshold is the longest start-up you allow; the other probes start only after it succeeds."
  - "kubectl get pod NAME -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' shows OOMKilled after a memory-limit kill, and kubectl get events shows Unhealthy events for failed probes."
  - Without a memory limit a leak is stopped only when the node runs out of memory — the check refuses to run the leak in that case.
stretch_goals:
  - Set requests equal to limits, read the Pod's QoS class (status.qosClass) before and after, and use the Kubernetes documentation to explain the difference and when it is worth the cost.
  - Graph restarts and OOM kills in Grafana (kube-state-metrics) and alert when a Pod restarts more than three times in ten minutes.
  - Add a PodDisruptionBudget and explain how it relates to readiness during node maintenance.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The grades service publishes course results. It needs about 12 seconds to load its cache before it listens, it
has been seen to hang once a term, and a memory leak in an old version once slowed down every service on its
node. Today its Deployment tells Kubernetes nothing: no requests or limits, no probes. Kubernetes therefore
sends traffic to Pods that are still loading or hung and lets a leak grow without bound.

`app.yaml` is the application — busybox httpd running small scripts — with health endpoints
(`/cgi-bin/healthz` for "alive", `/cgi-bin/ready` for "ready for traffic", which answers 503 while a Pod is
draining) and endpoints that simulate trouble. You change only `deployment.yaml`.

The check creates a throwaway kind cluster, applies both files, checks start-up, resources and probes, and then,
on three different Pods at the same time, **drains** one, **hangs** one and makes one **leak memory**. It reads the
result where Kubernetes records it: the Service's endpoints, `restartCount`, `lastState.terminated.reason` and
the Unhealthy events. It needs **Docker, kind and kubectl** on your machine (the first Kubernetes lesson links
the installation pages) and takes about three minutes; it deletes the cluster at the end.

## Getting started

1. Copy the starter folder and read `README.md` and `app.yaml`.
2. Start a cluster as in the lessons, apply both files and watch a Pod start:

   ```bash
   kind create cluster --name grades --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5 --wait 120s
   kubectl apply -f app.yaml -f deployment.yaml
   kubectl get pods -w
   ```

3. Add resources and probes, apply again, and try each scenario on one Pod:

   ```bash
   pod=$(kubectl get pods -l app=grades -o jsonpath='{.items[0].metadata.name}')
   kubectl exec "$pod" -- wget -qO- http://127.0.0.1:8080/cgi-bin/hang
   kubectl get pod "$pod" -w     # does RESTARTS go up? how long does it take?
   ```

4. Delete your cluster (`kind delete cluster --name grades`) and run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
