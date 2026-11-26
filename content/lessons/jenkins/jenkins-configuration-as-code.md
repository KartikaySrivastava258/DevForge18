---
id: jenkins-configuration-as-code
title: Configuration as Code and plugin management
track: jenkins
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [jenkins-in-docker]
learning_objectives:
  - Build a Jenkins image with pinned plugins installed by jenkins-plugin-cli, so every Jenkins starts identical.
  - Configure Jenkins — users, security, executors and jobs — from a YAML file with Configuration as Code (JCasC) and Job DSL, with no clicks in the web UI.
  - Trigger and inspect a pipeline through the REST API, using a CSRF crumb.
  - Change the configuration file and reload it, so configuration changes go through review like code.
resources:
  - title: Configuration as Code (Jenkins handbook)
    url: https://www.jenkins.io/doc/book/managing/casc/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: JCasC defines Jenkins configuration in a human-readable YAML file stored as source code; CASC_JENKINS_CONFIG points to it.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Official Jenkins Docker image — installing plugins
    url: https://github.com/jenkinsci/docker/blob/master/README.md
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: jenkins-plugin-cli with a plugins.txt in the Dockerfile; plugins are copied into JENKINS_HOME at start.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Remote access API
    url: https://www.jenkins.io/doc/book/using/remote-access-api/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: JSON API with tree filters, triggering builds over HTTP, and that API tokens are preferred over crumbs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: CSRF protection
    url: https://www.jenkins.io/doc/book/security/csrf-protection/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Changing requests need a crumb (with the session cookie); requests authenticated with an API token are exempt.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-casc
    prompt: Why configure Jenkins from casc.yaml instead of the web UI?
    options:
      - { id: a, text: "The UI is slower" }
      - { id: b, text: "The configuration becomes a file in Git: reviewed, versioned, and able to rebuild an identical Jenkins after a failure — clicks leave no history and are easily forgotten" }
      - { id: c, text: "The UI cannot configure security" }
    answer: b
    explanation: The lab recreates a fully configured Jenkins — user, security, executors and a job — from one YAML file and a Dockerfile.
  - id: pin-plugins
    prompt: Why list exact plugin versions in plugins.txt?
    options:
      - { id: a, text: "jenkins-plugin-cli requires versions" }
      - { id: b, text: "Without them each rebuild may install newer plugins, so two \"identical\" Jenkins images can behave differently; pins make upgrades deliberate and reviewable" }
      - { id: c, text: "Pinned plugins never have security issues" }
    answer: b
    explanation: Pins are not a security guarantee — watch Jenkins security advisories and update the pins on purpose.
  - id: crumb
    prompt: A script posts to /job/hello/build with a user name and password and gets 403. What is missing?
    options:
      - { id: a, text: "The job name" }
      - { id: b, text: "A CSRF crumb (with its session cookie) — or authenticate with an API token instead, which is exempt from the crumb" }
      - { id: c, text: "Admin rights" }
    answer: b
    explanation: The lab shows 403 without a crumb and 201 with one. Lesson 7 uses API tokens.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and pinned plugins (workflow-aggregator 608.v67378e9d3db_1, configuration-as-code 2148.v9d0c041b_a_13c, job-dsl 3732.v9a_c49a_61a_313, pipeline-groovy-lib 822.vc95f70dea_db_7, git 5.11.0, matrix-auth 3.3), after the first Jenkins lesson, and its output is compared with this lesson. Behaviour was checked against the Jenkins handbook and the image's README on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A Jenkins you configured by clicking is a pet nobody can rebuild; with **pinned plugins in a Dockerfile** and **Configuration as Code** (a YAML file for users, security, executors and jobs), Jenkins becomes reproducible, reviewable and disposable — like everything else in the pipeline.

## Explain it like I'm twelve

Setting up a classroom by hand each morning — chairs, posters, the timetable on the board — goes wrong whenever a different teacher does it. Write a setup sheet instead, and anyone can make the room identical in minutes; if the room floods, you set up another one from the same sheet. The **Dockerfile** lists what to bring in (plugins); the **casc.yaml** says how to arrange it (configuration).

