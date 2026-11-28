---
id: jenkins-create-a-basic-pipeline
title: Create a basic pipeline
track: jenkins
level: beginner
mode: local
estimated_minutes: 45
prerequisites: [jenkins-pipeline-as-code]
objectives:
  - Write a declarative Jenkinsfile with build and test stages, an archived artefact and a post section, and commit it with the code.
  - Point a Jenkins pipeline job at the repository, so Jenkins reads the Jenkinsfile from Git instead of from its own settings.
  - Run the pipeline, read a red build to find the failing stage, fix it in Git, and get a green build.
checkpoints:
  - { id: green, text: "Build 1 finished SUCCESS and archived build/notes.html" }
  - { id: red, text: "Build 2 failed, and the console showed which stage and which command failed" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Pipeline (Jenkins User Handbook)
    url: https://www.jenkins.io/doc/book/pipeline/
    publisher: Jenkins
    type: documentation
    level: beginner
    official: true
    why: What a pipeline is, declarative syntax, and defining a pipeline in a Jenkinsfile kept in source control.
    verification: { status: verified, checked_on: 2026-11-28 }
  - title: Pipeline syntax
    url: https://www.jenkins.io/doc/book/pipeline/syntax/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Declarative stages, parallel, post conditions and agent labels.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and the plugins pinned in the Configuration as Code lesson; the repository is served over HTTP by busybox 1.37. Their output is compared with this page, and the Jenkinsfiles are checked by DevForge's Jenkinsfile checker. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

A small project needs its first CI pipeline. You write a **Jenkinsfile** — the pipeline as code, committed next to the code — and a Jenkins job that reads it from the Git repository. Then you run it: green, then red after a broken change, then green again after the fix, reading the console to see which stage failed. A check script confirms the result.

## Before you start

You need Docker and Git. The lab builds the Jenkins image from *Configuration as Code and plugin management* (it downloads Jenkins plugins, tens of MB, on the first build), serves your repository to Jenkins with a tiny web server, and publishes Jenkins on `127.0.0.1:8085`. The password `lab-only-pw` is for this local Jenkins only. If the lesson's `devforge-jenkins` container is still running, stop it first: both use port 8085.

## Steps

### 1. The project and its Jenkinsfile

```bash run
mkdir -p jenkins-pipeline-lab && cd jenkins-pipeline-lab
git init -q -b main app && cd app
git config user.name "Lab Learner" && git config user.email "learner@example.edu"
mkdir -p notes
printf 'Lecture 1: what CI is\nLecture 2: pipelines as code\n' > notes/week1.txt
cat > build.sh <<'EOF'
#!/bin/sh
# Turns every notes/*.txt file into one HTML page.
set -e
mkdir -p build
{ echo "<h1>Course notes</h1>"; for f in notes/*.txt; do echo "<pre>"; cat "$f"; echo "</pre>"; done; } > build/notes.html
echo "built build/notes.html from $(ls notes/*.txt | wc -l) file(s)"
EOF
cat > test.sh <<'EOF'
#!/bin/sh
# Every notes file must have at least one line, and every line must start with "Lecture".
set -e
for f in notes/*.txt; do
  [ -s "$f" ] || { echo "FAIL: $f is empty"; exit 1; }
  if grep -nv '^Lecture' "$f"; then echo "FAIL: $f has a line that does not start with Lecture"; exit 1; fi
done
echo "all notes files passed"
EOF
chmod +x build.sh test.sh
cat > Jenkinsfile <<'EOF'
pipeline {
  agent any
  options {
    timeout(time: 5, unit: 'MINUTES')
  }
  stages {
    stage('Build') {
      steps {
        sh './build.sh'
      }
    }
    stage('Test') {
      steps {
        sh './test.sh'
      }
    }
  }
  post {
    success {
      archiveArtifacts artifacts: 'build/notes.html', fingerprint: true
    }
    failure {
      echo 'The build failed: read the stage and the command above this line.'
    }
  }
}
EOF
git add . && git commit -q -m "Notes site with a Jenkins pipeline"
git log --oneline
```

```text output
c782c4a Notes site with a Jenkins pipeline
```

- `agent any` runs the pipeline on any available executor; `stages` run in order, and the first failing `sh` step stops the pipeline.
- `post` runs after the stages: `success` archives the HTML page as an **artefact** you can download from the build; `failure` only runs when something failed.
- `timeout` stops a stuck build instead of letting it hold an executor forever.

### 2. Serve the repository to Jenkins

Jenkins clones the repository like any Git client. A bare copy served over plain HTTP by a tiny web server is enough for a local lab; the `post-update` hook refreshes the files that make plain HTTP cloning work after every push.

```bash run
cd ..
git clone -q --bare app srv/app.git
mv srv/app.git/hooks/post-update.sample srv/app.git/hooks/post-update
git -C srv/app.git update-server-info
git -C app remote add origin "$PWD/srv/app.git"
docker network create devforge-pipeline-net > /dev/null
docker run -d --name devforge-gitserver --network devforge-pipeline-net -v "$PWD/srv:/srv:ro" busybox:1.37 httpd -f -p 80 -h /srv > /dev/null
echo "serving app.git"
```

```text output
serving app.git
```

### 3. Jenkins with a pipeline job that reads the Jenkinsfile from Git

```bash run
mkdir -p image casc
cat > image/plugins.txt <<'EOF'
workflow-aggregator:608.v67378e9d3db_1
configuration-as-code:2148.v9d0c041b_a_13c
job-dsl:3732.v9a_c49a_61a_313
pipeline-groovy-lib:822.vc95f70dea_db_7
git:5.11.0
matrix-auth:3.3
EOF
cat > image/Dockerfile <<'EOF'
FROM jenkins/jenkins:2.580.2-lts-jdk21
COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false" \
    CASC_JENKINS_CONFIG=/var/jenkins_home/casc
EOF
docker build -q -t devforge-jenkins-casc:1 image > jenkins-build.log 2>&1 || { tail -n 20 jenkins-build.log; exit 1; }
cat > casc/jenkins.yaml <<'EOF'
jenkins:
  numExecutors: 1
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${ADMIN_PASSWORD}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
jobs:
  - script: >
      pipelineJob('notes-site') {
        definition {
          cpsScm {
            scm {
              git {
                remote { url('http://devforge-gitserver/app.git') }
                branch('*/main')
              }
            }
            scriptPath('Jenkinsfile')
          }
        }
      }
EOF
docker run -d --name devforge-jenkins-lab --network devforge-pipeline-net -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=lab-only-pw -v "$PWD/casc:/var/jenkins_home/casc:ro" devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085; A="admin:lab-only-pw"
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/job/notes-site/api/json")" = 200 ] && break; sleep 2; done
curl -sg -u "$A" "$J/job/notes-site/api/json?tree=name,buildable"; echo
```

```text output
{"_class":"org.jenkinsci.plugins.workflow.job.WorkflowJob","name":"notes-site","buildable":true}
```

The job holds no pipeline steps of its own: `cpsScm` tells Jenkins to clone the repository and run the `Jenkinsfile` it finds there. A change to the pipeline is therefore a commit, reviewed like any other code.

### 4. Run it

`build N` asks Jenkins to start the job (with the CSRF crumb, as in the Configuration as Code lesson), waits for build `N` to finish, and prints its result and the console lines that matter.

```bash run
crumb=$(curl -s -c cookies.txt -u "$A" "$J/crumbIssuer/api/json" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const c = JSON.parse(s); console.log(`${c.crumbRequestField}:${c.crumb}`); });')
build() {
  curl -s -o /dev/null -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/job/notes-site/build"
  for i in $(seq 1 90); do curl -sg -u "$A" "$J/job/notes-site/$1/api/json?tree=result" 2> /dev/null | grep '"result":"' > /dev/null && break; sleep 2; done
  curl -sg -u "$A" "$J/job/notes-site/$1/api/json?tree=result" | grep -o '"result":"[A-Z]*"'
  curl -s -u "$A" "$J/job/notes-site/$1/consoleText" | grep -E '^\[Pipeline\] \{ \((Build|Test)\)|^built |^all notes|^FAIL|^Archiving|^The build failed|^ERROR: script returned|^Finished'
}
build 1
curl -s -u "$A" "$J/job/notes-site/1/artifact/build/notes.html" | head -n 2
```

```text output
"result":"SUCCESS"
[Pipeline] { (Build)
built build/notes.html from 1 file(s)
[Pipeline] { (Test)
all notes files passed
Archiving artifacts
Finished: SUCCESS
<h1>Course notes</h1>
<pre>
```

### 5. A broken change, and a red build

Someone adds notes that break the rule `test.sh` checks, and pushes without running the tests.

```bash run
cd app
printf 'Lecture 3: agents\nhomework: read chapter 2\n' > notes/week2.txt
git add notes && git commit -q -m "Add week 2 notes" && git push -q origin main
cd ..
build 2
```

```text output
"result":"FAILURE"
[Pipeline] { (Build)
built build/notes.html from 2 file(s)
[Pipeline] { (Test)
FAIL: notes/week2.txt has a line that does not start with Lecture
The build failed: read the stage and the command above this line.
ERROR: script returned exit code 1
Finished: FAILURE
```

Read a red build from the top: *Build* passed, *Test* failed, and the `FAIL:` line that `test.sh` printed says why; `ERROR: script returned exit code 1` marks the `sh` step that stopped the pipeline. The `failure` block ran; the artefact step did not, so nothing broken was archived.

### 6. Fix it in Git, and green again

```bash run
cd app
printf 'Lecture 3: agents\nLecture 3 homework: read chapter 2\n' > notes/week2.txt
git commit -q -am "Week 2 notes: homework belongs to lecture 3" && git push -q origin main
cd ..
build 3
```

```text output
"result":"SUCCESS"
[Pipeline] { (Build)
built build/notes.html from 2 file(s)
[Pipeline] { (Test)
all notes files passed
Archiving artifacts
Finished: SUCCESS
```

## Check your work

Run this inside `jenkins-pipeline-lab` while Jenkins is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
J=http://127.0.0.1:8085; A="admin:lab-only-pw"
result() { curl -sg -u "$A" "$J/job/notes-site/$1/api/json?tree=result" | grep -o '"result":"[A-Z]*"'; }
check "the Jenkinsfile is committed in the repository" 'git -C app ls-files --error-unmatch Jenkinsfile'
check "the Jenkinsfile has Build and Test stages" 'grep "stage(.Build.)" app/Jenkinsfile && grep "stage(.Test.)" app/Jenkinsfile'
check "the job reads its pipeline from Git, not from Jenkins" 'curl -s -u "$A" "$J/job/notes-site/config.xml" | grep "<scriptPath>Jenkinsfile</scriptPath>"'
check "a build failed on the broken notes" 'curl -sg -u "$A" "$J/job/notes-site/api/json?tree=builds[result]" | grep "\"result\":\"FAILURE\""'
check "the last build is green" '[ "$(curl -sg -u "$A" "$J/job/notes-site/lastBuild/api/json?tree=result" | grep -o "\"result\":\"[A-Z]*\"")" = "\"result\":\"SUCCESS\"" ]'
check "the last build archived build/notes.html" 'curl -sf -u "$A" "$J/job/notes-site/lastBuild/artifact/build/notes.html" | grep "Lecture 3 homework"'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the Jenkinsfile is committed in the repository
PASS: the Jenkinsfile has Build and Test stages
PASS: the job reads its pipeline from Git, not from Jenkins
PASS: a build failed on the broken notes
PASS: the last build is green
PASS: the last build archived build/notes.html
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-jenkins-lab devforge-gitserver > /dev/null
docker network rm devforge-pipeline-net > /dev/null
echo "removed"
```

```text output
removed
```

The image `devforge-jenkins-casc:1` stays for the other Jenkins lessons; remove it with `docker rmi devforge-jenkins-casc:1` when you no longer need it.

## Reset

- **A name or port is already in use?** Remove the leftovers of an earlier attempt — `docker rm -f devforge-jenkins-lab devforge-gitserver; docker network rm devforge-pipeline-net` — and stop the lessons' `devforge-jenkins` if it holds port 8085.
- **Start again:** run the clean-up step, delete the `jenkins-pipeline-lab` folder — `cd .. && rm -rf jenkins-pipeline-lab` — and begin at step 1.

## What you practised

A Jenkinsfile puts the pipeline in the repository, so every change to the build is a commit. A pipeline job points Jenkins at that repository; each build clones it and runs the stages in order. A red build is information: the failing stage, the failing command and its output say what to fix — in Git, followed by a green build.
