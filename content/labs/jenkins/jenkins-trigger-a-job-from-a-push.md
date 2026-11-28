---
id: jenkins-trigger-a-job-from-a-push
title: Trigger a job from a repository event
track: jenkins
level: intermediate
mode: local
estimated_minutes: 40
prerequisites: [jenkins-configuration-as-code]
objectives:
  - Explain the two ways a push reaches Jenkins — Jenkins polling the repository, or the repository notifying Jenkins — and their costs.
  - Configure a pipeline job that builds only when the repository tells it something changed, with no polling schedule.
  - Add a post-receive hook to the repository that notifies Jenkins on every push, and confirm one build per push that changes something.
checkpoints:
  - { id: no-build, text: "Notifying Jenkins with no new commit started no build" }
  - { id: push-build, text: "Each push started exactly one build of the pushed commit, with no manual trigger" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Git plugin (push notification from repository)
    url: https://plugins.jenkins.io/git/
    publisher: Jenkins plugins
    type: documentation
    level: intermediate
    official: true
    why: The notifyCommit endpoint, why matching jobs need polling enabled, and its access-control settings.
    verification: { status: unverified }
  - title: githooks — post-receive
    url: https://git-scm.com/docs/githooks
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: When the post-receive hook runs on the receiving repository, and what it is given.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and the plugins pinned in the Configuration as Code lesson (git 5.11.0); the repository is served over HTTP by busybox 1.37. Their output is compared with this page. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

Builds should start when code changes — not when someone remembers to press *Build now*, and not on a timer that asks the repository "anything new?" every minute. You make the repository **tell** Jenkins about every push: a Git hook calls Jenkins' Git plugin, Jenkins checks the repository once, and builds only if there is something new.

## Before you start

You need Docker and Git, as in *Configuration as Code and plugin management*, whose Jenkins image this lab builds. Jenkins listens on `127.0.0.1:8085` (stop the lessons' `devforge-jenkins` first if it is running); the password `lab-only-pw` is for this local Jenkins only.

On GitHub or GitLab, the same idea is a **webhook**: the hosting service sends an HTTP request to Jenkins on every push. That needs a Jenkins reachable from the internet, so this lab uses a hook in a repository on your machine instead; the request Jenkins receives does the same job.

## Steps

### 1. A repository with a Jenkinsfile, served over HTTP

```bash run
mkdir -p jenkins-trigger-lab && cd jenkins-trigger-lab
git init -q -b main app && cd app
git config user.name "Lab Learner" && git config user.email "learner@example.edu"
cat > Jenkinsfile <<'EOF'
pipeline {
  agent any
  stages {
    stage('Show the commit') {
      steps {
        sh 'git log -1 --format="building %s"'
      }
    }
  }
}
EOF
git add Jenkinsfile && git commit -q -m "First version"
cd ..
git clone -q --bare app srv/app.git
mv srv/app.git/hooks/post-update.sample srv/app.git/hooks/post-update   # keeps plain-HTTP cloning working after pushes
git -C srv/app.git update-server-info
git -C app remote add origin "$PWD/srv/app.git"
docker network create devforge-trigger-net > /dev/null
docker run -d --name devforge-trigger-git --network devforge-trigger-net -v "$PWD/srv:/srv:ro" busybox:1.37 httpd -f -p 80 -h /srv > /dev/null
echo "serving app.git"
```

```text output
serving app.git
```

### 2. Jenkins, and a job that only builds when told

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
      pipelineJob('on-push') {
        properties {
          pipelineTriggers {
            triggers {
              pollSCM { scmpoll_spec('') }
            }
          }
        }
        definition {
          cpsScm {
            scm {
              git {
                remote { url('http://devforge-trigger-git/app.git') }
                branch('*/main')
              }
            }
            scriptPath('Jenkinsfile')
          }
        }
      }
EOF
docker run -d --name devforge-trigger-jenkins --network devforge-trigger-net -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=lab-only-pw \
  -e JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitStatus.NOTIFY_COMMIT_ACCESS_CONTROL=disabled-for-polling" \
  -v "$PWD/casc:/var/jenkins_home/casc:ro" devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085; A="admin:lab-only-pw"
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/job/on-push/api/json")" = 200 ] && break; sleep 2; done
curl -sg -u "$A" "$J/job/on-push/api/json?tree=name,lastBuild[number]"; echo
```

```text output
{"_class":"org.jenkinsci.plugins.workflow.job.WorkflowJob","name":"on-push","lastBuild":null}
```

- `pollSCM` with an **empty schedule** never polls by itself. It only says "this job may be checked for changes when someone asks" — and the Git plugin's notification endpoint is what asks.
- The notification endpoint, `/git/notifyCommit?url=…`, needs an access token by default. `NOTIFY_COMMIT_ACCESS_CONTROL=disabled-for-polling` lets an unauthenticated notification do one thing only: make jobs using that repository URL check it. It cannot start a build directly or pass parameters; a build happens only if the check finds a new commit.
- The job has never run (`lastBuild` is empty). In a real setup, prefer the token: an administrator creates one in Jenkins' security settings, and the hook adds `&token=…`.

### 3. Teach Jenkins the current commit, then a notification with nothing new

The first build records which commit Jenkins has seen. After that, a notification without a new commit must not start anything.

```bash run
notify() { curl -s -o /dev/null -w "notifyCommit: HTTP %{http_code}\n" "$J/git/notifyCommit?url=http://devforge-trigger-git/app.git"; }
# The number of the last finished build, or 0 before the first one.
done_builds() { curl -sg -u "$A" "$J/job/on-push/api/json?tree=lastCompletedBuild[number]" | grep -o '"number":[0-9]*' | cut -d: -f2 || echo 0; }
waitfor() { for i in $(seq 1 60); do [ "$(done_builds)" -ge "$1" ] && return 0; sleep 2; done; return 1; }
notify && waitfor 1
curl -s -u "$A" "$J/job/on-push/1/consoleText" | grep -E '^building|^Started by|^Finished'
notify; sleep 10                 # give Jenkins time to (not) start a build
curl -sg -u "$A" "$J/job/on-push/api/json?tree=lastBuild[number]"; echo
```

```text output
notifyCommit: HTTP 200
Started by an SCM change
building First version
Finished: SUCCESS
notifyCommit: HTTP 200
{"_class":"org.jenkinsci.plugins.workflow.job.WorkflowJob","lastBuild":{"_class":"org.jenkinsci.plugins.workflow.job.WorkflowRun","number":1}}
```

`Started by an SCM change`: the notification made Jenkins check the repository, it found a commit it had never built, and it built it. The second notification found nothing new — still one build. (The `sleep` here is only to show that nothing happens; everywhere else the lab waits for a result.)

### 4. A post-receive hook: every push notifies Jenkins

Git runs `hooks/post-receive` in the receiving repository after a push has been accepted. Here it makes the same request you just made by hand.

```bash run
cat > srv/app.git/hooks/post-receive <<EOF
#!/bin/sh
curl -s -o /dev/null "$J/git/notifyCommit?url=http://devforge-trigger-git/app.git" || echo "warning: could not notify Jenkins"
EOF
chmod +x srv/app.git/hooks/post-receive
cd app
sed -i 's/building %s/building %s (%h)/' Jenkinsfile
git commit -q -am "Show the short commit id" && git push -q origin main
cd ..
waitfor 2
curl -s -u "$A" "$J/job/on-push/2/consoleText" | grep -E '^building|^Started by|^Finished' | sed "s/([0-9a-f]\{7\})/(<commit>)/"
```

```text output
Started by an SCM change
building Show the short commit id (<commit>)
Finished: SUCCESS
```

Nobody pressed a button: the push ran the hook, the hook notified Jenkins, and Jenkins built the new commit. A hook that cannot reach Jenkins only prints a warning — the push itself has already succeeded, which is why `post-receive` (after) and not `pre-receive` (before) is the right place.

## Check your work

Run this inside `jenkins-trigger-lab` while Jenkins is running. It pushes one more commit and expects exactly one new build, started by the change.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
J=http://127.0.0.1:8085; A="admin:lab-only-pw"
last() { curl -sg -u "$A" "$J/job/on-push/api/json?tree=lastCompletedBuild[number]" | grep -o '"number":[0-9]*' | cut -d: -f2 || true; }
check "the job has no polling schedule of its own" 'curl -s -u "$A" "$J/job/on-push/config.xml" | grep "<spec></spec>"'
check "the repository notifies Jenkins after every push" '[ -x srv/app.git/hooks/post-receive ] && grep "notifyCommit" srv/app.git/hooks/post-receive'
before=$(last)
check "a push starts exactly one new build" '[ -n "$before" ] && (cd app && git commit -q --allow-empty -m "Check script push" && git push -q origin main) && for i in $(seq 1 60); do [ "$(last)" = $((before + 1)) ] && break; sleep 2; done && [ "$(last)" = $((before + 1)) ] && sleep 5 && [ "$(last)" = $((before + 1)) ]'
check "the new build was started by the change and succeeded" 'curl -s -u "$A" "$J/job/on-push/lastBuild/consoleText" | grep "^Started by an SCM change" && curl -s -u "$A" "$J/job/on-push/lastBuild/consoleText" | grep "^Finished: SUCCESS"'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the job has no polling schedule of its own
PASS: the repository notifies Jenkins after every push
PASS: a push starts exactly one new build
PASS: the new build was started by the change and succeeded
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-trigger-jenkins devforge-trigger-git > /dev/null
docker network rm devforge-trigger-net > /dev/null
echo "removed"
```

```text output
removed
```

The image `devforge-jenkins-casc:1` stays for the other Jenkins lessons; remove it with `docker rmi devforge-jenkins-casc:1` when you no longer need it.

## Reset

- **A name or port is already in use?** Remove the leftovers of an earlier attempt — `docker rm -f devforge-trigger-jenkins devforge-trigger-git; docker network rm devforge-trigger-net` — and stop any other Jenkins on port 8085.
- **Start again:** run the clean-up step, delete the `jenkins-trigger-lab` folder — `cd .. && rm -rf jenkins-trigger-lab` — and begin at step 1.

## What you practised

Polling asks "anything new?" on a timer and wastes work when the answer is no; a notification from the repository — a hook here, a webhook on GitHub or GitLab — arrives exactly when something changed. With the Git plugin, the notification only makes Jenkins check the repository, so a forged or repeated notification cannot build anything that was not pushed.
