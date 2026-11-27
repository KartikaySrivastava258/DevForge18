---
id: jenkins-shared-libraries
title: Shared libraries
track: jenkins
order: 6
level: advanced
estimated_minutes: 45
prerequisites: [jenkins-configuration-as-code]
learning_objectives:
  - Structure a shared library with global steps in vars/ and Groovy classes in src/.
  - Register the library with Jenkins from JCasC, pinned to a default version, and load it in a Jenkinsfile with @Library.
  - Release a new library version as a Git tag, and let one pipeline opt in to it while the others stay on the default.
  - Decide what belongs in a shared library and what stays in each Jenkinsfile.
resources:
  - title: Extending with Shared Libraries
    url: https://www.jenkins.io/doc/book/pipeline/shared-libraries/
    publisher: Jenkins project
    type: documentation
    level: advanced
    official: true
    why: The src/, vars/ and resources/ layout, @Library('name') and @Library('name@version'), and implicit loading.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Configuration as Code (Jenkins handbook)
    url: https://www.jenkins.io/doc/book/managing/casc/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Registering global libraries from YAML, as in the previous lessons.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Git HTTP transport ("dumb" protocol) — git update-server-info
    url: https://git-scm.com/docs/git-update-server-info
    publisher: Git project
    type: reference
    level: advanced
    official: true
    why: Prepares a bare repository so a plain web server can serve it for cloning — how the lab hosts the library without a Git server.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: vars
    prompt: What does vars/greet.groovy with a call method give pipelines?
    options:
      - { id: a, text: "A Groovy class they must import" }
      - { id: b, text: "A global step: greet('Asha') works in any pipeline that loads the library" }
      - { id: c, text: "An environment variable called greet" }
    answer: b
    explanation: Files in vars/ become global variables named after the file; call makes them usable like built-in steps. Reusable classes go in src/.
  - id: versions
    prompt: The library's default version is v1.0. A team wants to try v1.1 before everyone moves. What do they do?
    options:
      - { id: a, text: "Change the default for everyone" }
      - { id: b, text: "Use @Library('devforge-lib@v1.1') _ in their own Jenkinsfile; other pipelines stay on v1.0 until the default is changed" }
      - { id: c, text: "Copy the library into their repository" }
    answer: b
    explanation: The lab runs two jobs side by side on v1.0 and v1.1. Version overrides must be allowed in the library's configuration.
  - id: trust
    prompt: Why should changes to a global shared library be reviewed as carefully as changes to Jenkins itself?
    options:
      - { id: a, text: "They are rarely used" }
      - { id: b, text: "Every pipeline that loads the library runs its code — a bad change breaks or compromises all of them at once" }
      - { id: c, text: "Libraries cannot be tested" }
    answer: b
    explanation: Protect the library repository's main branch, tag releases, and pin pipelines to versions.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and pinned plugins (pipeline-groovy-lib 822.vc95f70dea_db_7, git 5.11.0, from the earlier lessons), after the Configuration as Code lesson, and its output is compared with this lesson. The library repository is served over HTTP by busybox httpd. Checked against the Jenkins handbook and Git documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

When many Jenkinsfiles repeat the same stages, put them in a **shared library** — a versioned Git repository of Groovy steps that every pipeline loads with `@Library` — so fixes and improvements reach every team at once, on a version they choose.

## Explain it like I'm twelve

Every class in a school writes lab reports, and each teacher used to hand out their own template. The school publishes one template book instead (**shared library**), with numbered editions (**versions**). Classes use the current edition by default; a class that wants to try the new edition early can ask for it by number, while the rest keep the old one until everyone switches.

Where the analogy breaks: the "template" is code that runs inside every pipeline, so a mistake in it affects all of them.

## What problem it solves

Fifty repositories with fifty slightly different Jenkinsfiles drift: one team adds a security scan, others never do; a fix to the deployment stage needs fifty pull requests. A shared library keeps the common parts in one reviewed place, while each Jenkinsfile shrinks to what is genuinely specific to its project.

## How it works

![](media:jenkins/shared-library.svg)

- Layout: `vars/name.groovy` defines a **global step** `name(…)` (its `call` method); `src/` holds Groovy classes (`org/devforge/Versions.groovy`); `resources/` holds data files.
- A **global library** is registered (here in JCasC under `globalLibraries`) with a name, a Git repository, a **default version** (a tag or branch) and whether pipelines may override it.
- `@Library('devforge-lib') _` loads the default version; `@Library('devforge-lib@v1.1') _` asks for another. Jenkins prints which revision it resolved, so every build records exactly which library code it ran.

## Try it yourself

> **Local lab** — needs Docker, Git and Node.js, and builds the Jenkins image from *Configuration as Code and plugin management*. A tiny web server container hosts the library repository. Every command is run automatically in DevForge's tests, and the last step removes everything.

### 1. A library with a global step, a pipeline step and a class

```bash run
cd ..   # leave the previous lesson's folder
mkdir -p jenkins-library/casc && cd jenkins-library
cp ../jenkins-casc/plugins.txt ../jenkins-casc/Dockerfile .
mkdir -p devforge-lib/vars devforge-lib/src/org/devforge && cd devforge-lib && git init -q
git config user.name "Asha Rao" && git config user.email "asha@example.edu"   # an identity for this repository's commits
cat > vars/greet.groovy <<'EOF'
// A global step: call it from a pipeline as greet('Asha').
def call(String name) {
  echo "Hello, ${name}, from the shared library"
}
EOF
cat > vars/standardBuild.groovy <<'EOF'
// The stages every service needs, run the same way everywhere.
def call(Map config = [:]) {
  String service = config.service ?: 'unnamed-service'
  stage('Test') { echo "testing ${service}" }
  stage('Package') { echo "packaging ${service} with ${org.devforge.Versions.toolchain()}" }
}
EOF
cat > src/org/devforge/Versions.groovy <<'EOF'
package org.devforge

class Versions {
  static String toolchain() { return 'toolchain 1.0' }
}
EOF
git add . && git commit -q -m "Shared steps" && git tag v1.0
sed -i 's/toolchain 1.0/toolchain 1.1/' src/org/devforge/Versions.groovy && git commit -q -am "Toolchain 1.1" && git tag v1.1
git tag --list
```