Where the analogy breaks: Jenkins also keeps build history and credentials, which a setup sheet cannot recreate — back those up separately.

## What problem it solves

Jenkins servers grow by clicks: a plugin here, a setting there, a job copied from another. Nobody knows the exact configuration, upgrades break things, and rebuilding after a disk failure takes days. Pinned plugins and JCasC turn that state into files you can review in pull requests, test in a throwaway container, and apply again in minutes.

## How it works

![](media:jenkins/casc.svg)

- `jenkins-plugin-cli -f plugins.txt` in a Dockerfile installs plugins (and their dependencies) at the listed versions into the image.
- `-Djenkins.install.runSetupWizard=false` skips the browser setup; `CASC_JENKINS_CONFIG` points to the YAML. Values such as `${ADMIN_PASSWORD}` are read from the environment, so secrets stay out of the file.
- The `jenkins:` section sets security and executors; the `jobs:` section runs Job DSL scripts that create jobs.
- The JSON API (`/api/json?tree=…`) reads state; changing actions (build, reload) need a **CSRF crumb** — or an API token.

## Try it yourself

> **Local lab** — needs Docker (as in *Jenkins in Docker*) and Node.js. The build downloads Jenkins plugins (tens of MB). Jenkins listens on `127.0.0.1:8085`; the password is for this lesson only. Every command is run automatically in DevForge's tests, and the last step removes everything.

### 1. An image with pinned plugins

```bash run
mkdir -p jenkins-casc/casc && cd jenkins-casc
cat > plugins.txt <<'EOF'
workflow-aggregator:608.v67378e9d3db_1
configuration-as-code:2148.v9d0c041b_a_13c
job-dsl:3732.v9a_c49a_61a_313
pipeline-groovy-lib:822.vc95f70dea_db_7
git:5.11.0
matrix-auth:3.3
EOF
cat > Dockerfile <<'EOF'
FROM jenkins/jenkins:2.580.2-lts-jdk21
COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
# Configured from files: no setup wizard, and JCasC reads every YAML file in this folder.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false" \
    CASC_JENKINS_CONFIG=/var/jenkins_home/casc
EOF
docker build -q -t devforge-jenkins-casc:1 . > ../jenkins-build.log 2>&1 || { tail -n 20 ../jenkins-build.log; exit 1; }
echo "image built"
```

```text output
image built
```

The plugin CLI also installed the plugins these six depend on. Pin your direct plugins; dependency versions are chosen to satisfy them and should be reviewed when you upgrade.

### 2. Jenkins described in YAML

```bash run
cat > casc/jenkins.yaml <<'EOF'
jenkins:
  systemMessage: "DevForge Jenkins, configured from casc.yaml"
  numExecutors: 2
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${ADMIN_PASSWORD}     # read from the environment, never written in this file
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
jobs:
  - script: >
      pipelineJob('hello') {
        definition {
          cps {
            sandbox(true)
            script('''
              pipeline {
                agent any
                stages {
                  stage('Greet') { steps { echo 'Hello from a job defined as code' } }
                }
              }
            '''.stripIndent())
          }
        }
      }
EOF
docker run -d --name devforge-jenkins -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=lesson-only-pw \
  -v "$PWD/casc:/var/jenkins_home/casc:ro" \
  devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085; A="admin:lesson-only-pw"
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/api/json")" = 200 ] && break; sleep 2; done
curl -sg -u "$A" "$J/api/json?tree=description,numExecutors,jobs[name]" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const j = JSON.parse(s);
    console.log(`message: ${j.description}\nexecutors: ${j.numExecutors}\njobs: ${j.jobs.map((x) => x.name).join(", ")}`);
  });'
echo "anonymous request: HTTP $(curl -s -o /dev/null -w '%{http_code}' "$J/api/json")"
```

```text output
message: DevForge Jenkins, configured from casc.yaml
executors: 2
jobs: hello
anonymous request: HTTP 403
```

