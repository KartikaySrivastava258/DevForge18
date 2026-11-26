---
id: jenkins-labels-and-executors
title: Size agents and executors for a build queue
track: jenkins
level: intermediate
mode: simulation
estimated_minutes: 20
prerequisites: [jenkins-in-docker, jenkins-parallel-artifacts-tests]
objectives:
  - Predict, then watch, which builds wait in the queue when no free executor has the label they need.
  - Explain why adding an agent with the wrong label does not shorten the queue.
  - Size agents and executors so that every build starts within two minutes of arriving.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: jenkins-build-queue
  challenges: [no-docker, one-docker]
resources:
  - title: Managing nodes
    url: https://www.jenkins.io/doc/book/managing/nodes/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Nodes, agents and executors.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model. Its executors follow the Jenkins documentation's meaning (a slot for running a task on an agent), and a build runs only on an agent with its label; the queue rule (oldest waiting build first) is the model's own, not a copy of Jenkins' scheduler. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the build-queue simulation like a scientist: **predict** which builds will wait, **run** the half hour, and **compare** with the build table and the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a Jenkins queue, not Jenkins itself; the lessons *Jenkins in Docker — controller, agents and first start* and *Parallel stages, artefacts and test reports* use a real Jenkins server.

## Steps

### 1. The right label

Choose the scenario **Only a Linux agent**. Twelve builds arrive over 30 minutes: eight need a `docker` agent and take 5 minutes, and four need a `linux` agent and take 2 minutes. Before you touch anything, write down:

- Which builds can run at all on this agent?
- What will the **Longest wait** be at the end of the half hour?

Press **Run the half hour** (or **Step** a minute at a time) and read the **Waited** column. Then press **Reset** and try another `linux` agent. Predict first: will it help the builds that waited?

Agents can only change before the builds start. Choose an **Agent label** and a number of **Executors**, then press **Add agent**. How many executors does the waiting work really need? Test your idea and compare it with the table.

### 2. Enough executors

Choose **One docker executor**. Now every build has an agent with its label.

- Read the arrival times in the build table. Docker builds take 5 minutes and arrive every 2 to 4 minutes. How many can one executor finish before the next one arrives?
- Predict the longest wait for a docker build.

Run the half hour and check your prediction. Then add capacity with the right label and run it again. Is one extra agent with more executors the same as several agents with one executor each, in this model?

## Simulation

```simulation jenkins-build-queue
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state; you need it before changing the agents. Your verified challenges stay recorded.

## What you practised

A build waits until an executor on an agent with its label is free. Capacity with the wrong label does nothing for the queue. Enough executors with the right label, sized from how often builds arrive and how long they take, keeps waits short.
