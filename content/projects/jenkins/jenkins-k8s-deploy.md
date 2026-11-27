---
id: jenkins-k8s-deploy
track: jenkins
title: Jenkins + Kubernetes deployment lab
level: advanced
estimated_hours: 10
prerequisites: [jenkins-pipeline-as-code, jenkins-securing-jenkins, jenkins-shared-libraries, jenkins-configuration-as-code]
related_tracks: [kubernetes, github-actions]
user_stories:
  - As a release manager, I want every commit on main deployed to staging automatically and to production only after I approve so that customers only see releases someone has looked at.
  - As an on-call engineer, I want a release whose pods do not become ready to be rolled back by the pipeline so that a bad image does not stay in front of users.
  - As an operator, I want the pipeline to deploy the image built for that exact commit, with probes and resource limits, so that I know what runs and the cluster can manage it.
  - As a security reviewer, I want the cluster credentials kept in Jenkins and the approval wait to hold no executor so that neither secrets nor build capacity leak.
acceptance_criteria:
  - Jenkins' declarative linter accepts the Jenkinsfile, and the Jenkinsfile contains no cluster token or TLS shortcut (the kubeconfig credential is used).
  - "Build #1 deploys $REGISTRY/campus-notes-api:sha-<commit> to staging and waits until the rollout is complete before asking for approval (input id Promote); production is untouched until then."
  - After the approval the build succeeds and production runs the same image with a completed rollout.
  - The manifests are validated by the API server (kubectl apply --dry-run=server) before they are applied.
  - The production Deployment has at least 2 replicas, a readiness probe on /health port 3000, CPU and memory requests and limits, and runAsNonRoot; the Service selects its pods and targets port 3000.
  - When a release's pods never become ready, the build fails, staging is rolled back to the previous image, and production is untouched.
  - When the reviewer rejects a release, the build is aborted and production keeps the previous image.
rubric:
  - { criterion: "Promotion design", excellent: "Build once, promote the same image digest or tag through staging and production with one script; the approval is a stage-level input that holds no executor and times out; concurrency is disabled.", good: "Staging, approval and production work in order with the same image.", needs_work: "Production is deployed without approval, or each environment deploys something different." }
  - { criterion: "Failure handling", excellent: "Rollout status with a timeout, automatic rollout undo, a failed build that says why, and a documented manual rollback; probes are tuned so a slow start is not mistaken for failure.", good: "A failed rollout is rolled back and fails the build.", needs_work: "The pipeline reports success while pods never become ready." }
  - { criterion: "Manifests", excellent: "Replicas, probes, requests and limits, non-root security context, maxUnavailable 0, consistent labels between Deployment and Service, and server-side validation before applying.", good: "All required fields are present and validated.", needs_work: "One replica without probes or limits, or manifests applied without validation." }
  - { criterion: "Security and maintainability", excellent: "Credentials only through withCredentials with single-quoted sh, deployment logic in a script or shared library step that also runs locally, and the README explains the trust boundaries (who can approve, what the kubeconfig can do).", good: "Credentials stay in Jenkins and the logic is readable.", needs_work: "Tokens in the Jenkinsfile, or long inline shell nobody can test." }
hints:
  - Write the deployment as a script first (scripts/deploy.sh NAMESPACE IMAGE) and make it work by hand against any cluster you have (for example kind from the Kubernetes track). The Jenkinsfile then only calls it twice.
  - kubectl rollout status deployment/campus-notes-api -n staging --timeout=40s exits non-zero when the rollout does not complete; kubectl rollout undo returns to the previous revision.
  - "A stage-level input directive (input { id 'Promote'; message …; ok … }) is evaluated before the stage's agent is allocated, so nobody's executor waits for the reviewer. With agent none at the top, give each working stage its own agent any."
  - "withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) puts the secret file on the agent for the block's duration, and kubectl reads KUBECONFIG."
  - The image tag comes from the commit — 'sha-' + env.GIT_COMMIT.substring(0, 7) — so staging and production run exactly the image the container pipeline built for that commit.
stretch_goals:
  - Move deploy.sh into a shared library step (deployTo('staging')) as in the lesson on shared libraries.
  - Restrict who may approve (input submitter) and give staging and production separate kubeconfig credentials with namespace-scoped RBAC.
  - Run the whole flow against a real kind cluster from the Kubernetes track, with the image from the container project loaded into it.
starter: starter
solution: solution
check_needs: [docker, git, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The Campus Notes API runs on the campus Kubernetes cluster. Its Jenkinsfile applies `k8s/` straight to
production whenever `main` changes: no staging, no approval, `latest` as the image, one replica without
probes, and no check that the new pods ever start. The last bad image took the service down for an afternoon.

Build a deployment pipeline: test, deploy this commit's image to `staging`, wait for the rollout, ask a person,
then deploy the same image to `production`. If the new pods do not become ready, roll back and fail. Make the
manifests worth deploying — replicas, probes, resources, a non-root security context — and keep the cluster
credentials in Jenkins.

## What the check runs, and what it cannot

The check starts a **real, throwaway Jenkins** (2.580.2 with pinned plugins and `kubectl` v1.36.1, configured as
code with the `kubeconfig` file credential) and a **real Kubernetes control plane without nodes**: etcd,
kube-apiserver and kube-controller-manager v1.36.1. Your `kubectl` commands talk to a genuine API server, which
validates and stores the objects, and the genuine controllers run your Deployment's rollouts, ReplicaSets and
`rollout undo`.

There are no nodes, so **no container ever starts**. A small script in the check plays the kubelet: it marks
each new pod Ready — except pods whose image the check has declared broken, which it reports as `ErrImagePull`.
So the check verifies your pipeline's logic (staging first, approval, the same image, rollout status, rollback,
rejection) and what you deploy (read back from the API server), but not that the application really starts in
a cluster, that probes pass, or that the image exists in a registry. The stretch goal with kind covers that.

The check runs three builds: build #1 (it approves at the `Promote` input), build #2 with an image whose pods
never become ready, and build #3, whose approval it rejects. It takes about three minutes.

## Getting started

1. Copy the starter and read its README (the fixed interface: the credential, the namespaces, the names and
   the input id).
2. Write `k8s/deployment.yaml` properly and a deploy script; try them on any cluster you have (kind from the
   Kubernetes track works).
3. Rewrite the Jenkinsfile and run the check (Docker, Git, curl, Python 3 and openssl):

   ```bash
   bash check.sh path/to/campus-notes-api
   ```
