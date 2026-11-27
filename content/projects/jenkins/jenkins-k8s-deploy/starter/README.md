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

## Known problems

- `main` goes straight to production with whatever `latest` is today: no staging, no approval, and no idea
  which commit is running.
- The pipeline never checks that the new pods start. A broken image takes the service down and stays there.
- One replica, no readiness probe, no resource limits, and nothing stops the container running as root.
