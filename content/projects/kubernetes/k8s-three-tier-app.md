---
id: k8s-three-tier-app
track: kubernetes
title: Deploy a three-tier application
level: beginner
estimated_hours: 4
prerequisites: [kubernetes-deployments-and-self-healing, kubernetes-services-and-rollouts, kubernetes-namespaces-labels-selectors, kubernetes-configmaps-and-secrets]
related_tracks: [docker, redis]
user_stories:
  - As a student developer, I want the notice board's frontend, API and database described as Kubernetes manifests so that anyone can start the whole application with one kubectl apply.
  - As an operator, I want each tier behind its own Service that selects exactly that tier's Pods so that requests reach the right containers even as Pods are replaced.
  - As a team lead, I want configuration kept in a ConfigMap and every image pinned so that the same manifests behave the same way in every cluster.
acceptance_criteria:
  - kubectl apply -R -f k8s/ succeeds and every object is in the namespace campus.
  - The Deployments frontend (at least 2 replicas), api (at least 2) and redis (1) become Available with all replicas ready; their Pods carry the labels app campus and tier frontend, api or database.
  - The ClusterIP Services frontend (port 80), api (port 8080) and redis (port 6379) each route to exactly the ready Pods of their own tier.
  - The api Deployment takes REDIS_HOST from a ConfigMap named api-config.
  - Every container image is pinned to a version (not latest), preferably with a digest.
  - From inside the cluster, GET / on the frontend returns the notice board page, and GET /api/visits returns a counter that grows — the request has passed frontend → api → redis.
rubric:
  - { criterion: "Labels and selectors", excellent: "One consistent labelling scheme (app + tier) used by every Deployment selector, Pod template and Service, and the learner can show with kubectl get endpointslices which Pods each Service reaches.", good: "Every Service reaches the right Pods.", needs_work: "A Service with no endpoints, or one that also reaches another tier's Pods." }
  - { criterion: "Configuration", excellent: "Settings in a ConfigMap, nginx files mounted from a ConfigMap, nothing environment-specific written into Deployments, and a note on what would go into a Secret instead (a Redis password).", good: "REDIS_HOST comes from api-config.", needs_work: "Values hard-coded in the Deployment or baked into images." }
  - { criterion: "Reproducibility", excellent: "Images pinned by tag and digest, replicas and ports explicit, and the README explains how to start, test (port-forward) and delete the application.", good: "Images pinned by tag; the manifests apply cleanly on a fresh cluster.", needs_work: "latest tags, or manifests that only work after manual steps." }
hints:
  - "Start with kubectl -n campus get endpointslices: a Service whose selector matches no Pod has no endpoints, even though the Deployment is healthy."
  - A Service's selector must match the labels in the Deployment's Pod template (spec.template.metadata.labels), not the Deployment's own labels.
  - "env with valueFrom: configMapKeyRef: { name: api-config, key: REDIS_HOST } reads one key; envFrom: configMapRef reads them all."
  - To mount one key of a ConfigMap as one file without hiding the rest of the directory, use a volumeMount with subPath — such files do not receive ConfigMap updates, so roll the Pods after changing it.
  - nginx resolves api when it starts, so the api Service must exist first — kubectl apply creates every object in one go, so that is the case.
stretch_goals:
  - Add a readiness probe to each tier (nginx on /, but not the API's /cgi-bin/visits — why not?) and see that a Pod gets traffic only when ready.
  - Give Redis a password in a Secret and pass it to Redis and to the API without writing it in any Deployment.
  - Expose the frontend through a Gateway, as in the lesson on how traffic enters a cluster.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The campus notice board has three tiers: an **nginx frontend** that serves the page, a small **API** that counts
visits, and **Redis**, where the count is stored. Each tier runs as its own Deployment behind its own Service, in
the namespace `campus`, so a request travels frontend → api → redis by Service name.

The starter has the Redis tier finished as a pattern, an API that runs but cannot be reached (its Service selects
no Pods) and still has its Redis address written into the Deployment, and the frontend's configuration and page
without a Deployment or a Service. Your manifests must make the whole chain work on a fresh cluster.

The check creates a throwaway kind cluster with the node image the lessons pin, applies your `k8s/` folder, waits
for the Deployments, compares every Service's endpoints with the Pods of its tier, and sends requests from a Pod
inside the cluster. It needs **Docker, kind and kubectl** on your machine (the first Kubernetes lesson links the
installation pages) and takes two to three minutes; it deletes the cluster at the end.

## Getting started

1. Copy the starter folder and read `README.md` and `k8s/redis.yaml`.
2. Start a cluster as in the lessons and apply what is there:

   ```bash
   kind create cluster --name campus --image kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5 --wait 120s
   kubectl apply -R -f k8s/
   kubectl -n campus get deploy,svc,endpointslices
   ```

3. Fix the API, add `api-config` and the frontend, apply again, and test through a port-forward:

   ```bash
   kubectl -n campus port-forward service/frontend 8080:80
   curl http://localhost:8080/api/visits
   ```

4. Delete your cluster (`kind delete cluster --name campus`) and run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
