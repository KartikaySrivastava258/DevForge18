# Campus Notes API — container pipeline

The Campus Notes API (see the Jenkins beginner project) now ships as a container image. Jenkins builds every
branch with a **multibranch Pipeline** job, and images go to the department's private registry.

```bash
npm ci && npm run test:ci          # tests, with a JUnit report in reports/
docker build -t campus-notes-api .
docker run --rm -p 3000:3000 campus-notes-api
```

## What Jenkins provides (fixed interface — the check relies on it)

- The pipeline is the declarative `Jenkinsfile`; every branch is built, and `BRANCH_NAME` tells them apart.
- Node.js 24 and the Docker CLI are installed where the build runs, and `docker` talks to a Docker engine.
- `REGISTRY` (an environment variable set in Jenkins) is the registry's address, such as `127.0.0.1:5000`.
- The credential `registry-push` (username and password) may push to that registry.
- Images are named `$REGISTRY/campus-notes-api`. Each commit on `main` is pushed as
  `sha-<first 7 characters of the commit>` and as `main`. Other branches are built and tested but not pushed.
- The app listens on port 3000 and answers `GET /health` with `{"status":"ok"}`.

## What changed (reference solution)

- `Jenkinsfile`: tests with a JUnit report first; then `docker build` with the commit as
  `org.opencontainers.image.revision`; a smoke test that waits for the container to become healthy; on `main`
  only, a login with the `registry-push` credential through `--password-stdin` into a Docker config folder in
  the build's own workspace, and a push of `sha-<commit>` and `main`. Builds of different branches run at the
  same time on the same Docker engine, so each build logs out and removes only its own tags (an earlier version
  that removed `:main` from every build broke main pushes now and then).
- `Dockerfile`: base image pinned by digest, dependencies installed with `npm ci --omit=dev` in their own
  layer, only `server.js` and `src/` copied, runs as the unprivileged `node` user, with a `HEALTHCHECK`.
- `.dockerignore` keeps `.git`, `node_modules`, tests and CI files out of the build context.