```text output
v1.0
v1.1
```

Two released versions: `v1.0` and a newer `v1.1` that changes the toolchain.

### 2. Host the repository, and register the library in JCasC

```bash run
cd ..
git clone -q --bare devforge-lib srv/devforge-lib.git
git -C srv/devforge-lib.git update-server-info   # lets a plain web server serve it for cloning
docker build -q -t devforge-jenkins-casc:1 . > ../jenkins-build.log 2>&1 || { tail -n 20 ../jenkins-build.log; exit 1; }
docker network create devforge-jenkins-net > /dev/null
docker pull -q busybox:1.37 > /dev/null
docker run -d --name devforge-libserver --network devforge-jenkins-net -v "$PWD/srv:/srv:ro" busybox:1.37 httpd -f -p 80 -h /srv > /dev/null
cat > casc/jenkins.yaml <<'EOF'
jenkins:
  numExecutors: 2      # builds on the built-in node keep this lab short; use agents in real setups
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${ADMIN_PASSWORD}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
unclassified:
  globalLibraries:
    libraries:
      - name: "devforge-lib"
        defaultVersion: "v1.0"            # what @Library('devforge-lib') loads
        allowVersionOverride: true        # lets a pipeline ask for another version
        implicit: false                   # pipelines must ask for it explicitly
        retriever:
          modernSCM:
            scm:
              git:
                remote: "http://devforge-libserver/devforge-lib.git"
jobs:
  - script: >
      pipelineJob('course-site') {
        definition { cps { sandbox(true); script('''
          @Library('devforge-lib') _
          node {
            greet('Asha')
            standardBuild(service: 'course-site')
          }''') } }
      }
  - script: >
      pipelineJob('course-site-next') {
        definition { cps { sandbox(true); script('''
          @Library('devforge-lib@v1.1') _
          node {
            standardBuild(service: 'course-site')
          }''') } }
      }
EOF
docker run -d --name devforge-jenkins --network devforge-jenkins-net -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=lesson-only-pw -v "$PWD/casc:/var/jenkins_home/casc:ro" devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085; A="admin:lesson-only-pw"
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/api/json")" = 200 ] && break; sleep 2; done
echo "Jenkins is up; the library is served at http://devforge-libserver/devforge-lib.git"
```

```text output
Jenkins is up; the library is served at http://devforge-libserver/devforge-lib.git
```

Each `jobs:` entry is now a two-line Jenkinsfile: load the library, call its steps.

### 3. Run both pipelines

```bash run
crumb=$(curl -s -c cookies.txt -u "$A" "$J/crumbIssuer/api/json" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const c = JSON.parse(s); console.log(`${c.crumbRequestField}:${c.crumb}`); });')
for job in course-site course-site-next; do
  curl -s -o /dev/null -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/job/$job/build"
  for i in $(seq 1 90); do curl -sg -u "$A" "$J/job/$job/1/api/json?tree=result" 2> /dev/null | grep '"result":"' > /dev/null && break; sleep 2; done
  echo "== $job"
  curl -s -u "$A" "$J/job/$job/1/consoleText" | grep -E '^Loading library|^Resolved tag|^Hello|^testing|^packaging|^Finished' | sed -E 's/revision [0-9a-f]{40}/revision …/'
done
```

```text output
== course-site
Loading library devforge-lib@v1.0
Resolved tag v1.0 revision …
Hello, Asha, from the shared library
testing course-site
packaging course-site with toolchain 1.0
Finished: SUCCESS
== course-site-next
Loading library devforge-lib@v1.1
Resolved tag v1.1 revision …
testing course-site
packaging course-site with toolchain 1.1
Finished: SUCCESS
```

- `course-site` used the default `v1.0`; `course-site-next` opted in to `v1.1` and got the new toolchain — without affecting anyone else.
- Each build log records the tag and the exact commit it resolved: you can always tell which library code a build ran.
- When `v1.1` has proven itself, changing `defaultVersion` in the YAML (a reviewed pull request) moves every pipeline at once.

### 4. Clean up

```bash run
docker rm -f devforge-jenkins devforge-libserver > /dev/null
docker network rm devforge-jenkins-net > /dev/null
docker image rm devforge-jenkins-casc:1 > /dev/null
echo "removed"
```

```text output
removed
```

## Common mistakes

- **Defaulting to a moving branch.** `defaultVersion: main` means every merge changes every pipeline immediately. Default to a tag, and move it deliberately.
- **Putting everything in the library.** Project-specific steps belong in the project's Jenkinsfile; libraries hold what is genuinely shared.
- **Huge Groovy logic in `vars/`.** Pipeline code runs in a special interpreter; keep steps thin and call well-tested tools (scripts, CLIs) from them.
- **Untrusted libraries loaded implicitly.** Global libraries run with elevated trust (outside the sandbox); review them like Jenkins configuration and restrict who can change them.
- **No tests for the library.** Use a test Jenkins (like this lab) or a pipeline unit-testing framework before tagging a release.

## Where this fits in a real system

Platform teams publish a library with `standardBuild`, `deployToKubernetes` and similar steps that wrap **Docker** builds, **Kubernetes** rollouts and **Terraform** plans; each service's Jenkinsfile stays a few lines long. **GitHub Actions** reaches the same goal with reusable workflows and composite actions.
