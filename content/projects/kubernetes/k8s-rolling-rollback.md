---
id: k8s-rolling-rollback
track: kubernetes
title: Rolling deployment and rollback demo
level: intermediate
estimated_hours: 5
prerequisites: [kubernetes-services-and-rollouts, kubernetes-probes-requests-and-limits, kubernetes-deployments-and-self-healing]
related_tracks: [github-actions, nginx]
user_stories:
  - As a release manager, I want every release to replace Pods gradually and only after the new ones are ready so that users keep being served while a version changes.
  - As an on-call engineer, I want a release script that notices a stuck rollout and rolls back by itself so that a bad image never stays in production waiting for a human.
  - As a team lead, I want each release recorded in the rollout history with its reason so that we can see what changed and undo it with confidence.
acceptance_criteria:
  - The Deployment web runs at least 3 replicas, all ready, and the Service web serves the first version (nginx 1.27).
  - The Deployment uses a RollingUpdate with maxUnavailable 0, and the container web has a readiness probe.
  - release.sh IMAGE exits 0 only after the rollout has finished; afterwards every request is served by the new version (nginx 1.28), and kubectl rollout history shows the release's change-cause.
  - During a broken release (a build that starts but never answers) the Service sends no request to the broken Pods and the number of ready working Pods never drops.
  - release.sh notices the stuck rollout within ROLLOUT_TIMEOUT, rolls back with kubectl rollout undo, and exits non-zero; afterwards no broken Pods are left and traffic is served by the previous image.
rubric:
  - { criterion: "Rollout safety", excellent: "maxUnavailable 0 with a deliberate maxSurge, a cheap readiness probe with explained thresholds, and the README shows how long a stuck rollout takes to be noticed.", good: "Readiness probe and maxUnavailable 0; the broken release never reaches users.", needs_work: "Default strategy or no readiness probe, so a broken version takes traffic or capacity drops." }
  - { criterion: "Release script", excellent: "Fails fast on bad arguments, records a change-cause, waits with a configurable timeout, rolls back, waits for the rollback and reports clearly what happened.", good: "Waits, rolls back and returns the right exit code.", needs_work: "Fire-and-forget: kubectl set image and exit 0." }
  - { criterion: "Traceability", excellent: "Every revision in kubectl rollout history says what was released and why, images are pinned by digest, and revisionHistoryLimit is set on purpose.", good: "Releases appear in the history with a change-cause.", needs_work: "CHANGE-CAUSE shows <none>; nobody can tell which revision is which." }
hints:
  - "kubectl rollout status deployment/web --timeout=…s exits non-zero when the rollout has not finished in time — that exit code is the signal for rolling back."
  - "Without a readiness probe a Pod is ready as soon as its container runs, so a version that never answers still gets traffic and the rollout \"succeeds\"."
  - "The default maxUnavailable is 25%: Kubernetes may stop an old Pod before the new one is ready. With maxUnavailable: 0 it must add a new ready Pod first (maxSurge)."
  - Set the kubernetes.io/change-cause annotation on the Deployment before changing the image; the new ReplicaSet takes it over and kubectl rollout history shows it.
  - Run release.sh against your own kind cluster with ROLLOUT_TIMEOUT=30s and a tag that does not exist, as in the lesson, and watch kubectl get pods in a second terminal.
stretch_goals:
  - Call release.sh from a GitHub Actions job against a kind cluster, so a failed release fails the pipeline.
  - Add minReadySeconds and explain how it changes what "available" means during a rollout.
  - Measure errors during a good rollout with a request loop and find out why a few can still fail while old Pods shut down (look up preStop hooks and terminationGracePeriodSeconds).
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The timetable site is the Deployment `web` (container `web`, nginx) behind the Service `web`. Releases are made
with `release.sh IMAGE`, which today only changes the image and exits. Last term a release with a broken image
replaced every working Pod and took the site down. Make releases safe: a rolling update that keeps serving with
the old version until the new one is ready, and a release script that waits, records why the version changed,
and rolls back by itself when a rollout gets stuck.

The check creates a throwaway kind cluster, applies `deployment.yaml`, and runs your `release.sh` twice while a
Pod inside the cluster keeps requesting the Service and reads the `Server` header (it names the nginx version):

1. a good release, nginx 1.27 → 1.28;
2. a broken build that starts but never answers on port 80 — the check uses the `pause` image, which runs forever
   and does nothing, just like a server stuck at start-up. It sets `ROLLOUT_TIMEOUT=40s` for this one.

It needs **Docker, kind and kubectl** on your machine (the first Kubernetes lesson links the installation pages)
and takes about three minutes; it deletes the cluster at the end.

## Getting started

1. Copy the starter folder and read `README.md`, `deployment.yaml` and `release.sh`.
2. Start a cluster as in the lessons, apply the Deployment and try a broken release the way the lesson did:

   ```bash
   kind create cluster --name rollout --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5 --wait 120s
   kubectl apply -f deployment.yaml
   ROLLOUT_TIMEOUT=30s bash release.sh nginx:does-not-exist
   kubectl get pods; kubectl rollout history deployment/web
   ```

3. Change the strategy, add the readiness probe, and make `release.sh` wait, record and roll back. Try a good
   release (`nginx:1.28-alpine`) and a broken one again.
4. Delete your cluster (`kind delete cluster --name rollout`) and run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