No setup wizard, no clicks: the admin user, the security settings, the executors and the `hello` pipeline job all came from the YAML file. The folder is mounted read-only — Jenkins reads its configuration, it does not own it.

### 3. Exactly the plugins you pinned

```bash run
curl -sg -u "$A" "$J/pluginManager/api/json?depth=1&tree=plugins[shortName,version]" | node -e '
  const pinned = ["configuration-as-code", "git", "job-dsl", "matrix-auth", "pipeline-groovy-lib", "workflow-aggregator"];
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const p of JSON.parse(s).plugins.filter((p) => pinned.includes(p.shortName)).sort((a, b) => a.shortName.localeCompare(b.shortName)))
      console.log(`${p.shortName} ${p.version}`);
  });'
```

```text output
configuration-as-code 2148.v9d0c041b_a_13c
git 5.11.0
job-dsl 3732.v9a_c49a_61a_313
matrix-auth 3.3
pipeline-groovy-lib 822.vc95f70dea_db_7
workflow-aggregator 608.v67378e9d3db_1
```

### 4. Run the job through the API

```bash run
echo "without a crumb: HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST -u "$A" "$J/job/hello/build")"
crumb=$(curl -s -c cookies.txt -u "$A" "$J/crumbIssuer/api/json" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const c = JSON.parse(s); console.log(`${c.crumbRequestField}:${c.crumb}`); });')
echo "with a crumb:    HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/job/hello/build")"
for i in $(seq 1 90); do curl -sg -u "$A" "$J/job/hello/1/api/json?tree=result" 2> /dev/null | grep -q '"result":"' && break; sleep 2; done
curl -sg -u "$A" "$J/job/hello/1/api/json?tree=result"; echo
curl -s -u "$A" "$J/job/hello/1/consoleText" | grep -E '^Hello|^Finished'
```

```text output
without a crumb: HTTP 403
with a crumb:    HTTP 201
{"_class":"org.jenkinsci.plugins.workflow.job.WorkflowRun","result":"SUCCESS"}
Hello from a job defined as code
Finished: SUCCESS
```

The first request was refused by CSRF protection. With the crumb (and the session cookie it belongs to), Jenkins queued build 1 (`201 Created`); the script waited for a result and read the console log.

### 5. Change the configuration like code

```bash run
sed -i 's/configured from casc.yaml"/configured from casc.yaml (version 2)"/' casc/jenkins.yaml
echo "reload: HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/configuration-as-code/reload")"
curl -sg -u "$A" "$J/api/json?tree=description" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).description));'
```

```text output
reload: HTTP 302
DevForge Jenkins, configured from casc.yaml (version 2)
```

In a real setup the edit is a pull request; after merge, a pipeline updates the file on the Jenkins host and calls reload (or rebuilds the container). `302` is Jenkins redirecting back to its page after the reload.

### 6. Clean up

```bash run
docker rm -f devforge-jenkins > /dev/null
docker image rm devforge-jenkins-casc:1 > /dev/null
echo "removed"
```

```text output
removed
```

## Common mistakes

- **Secrets in casc.yaml.** Use `${VARIABLES}` from the environment or a secrets store; the file goes into Git.
- **Unpinned plugins.** `plugins.txt` without versions installs whatever is newest on the day you build.
- **Editing in the UI after adopting JCasC.** The next reload or rebuild silently undoes it; change the file.
- **Disabling CSRF protection for scripts.** Use API tokens instead (lesson 7).
- **Forgetting build history and credentials.** JCasC recreates configuration, not `JENKINS_HOME`'s data; keep backups.

## Where this fits in a real system

The Jenkins image is built and scanned in a pipeline like the **Docker** and **GitHub Actions** image lessons, `casc.yaml` lives in **Git** next to it, and the controller usually runs on **Kubernetes** (the official Helm chart supports JCasC) with credentials from a secrets store. Most production Jenkins incidents involve plugins — pinning and reviewing them is the first line of defence.
