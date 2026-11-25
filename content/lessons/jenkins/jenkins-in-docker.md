---
id: jenkins-in-docker
title: Jenkins in Docker — controller, agents and first start
track: jenkins
order: 1
level: beginner
estimated_minutes: 35
prerequisites: [docker-volumes-and-bind-mounts]
learning_objectives:
  - Explain what Jenkins is and how its controller and agents divide the work.
  - Run a pinned Jenkins LTS release in Docker with its data in a volume.
  - Wait for a slow-starting server correctly, by checking HTTP status codes.
  - Unlock Jenkins and explain why builds should not run on the controller.
resources:
  - title: Jenkins LTS changelog
    url: https://www.jenkins.io/changelog-stable/
    publisher: Jenkins project
    type: reference
    level: all
    official: true
    why: Lists every long-term-support release, its date and the Java versions it was tested with — check it before pinning a version.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Jenkins user documentation
    url: https://www.jenkins.io/doc/
    publisher: Jenkins project
    type: documentation
    level: all
    official: true
    why: Official installation, pipeline, security and administration documentation.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: controller-agent
    prompt: What is the difference between the Jenkins controller and an agent?
    options:
      - { id: a, text: "They are two names for the same process" }
      - { id: b, text: "The controller stores configuration, schedules builds and serves the web interface; agents are separate machines or containers that run the build steps" }
      - { id: c, text: "Agents store the configuration and the controller runs the builds" }
    answer: b
    explanation: The controller is the brain — configuration, scheduling, the UI and the build history. Agents do the work. Keeping builds off the controller protects it, because build steps run whatever code is in the repository.
  - id: wait-503
    prompt: Why does the wait loop check for a 200 or 403 status instead of just "did curl connect"?
    options:
      - { id: a, text: "curl cannot connect to Jenkins at all" }
      - { id: b, text: "Jenkins accepts connections before it is ready and answers 503 while it starts; only a normal page status means it is usable" }
      - { id: c, text: "403 means Jenkins crashed" }
    answer: b
    explanation: A server can be listening but not ready. Checking the status code waits for the real ready state, and the loop gives up with a clear message after a limit instead of waiting forever — the same pattern CI systems use for health checks.
  - id: pin-lts
    prompt: Why pin jenkins/jenkins:2.580.2-lts-jdk21 rather than jenkins/jenkins:lts?
    options:
      - { id: a, text: "Pinned tags download faster" }
      - { id: b, text: "lts moves to each new release, so the same command could start a different Jenkins next month; a pinned tag is reproducible, and you upgrade deliberately after reading the changelog" }
      - { id: c, text: "The lts tag does not exist" }
    answer: b
    explanation: The same reasoning as the Docker track. A CI server is shared infrastructure, so upgrades should be planned — plugin compatibility and the required Java version change between releases.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, where a real Jenkins 2.580.2 server (jenkins/jenkins:2.580.2-lts-jdk21) is started and checked; the documented output was confirmed in CI run 45643638519 on 2026-11-25. The setup-wizard steps in the browser are not executed.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Jenkins** is a self-hosted automation server: a **controller** stores your pipelines and schedules builds, and **agents** run the build steps, so you control exactly where and how your CI runs.

## Explain it like I'm twelve

Think of a school exam office. The exam officer (the **controller**) keeps the timetable, decides which exam happens when, and records every result. The exams themselves take place in classrooms with invigilators (the **agents**). The officer never sits an exam in the office — if something went wrong in there, the records would be at risk.

Where the analogy breaks: Jenkins can create classrooms on demand, such as a fresh container for each build, and throw them away afterwards.

## What problem it solves

Hosted CI services are convenient, but some organisations need their CI inside their own network: to reach private systems, use special hardware, keep code on their own machines, or support unusual toolchains through Jenkins' large plugin ecosystem. Jenkins provides that — and in return you operate it yourself: upgrades, plugin updates, backups and security are your responsibility.

## How it works

```diagram steps=jenkins/controller-agents
```


- **Jobs** (or *items*) define what to build. A **Pipeline** job reads its steps from a `Jenkinsfile` — the next lesson.
- **Plugins** add almost everything: Git support, pipelines, credentials, Docker agents. Keeping them updated is part of running Jenkins.
- **Releases**: a *weekly* line, and a *long-term support* (LTS) line chosen for stability. Current LTS releases require **Java 21 or 25**; the official Docker images include Java.
- `/var/jenkins_home` holds everything Jenkins knows — jobs, plugins, build history, credentials — so it belongs in a volume and in your backups.

