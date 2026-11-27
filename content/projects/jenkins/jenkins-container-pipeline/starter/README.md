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

## Known problems

- Every branch overwrites `latest` in the registry, tested or not (there are no tests in the pipeline).
- The password is passed on the docker command line through a Groovy string.
- The image runs as root, copies the whole folder (tests, `.git`, `node_modules`) and uses an unpinned base.
- Nobody knows which commit an image was built from, or whether it even starts.
