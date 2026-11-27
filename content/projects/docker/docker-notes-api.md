---
id: docker-notes-api
track: docker
title: Containerised notes API
level: beginner
estimated_hours: 4
prerequisites: [docker-images-vs-containers, docker-volumes-and-bind-mounts, docker-dockerfile-layers-and-cache, docker-image-and-container-security]
related_tracks: [git-github]
user_stories:
  - As a developer joining the team, I want to run the notes API with one docker run command so that I do not have to install the right Node.js version first.
  - As a student using the notes app, I want my notes to survive an upgrade of the container so that nothing I wrote is lost.
  - As a maintainer who publishes the image, I want no token or private file inside it so that sharing the image never shares a secret.
  - As an operator, I want the container to run as an unprivileged user and stop cleanly so that a bug cannot change system files and no request is cut off on shutdown.
acceptance_criteria:
  - Every FROM line pins its base image by digest, the image builds, and it is under 300 MB.
  - The image's default user is not root, and the running API process does not have uid 0.
  - No ENV entry in the image holds a token, password, secret or key, and no file in the image contains the project's .env or .git.
  - .dockerignore keeps .env and .git out of the build context.
  - Run with a new named volume at /data and a published port, the API answers GET /health with 200 and can create and list notes.
  - docker stop ends the container in under 5 seconds with exit code 0.
  - A note created in one container is still listed by a new container that uses the same volume.
rubric:
  - { criterion: "Reproducible, small image", excellent: "Base pinned by tag and digest with a comment on how to update it, files copied in an order that keeps the cache useful, and the size compared with a non-Alpine base in the README.", good: "Pinned, small base; builds every time.", needs_work: "A moving tag such as node:22-alpine or latest, or a full-size base without a reason." }
  - { criterion: "Secrets", excellent: ".dockerignore covers secrets, history, local data and tooling; only the needed files are copied; the token arrives at run time and the README says how.", good: "No secret in ENV, layers or the build context.", needs_work: "The token is set with ENV, or COPY . . ships .env or .git." }
  - { criterion: "Running safely", excellent: "Non-root user, data folder prepared for that user, exec-form CMD, and the learner can explain why a new volume would otherwise be owned by root.", good: "Non-root, data survives, stops cleanly.", needs_work: "Runs as root, or as non-root but cannot write to /data." }
hints:
  - Build and inspect as you go — docker image inspect -f '{{.Config.User}} {{.Config.Env}}' notes-api:dev shows the user and every ENV value anyone with the image can read.
  - Find the digest of the tag you use with docker image inspect -f '{{index .RepoDigests 0}}' node:22.23.5-alpine after pulling it, and write FROM node:22.23.5-alpine@sha256:… with both.
  - "The node images include an unprivileged user called node. After USER node, the app cannot write where root owns the folder — and a brand-new named volume takes its owner from the folder it is mounted on in the image. Create /data and chown it to node before USER."
  - COPY . . copies everything the builder receives. Copy only package.json and server.js, and list .env, .git and other local files in .dockerignore so they never reach the builder at all.
  - "CMD npm start (shell form) is stored as /bin/sh -c \"npm start\": in this image npm ends up as PID 1 and node runs as its child. CMD [\"node\", \"server.js\"] (exec form) makes node itself PID 1, so it receives docker stop's SIGTERM directly — check with docker exec <container> ps."
stretch_goals:
  - Add a HEALTHCHECK that calls /health with wget, and watch the status change from starting to healthy in docker ps.
  - Run the container with --read-only --cap-drop ALL --security-opt no-new-privileges and find out what, if anything, the API still needs.
  - Generate an SBOM for your image with Syft, as in the supply-chain lesson, and list the packages that came from the base image.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The notes API is a small Node.js service that a student team wants to share as a container image. Someone wrote
a first `Dockerfile` in five minutes: it builds, the API answers, and the team is ready to push it. Before they
do, it needs a review — and fixes:

- The base image is a moving tag, so next month's rebuild may use a different image.
- `COPY . .` copies the developer's `.env` and the Git history into the image, and the admin token is set with
  `ENV`, where anyone who pulls the image can read it.
- The API runs as root.
- The notes are written inside the container, so replacing the container — every upgrade — loses them.

Your job is to write the `Dockerfile` and `.dockerignore` that fix all of this, without changing the API. The
README in the starter lists the requirements and the endpoints.

## Getting started

1. Copy the starter into a new folder (keep the placeholder `.env`: it is the kind of file that must stay out of
   the image). You need Docker and `curl`.
2. Build and run the first draft, then look at what is inside:

   ```bash
   docker build -t notes-api:dev .
   docker run --rm notes-api:dev ls -A /app
   docker image inspect -f '{{.Config.User}} {{.Config.Env}}' notes-api:dev
   ```

3. Fix one requirement at a time and follow the README's "Try it" steps, including removing the container and
   starting a new one with the same volume.
4. Run the check. It builds your image from a copy of your folder with a fake `.env` and `.git` added, runs it,
   and removes everything it created:

   ```bash
   bash check.sh path/to/your/project
   ```