## Try it yourself

> **Local lab** — needs Docker (see the Docker track) and about 1 GB of disk space. Jenkins listens on port 8085 here, because DevForge uses 8080. Every command is run automatically in DevForge's CI on a disposable Docker engine; see the note at the top for the current verification status. Commands that create containers use fixed names, so run them on a machine where nothing else is called `devforge-jenkins`.

### 1. Start a pinned Jenkins LTS release

The tag pins an exact LTS version with Java 21, taken from the LTS changelog linked in the resources:

```bash run
docker pull jenkins/jenkins:2.580.2-lts-jdk21
docker run -d --name devforge-jenkins \
  -p 127.0.0.1:8085:8080 \
  -v devforge-jenkins-home:/var/jenkins_home \
  jenkins/jenkins:2.580.2-lts-jdk21
```

`docker run -d` prints the new container's ID. `127.0.0.1:8085` makes Jenkins reachable only from your own computer, and the named volume keeps Jenkins' data if the container is replaced.

### 2. Wait until Jenkins is really ready

Jenkins takes a while to start. It accepts connections early but answers `503 Please wait…` until it is ready, so check the status code rather than just whether something answers — and give up with a clear message instead of waiting forever:

```bash run
for attempt in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8085/login || true)
  if [ "$code" = "200" ] || [ "$code" = "403" ]; then
    echo "Jenkins is ready"
    break
  fi
  if [ "$attempt" = "60" ]; then
    echo "Jenkins did not start within 2 minutes: check docker logs devforge-jenkins"
    exit 1
  fi
  sleep 2
done
```

```text output
Jenkins is ready
```

Every Jenkins response carries its version in an `X-Jenkins` header — a quick way to confirm what is running:

```bash run
curl -s -D - -o /dev/null http://127.0.0.1:8085/login | grep -i "^x-jenkins:"
```

```text output
X-Jenkins: 2.580.2
```

### 3. Unlock Jenkins

On first start, Jenkins generates a one-time administrator password inside its home directory:

```bash run
docker exec devforge-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

```text output
…
```

You will see a 32-character code. Then, in your browser (these steps are not executed by DevForge's tests):

1. Open `http://localhost:8085` and paste the code into **Unlock Jenkins**.
2. Choose **Install suggested plugins**. This includes Git and Pipeline support and takes a few minutes.
3. Create your own administrator account. Do not keep using the initial password.
4. Accept the suggested Jenkins URL.

### 4. Keep builds off the controller

Under **Manage Jenkins → Nodes**, the controller appears as the *built-in node*. Jenkins' own documentation recommends not running builds there: build steps run whatever code is in a repository, and on the controller that code could read every credential and job. In a real installation you set the built-in node's executors to 0 and add agents — often containers created per build. For this course's practice, running on the built-in node is acceptable.

### 5. Stop, start or remove Jenkins

Keep Jenkins running for the next lesson. `docker stop devforge-jenkins` and `docker start devforge-jenkins` pause and resume it with all settings intact. When you have finished the Jenkins track, remove it and its data:

```bash run
docker rm -f devforge-jenkins
docker volume rm devforge-jenkins-home
```

```text output
devforge-jenkins
devforge-jenkins-home
```

## Common mistakes

- **Using `jenkins/jenkins:latest` or `:lts`.** The version changes underneath you; pin a release and upgrade deliberately.
- **Running builds on the controller.** It works, but a malicious or buggy build can then reach everything Jenkins knows.
- **No volume for `/var/jenkins_home`.** Removing the container would delete every job, credential and build record.
- **Exposing Jenkins to the internet** without HTTPS and proper authentication. Unpatched, publicly reachable Jenkins servers are a common target.
- **Ignoring plugin updates.** Most Jenkins security advisories concern plugins; review them regularly.

## Where this fits in a real system

Jenkins sits in the delivery layer next to **Git**: repository events or polling start pipelines that test code, build **Docker** images and deploy to **Kubernetes**. Teams choose it over **GitHub Actions** when CI must run inside their own network or needs its flexibility — at the cost of operating it themselves, as the next lesson's comparison shows.
