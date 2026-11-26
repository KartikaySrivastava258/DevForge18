---
id: docker-layer-cache-experiments
title: Reorder a Dockerfile for the build cache
track: docker
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [docker-dockerfile-layers-and-cache]
objectives:
  - Predict, then check, which Dockerfile steps are reused and which are rebuilt after a change.
  - Reorder a Dockerfile so that a source-code change does not reinstall the dependencies.
  - Keep a secret file out of an image, and explain the two ways to do it.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: docker-layer-cache
  challenges: [fast-code-change, no-secrets]
resources:
  - title: Docker build cache
    url: https://docs.docker.com/build/cache/
    publisher: Docker Inc.
    type: documentation
    level: beginner
    official: true
    why: How layers are cached, what invalidates the cache, and how to order a Dockerfile for it.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Dockerfile reference
    url: https://docs.docker.com/reference/dockerfile/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Every instruction (FROM, COPY, RUN, CMD …) and the .dockerignore file.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with invented times and sizes. Its rules follow Docker's documentation on the build cache (once a step changes, every later step is rebuilt; a COPY step's cache depends on the files it copies) and on .dockerignore. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the layer-cache simulation like a scientist: **predict** which steps the next build will reuse, **run** the build, and **compare** with the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a Docker build, not Docker itself; the lesson *Writing a Dockerfile — layers, cache and .dockerignore* shows the same behaviour with a real Docker engine.

## Steps

### 1. A code change in one second

Choose the scenario **Everything copied first**. It has been built once, so the cache is warm. Before you touch anything, write down:

- If you press **Edit the source code** and then **Build**, which is the first step that cannot be reused?
- Which steps after it will be rebuilt, and roughly how long will the build take?

Now try it, and read the **Last build** time and the reused or rebuilt mark on each line.

Next, change the Dockerfile with the **↑**, **↓**, **Add** and **Remove** buttons. Ask yourself:

- Which file does `RUN pip install` actually need? Which files change often?
- What must already be in the image before the install step can run? (Try building with the install too early and read the error.)

After you change the Dockerfile, predict what the next build will reuse. Remember that the challenge is about the build that follows a source-code edit, so the cache must already hold your new layout.

Docker reuses a cached step only while that step and everything before it are unchanged. Putting the files that rarely change first keeps the slow step cached.

### 2. Keep the secret out

Choose **A secret in the image**. The project folder holds `secrets.env`, and there is no `.dockerignore`.

- Which instruction copies `secrets.env` into the image?
- Build once and look at **Files in the image**. Does it match your prediction?

There are two ways to fix this. One changes the build context; the other changes what you copy. Try one, build, and check the files again. Then reset and try the other.

- Which of the two would still protect you if someone added another secret file next month?

## Simulation

```simulation docker-layer-cache
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

The order of a Dockerfile decides how much of the build cache survives a change: from the first changed step onwards, everything is rebuilt. What you copy decides what ends up in the image, so `.dockerignore` and narrow `COPY` instructions keep secrets out.
