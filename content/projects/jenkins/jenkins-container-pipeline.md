---
id: jenkins-container-pipeline
track: jenkins
title: Container build pipeline
level: intermediate
estimated_hours: 8
prerequisites: [jenkins-parallel-artifacts-tests, jenkins-agents-and-labels, jenkins-configuration-as-code, jenkins-pipeline-as-code]
related_tracks: [docker, github-actions]
user_stories:
  - As an operator, I want every image in the registry to be tested and traceable to its commit so that I always know exactly what I am deploying.
  - As a developer on a feature branch, I want Jenkins to build and test my image without publishing it so that I get feedback without overwriting what others deploy.
  - As a security reviewer, I want the registry password to stay in Jenkins and never appear in commands or logs so that a build log cannot leak it.
  - As an operator, I want images that run as an unprivileged user and report their own health so that the platform can tell when a container is ready.
acceptance_criteria:
  - Jenkins' declarative linter accepts the Jenkinsfile, and every base image in the Dockerfile is pinned by digest.
  - On main, the tests run and are reported before docker build; the image is pushed as sha-<first 7 characters of the commit> and as main, and both tags name the same image.
  - The pushed image runs as a non-root user, carries org.opencontainers.image.revision with the full commit, has a HEALTHCHECK, becomes healthy and answers /health, and contains no tests or CI files.
  - The registry login uses the Jenkins credential registry-push through --password-stdin; the password never appears in the log, no Groovy-interpolated secret warning appears, and no login or smoke-test container is left behind.
  - A feature branch is built and tested but pushes nothing.
  - After a commit with a failing test on main, the build fails and nothing new reaches the registry.
rubric:
  - { criterion: "Pipeline design", excellent: "Test, build, smoke test and push are separate stages; only main pushes; tags are immutable per commit plus a moving main tag; post sections clean up containers, images and the login.", good: "All required behaviour is present and the pipeline is readable.", needs_work: "Pushes from every branch, pushes before testing, or overwrites latest." }
  - { criterion: "Secrets", excellent: "withCredentials with single-quoted sh and --password-stdin; the credential is bound only around the login; the README explains why each choice matters.", good: "The password stays out of the log and the command line.", needs_work: "docker login -p, a password in a Groovy string, or a password in the repository." }
  - { criterion: "Image quality", excellent: "Pinned base, dependency layer before source, .dockerignore, non-root user, health check and OCI labels; the image is small and starts quickly.", good: "Non-root, pinned and healthy.", needs_work: "Root user, unpinned base, or the whole folder copied in." }
  - { criterion: "Operating it", excellent: "The README says how to find the image for a commit, how to roll back to an earlier tag, and why the controller's Docker socket is not used on a real server.", good: "The README explains the tags and how to run the image.", needs_work: "No explanation of what is pushed or how to use it." }
hints:
  - Start from the Dockerfile and test it by hand (docker build, docker run, docker inspect --format '{{.State.Health.Status}}'). The Docker track's lessons on images and supply chain cover pinning and non-root users.
  - "In a multibranch job, when { branch 'main' } decides whether a stage runs; env.GIT_COMMIT holds the full commit. 'sha-' + env.GIT_COMMIT.substring(0, 7) inside a script block gives the tag."
  - The lesson on pipeline as code shows why secrets go in single-quoted sh strings. docker login --password-stdin reads the password from a pipe, so it never appears in the process list or the log.
  - Use post { always { … } } at stage level for the smoke-test container and at pipeline level for docker logout and docker rmi — the agent is shared with other builds.
  - "--build-arg REVISION=\"$GIT_COMMIT\" with ARG REVISION and LABEL org.opencontainers.image.revision=$REVISION records the commit in the image."
stretch_goals:
  - Scan the image (for example with an SBOM and a vulnerability scanner from the Docker track) and fail on critical findings.
  - Build on a dedicated agent with the label docker instead of the controller (see the lesson on agents and labels).
  - Sign the pushed image or record its digest as a build artefact for the deployment project.
starter: starter
solution: solution
check_needs: [docker, git, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The Campus Notes API now ships as a container image, built by a multibranch Pipeline job so every branch gets
built. The current Jenkinsfile logs in with the password on the command line inside a Groovy string, builds
whatever is checked out, and pushes it as `latest` — from every branch, with no tests. The image runs as root,
copies the whole folder in, and nobody can tell which commit it came from or whether it even starts.

Rebuild the pipeline so that only tested commits on `main` reach the registry, each under a tag that names its
commit, with a smoke test that proves the container becomes healthy. Feature branches get the same build and
tests without publishing. Keep the registry password inside Jenkins, and leave the shared agent clean.

The check starts a **real, throwaway Jenkins** (2.580.2, pinned plugins, configured as code with the
`registry-push` credential and the `REGISTRY` variable) and a **private registry that requires a login**
(registry:3). It creates a feature branch next to `main` and lets the **multibranch job build both**, then
reads the registry's API, pulls the pushed image, inspects it and runs it. Finally it commits a failing test
to `main` and checks that nothing new is pushed.

How the check runs Docker: the throwaway Jenkins uses your machine's Docker engine through its socket. That is
acceptable for a Jenkins that exists for a few minutes on your laptop and runs only your pipeline; on a real
server it would give every build root-level access to the host, so builds that need Docker run on dedicated
agents (see the lesson on agents and labels). The check needs the Docker socket at `/var/run/docker.sock`; it
was tested on Linux.

## Getting started

1. Copy the starter, read its README (the fixed interface: `REGISTRY`, `registry-push`, the image name and tags).
2. Fix the Dockerfile first and try it by hand: `docker build -t notes .` then `docker run -d --name notes notes`
   and `docker inspect --format '{{.State.Health.Status}}' notes`.
3. Rewrite the Jenkinsfile stage by stage and run the check (Docker, Git, curl and Python 3; about two minutes):

   ```bash
   bash check.sh path/to/campus-notes-api
   ```
