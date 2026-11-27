# Campus Notes API — deployment to Kubernetes

The container pipeline (the Jenkins intermediate project) pushes an image for every commit on `main`:
`$REGISTRY/campus-notes-api:sha-<first 7 characters of the commit>`. This repository's Jenkinsfile deploys
that image to the campus Kubernetes cluster, which has two namespaces: `staging` and `production`.

## What Jenkins and the cluster provide (fixed interface — the check relies on it)

- The pipeline is the declarative `Jenkinsfile`, built from `main` (a Pipeline job; `GIT_COMMIT` is set).
- `kubectl` is installed where the build runs. The Jenkins credential `kubeconfig` (secret file) can deploy
  to the namespaces `staging` and `production`, which already exist.
- `REGISTRY` (an environment variable set in Jenkins) is the registry's address.
- The Deployment and the Service are both called `campus-notes-api`; the container is called `api`, listens on
  port 3000 and answers `GET /health`.
- The approval before production is an `input` with the id `Promote`.

## How a release flows (reference solution)

1. **Test** — `npm ci` and `npm run test:ci`, with the JUnit report published.
2. **Deploy to staging** — `scripts/deploy.sh staging <image>` renders `k8s/` with this commit's image,
   validates it with a server-side dry run, applies it and waits for `kubectl rollout status`. If the new pods
   do not become ready within 40 seconds it runs `kubectl rollout undo` and fails the build.
3. **Deploy to production** — a stage-level `input` (id `Promote`) waits for a person *before* an executor
   is allocated; after approval the same image goes through the same script in `production`.

Rolling back production by hand: `kubectl rollout undo deployment/campus-notes-api -n production` returns to
the previous revision, which already ran there.

The Deployment runs two replicas with `maxUnavailable: 0`, readiness and liveness probes on `/health`, CPU and
memory requests and limits, and `runAsNonRoot` (the image's `node` user).
