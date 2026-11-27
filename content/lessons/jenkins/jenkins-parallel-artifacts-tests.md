---
id: jenkins-parallel-artifacts-tests
title: Parallel stages, artefacts and test reports
track: jenkins
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [jenkins-pipeline-as-code]
learning_objectives:
  - Run independent checks as parallel stages in a declarative Jenkinsfile.
  - Keep a build's output with archiveArtifacts and publish test results with junit.
  - Explain what executors and agent labels decide about where and when stages run.
resources:
  - title: Pipeline syntax
    url: https://www.jenkins.io/doc/book/pipeline/syntax/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Declarative stages, parallel, post conditions and agent labels.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: JUnit plugin — junit step
    url: https://www.jenkins.io/doc/pipeline/steps/junit/
    publisher: Jenkins project
    type: documentation
    level: beginner
    official: true
    why: Recording JUnit XML results, and how failing tests affect the build.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Managing nodes
    url: https://www.jenkins.io/doc/book/managing/nodes/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Nodes, agents and executors.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: parallel
    prompt: Lint takes 2 minutes and unit tests 5. Neither uses the other's output. How long do they take as parallel stages, given two free executors?
    options:
      - { id: a, text: "7 minutes" }
      - { id: b, text: "About 5 minutes — they run side by side, so the longer one sets the time" }
      - { id: c, text: "2 minutes" }
    answer: b
    explanation: Parallel branches run at the same time when executors are free; the stage ends when the slowest branch ends.
  - id: always
    prompt: Why publish test results in post { always { … } }?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "post always runs whatever the outcome — so the report is published even when tests fail, which is exactly when you need it" }
      - { id: c, text: "junit only works there" }
    answer: b
    explanation: The pipeline syntax says always runs the post steps regardless of the completion status.
  - id: unstable
    prompt: The junit step finds one failing test. What does Jenkins do with the build by default?
    options:
      - { id: a, text: "Ignores it" }
      - { id: b, text: "Marks it unstable — a distinct status from failed, shown in the build history and trends" }
      - { id: c, text: "Deletes the build" }
    answer: b
    explanation: The JUnit plugin marks the build unstable when it finds at least one test failure, unless told otherwise.
verification:
  method: executed
  details: Writing and running the test script, writing the Jenkinsfile and committing it in the practice repository are run by the test suite and their output is compared with this lesson; every Jenkinsfile shown is checked by DevForge's Jenkinsfile checker. Running the pipeline in Jenkins was checked against the Jenkins documentation (2026-11-26) but is not executed, because it needs a Jenkins with agents.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A Jenkinsfile can run independent checks as **parallel** stages so a build takes as long as its slowest check, keep what it built with **`archiveArtifacts`**, and publish test results with **`junit`** — while **executors** and agent **labels** decide where, and how soon, each stage can run.

## Explain it like I'm twelve

Four friends clean a house. If they do every room one after another, it takes all afternoon; if each takes a room, it takes as long as the messiest room — but only if there are four friends free. Afterwards they take a photo of each clean room for the parent (the artefacts) and fill in a checklist of what passed (the test report).

The rooms are **parallel stages**, the friends are **executors**, and some rooms need a friend who knows how to use the dishwasher — that is a **label**.

Where the analogy breaks: Jenkins can add more "friends" by connecting more agents.

## What problem it solves

Pipelines grow: lint, unit tests, integration tests, a build. Run one after another, they make every developer wait. Parallel stages cut the wait; archived artefacts mean the exact build that was tested is the one you deploy; published test reports show which test failed and how failures trend over time.

## How it works

![](media:jenkins/parallel-stages.svg)

- In a declarative pipeline, a stage can contain `parallel { stage(…) { … } stage(…) { … } }`. The branches run at the same time when executors are free.
- An **executor** is a slot for running a task on a node; a node's number of executors is how many tasks it can run at once. `agent { label 'linux' }` asks for a node with that label.
- `archiveArtifacts` keeps files from the workspace so they can be downloaded from the build's page later.
- `junit` reads JUnit XML test results; by default a failing test marks the build **unstable**. Put it in `post { always { … } }`, which runs whatever the outcome.

## Try it yourself

> **Local lab** — continue in the practice repository from the previous lesson. You run the tests locally to see the XML Jenkins would read, and write and commit the Jenkinsfile; running it needs a Jenkins with agents (optional). Every command is run automatically in DevForge's tests.

### 1. Tests that write a JUnit report

```bash run
mkdir -p scripts reports
cat > scripts/test.sh <<'EOF'
#!/usr/bin/env bash
# Runs two tiny checks and writes the result as JUnit XML, the format Jenkins reads.
set -u
pass=0; fail=0; cases=""
check() {
  if eval "$2"; then pass=$((pass + 1)); cases+="<testcase name=\"$1\"/>"
  else fail=$((fail + 1)); cases+="<testcase name=\"$1\"><failure message=\"failed\"/></testcase>"; fi
}
check "README has a title" "head -n 1 README.md | grep '^# ' > /dev/null"
check "README is not empty" "[ -s README.md ]"
echo "<testsuite name=\"notes\" tests=\"$((pass + fail))\" failures=\"$fail\">$cases</testsuite>" > reports/notes.xml
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
EOF
bash scripts/test.sh
cat reports/notes.xml
```

```text output
2 passed, 0 failed
<testsuite name="notes" tests="2" failures="0"><testcase name="README has a title"/><testcase name="README is not empty"/></testsuite>
```

The report has one `<testcase>` per check and counts the failures — the JUnit XML format that Jenkins' `junit` step understands.

### 2. A Jenkinsfile with parallel stages, artefacts and test results

```bash run
cat > Jenkinsfile <<'EOF'
pipeline {
  agent any
  options {
    timeout(time: 10, unit: 'MINUTES')
  }
  stages {
    stage('Checks') {
      parallel {
        stage('Notes check') {
          steps {
            sh 'bash scripts/check-notes.sh'
          }
        }
        stage('Tests') {
          steps {
            sh 'bash scripts/test.sh'
          }
        }
      }
    }
    stage('Package') {
      steps {
        sh 'mkdir -p dist && tar -czf dist/notes.tar.gz README.md'
        archiveArtifacts artifacts: 'dist/*.tar.gz', fingerprint: true
      }
    }
  }
  post {
    always {
      junit 'reports/*.xml'
    }
  }
}
EOF
git add Jenkinsfile scripts/test.sh
git commit -m "Run checks in parallel, archive the package, publish test results"
```

```text output
[main e565fd7] Run checks in parallel, archive the package, publish test results
 2 files changed, 32 insertions(+), 7 deletions(-)
 create mode 100644 scripts/test.sh
```

- **Checks** runs its two stages side by side; **Package** starts only when both have passed.
- `archiveArtifacts` keeps `dist/notes.tar.gz` on the build's page; `fingerprint: true` records which builds produced and used it.
- `post { always { junit … } }` publishes the test report whether the build passed or failed.

### 3. Run it in Jenkins (optional)

Point a Pipeline job at this repository, as in the previous lesson. The build page then shows the two **Checks** branches side by side, a **Test Result** link from `junit`, and the archived `notes.tar.gz` to download. Break the README's title and run it again: the test report shows the failing case and the build is marked unstable. This step needs a Jenkins and is not part of the automatic tests.

## Try it in the simulation

Builds that need a `docker` or `linux` agent arrive over half an hour. Add agents with labels and executors, and watch the queue. It is a labelled teaching model with fixed builds, not Jenkins itself.

```simulation jenkins-build-queue scenario=no-docker
```

## Common mistakes

- **Parallel branches that depend on each other.** Branches run at the same time; one cannot use what the other produces. Put dependent work in a later stage.
- **More parallel branches than executors.** Extra branches wait for a free executor — parallel only helps when there is capacity.
- **`junit` only on success.** Then the report is missing when tests fail; use `post { always { … } }`.
- **Archiving everything.** Keep the files someone will download or deploy, not the whole workspace.
- **Agent labels nobody has.** A stage that asks for a label no online node has waits and never runs.

## Where this fits in a real system

Jenkins builds a **Docker** image in the Package stage and archives or pushes it; test reports from unit and integration tests feed dashboards; and the same split of independent checks appears in **GitHub Actions** as parallel jobs — compare this Jenkinsfile with the workflow from that track.
