---
id: jenkins-pipeline-as-code
title: Pipeline as code with a Jenkinsfile
track: jenkins
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [github-actions-first-workflow]
learning_objectives:
  - Read and write a declarative Jenkinsfile with agent, stages, steps and post sections.
  - Run a Pipeline job from a Git repository and read its console output.
  - Use Jenkins credentials without leaking them through Groovy string interpolation.
  - Compare Jenkins with GitHub Actions and explain when each fits.
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
  - id: post
    prompt: What does the post section of a declarative pipeline do?
    options:
      - { id: a, text: "It uploads the code to the server before the build" }
      - { id: b, text: "It runs steps after the stages finish, with conditions such as always, success and failure" }
      - { id: c, text: "It defines which agent to use" }
    answer: b
    explanation: post blocks run after the pipeline (or a stage) completes. failure is the place for notifications, always for cleanup — it runs even when a stage fails.
  - id: interpolation
    prompt: 'Why is sh "curl -H ''Authorization: Bearer ${DEPLOY_TOKEN}'' …" unsafe when DEPLOY_TOKEN is a credential?'
    options:
      - { id: a, text: "Double quotes are not allowed in Jenkinsfiles" }
      - { id: b, text: "In a double-quoted string Groovy substitutes the secret into the command text before the shell runs; single quotes let the shell read it from the environment instead" }
      - { id: c, text: "curl cannot send Authorization headers" }
    answer: b
    explanation: Jenkins itself warns when a secret is passed to sh through Groovy string interpolation, because the secret becomes part of the command text. With single quotes, the command text contains only $DEPLOY_TOKEN and the shell expands it from the environment.
  - id: choose
    prompt: A college lab must run CI on servers inside its private network that cannot be reached from the internet. Which fits better?
    options:
      - { id: a, text: "GitHub-hosted runners, because they are managed" }
      - { id: b, text: "Jenkins with agents inside the network (or GitHub Actions with self-hosted runners) — the build must run where the private systems are" }
      - { id: c, text: "Neither tool can do this" }
    answer: b
    explanation: Hosted runners live on the public internet. Running CI inside the network is a classic reason to choose Jenkins — although self-hosted GitHub Actions runners are also an option, so the decision also weighs operating effort and existing skills.
verification:
  method: executed
  details: Creating and committing the Jenkinsfile in the practice repository is run by the test suite and its output is compared with this lesson; every Jenkinsfile shown here is checked by DevForge's Jenkinsfile checker. Running the pipeline in the Jenkins web interface was written from the Jenkins documentation and is not executed.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **Jenkinsfile** describes a pipeline as code — where it runs, its stages and what happens afterwards — and lives in the repository, so it is reviewed and versioned like the code it builds.

## Explain it like I'm twelve

A recipe card taped inside the lid of a cooking kit: anyone who opens the kit finds the exact steps, in order, with "if it burns, do this" at the bottom. Change the recipe and the change is written on the card, so the next cook follows the new version.

Where the analogy breaks: Jenkins follows the card automatically, every time, and keeps a record of every attempt.

## What problem it solves

Jobs configured by clicking through web forms cannot be reviewed, are hard to copy between projects and are lost if the server is. Pipeline as code puts the build definition into Git: every change goes through a pull request, the history shows who changed what, and a new Jenkins server can rebuild every job from the repositories.

## How it works

```text
 pipeline {
   agent any                 ← where to run (any available executor or agent)
   options { … }             ← e.g. a timeout for the whole pipeline
   stages {
     stage('Check README') {  ← a named phase, shown on the build page
       steps { sh '…' }        ← the commands; a non-zero exit code fails the stage
     }
   }
   post { failure { … } success { … } always { … } }   ← after the stages
 }
```

This is the **declarative** syntax — structured and checked by Jenkins before it runs. (Jenkins also supports a *scripted* syntax, which is plain Groovy code; declarative is recommended for most pipelines.)

## Try it yourself

> **Local lab** — continue in the `student-notes` repository from the GitHub Actions lessons, and keep the Jenkins from the previous lesson running. Creating and committing the Jenkinsfile is run automatically in DevForge's tests; the Jenkins web-interface steps are not.

### 1. Write the Jenkinsfile

It runs the same check script as the GitHub Actions workflow, so you can compare the two systems directly:

```bash run
cat > Jenkinsfile <<'EOF'
pipeline {
  agent any
  options {
    timeout(time: 10, unit: 'MINUTES')
  }
  stages {
    stage('Check README') {
      steps {
        sh 'bash scripts/check-notes.sh'
      }
    }
  }
  post {
    success {
      echo 'All checks passed.'
    }
    failure {
      echo 'The README check failed. Open the console output and look for the FAIL line.'
    }
  }
}
EOF
git add Jenkinsfile
git commit -m "Add Jenkinsfile that checks the README"
```

```text output
[main 82373d8] Add Jenkinsfile that checks the README
 1 file changed, 21 insertions(+)
 create mode 100644 Jenkinsfile
```

The `timeout` option stops a stuck build instead of letting it occupy an executor forever.

### 2. Run it in Jenkins

Jenkins must be able to fetch the repository, so push `student-notes` to GitHub first (Git lesson 3). A Jenkins running in Docker on your laptop cannot see folders on your disk. Then, in Jenkins (these steps are not executed by DevForge's tests):

1. **New Item** → name it `student-notes` → choose **Pipeline**.
2. In the **Pipeline** section set **Definition** to *Pipeline script from SCM*, **SCM** to *Git*, the **Repository URL** to your GitHub repository, the branch to `*/main`, and the **Script Path** to `Jenkinsfile`.
3. Save, then **Build Now**. Open the build and its **Console Output**: you will see the checkout, then `PASS: README.md has a title`, then `All checks passed.`
4. Break the README title, commit, push and build again: the stage fails, the console shows the `FAIL:` line, and the `failure` message runs.

GitHub cannot send webhooks to a Jenkins on your laptop, so to build automatically you can poll instead, by adding `triggers { pollSCM('H/5 * * * *') }` inside `pipeline`. `H` spreads the polling time so many jobs do not all poll in the same minute.

### 3. Credentials without leaks

Store secrets in Jenkins (**Manage Jenkins → Credentials**), never in the Jenkinsfile, and reference them by ID. DevForge's Jenkinsfile checker rejects this version, which hard-codes one secret and leaks another through Groovy interpolation:

```groovy jenkinsfile invalid
pipeline {
  agent any
  environment {
    API_TOKEN    = 'abc123-do-not-do-this'
    DEPLOY_TOKEN = credentials('deploy-token')
  }
  stages {
    stage('Deploy') {
      steps {
        sh "curl -H 'Authorization: Bearer ${DEPLOY_TOKEN}' https://deploy.example.invalid/"
      }
    }
  }
}
```

The safe version keeps the token in Jenkins and uses **single quotes**, so Groovy leaves `$DEPLOY_TOKEN` alone and the shell reads it from the environment. Jenkins also masks the value if it is printed in the console:

```groovy jenkinsfile
pipeline {
  agent any
  environment {
    DEPLOY_TOKEN = credentials('deploy-token')
  }
  stages {
    stage('Deploy') {
      steps {
        sh 'curl -H "Authorization: Bearer $DEPLOY_TOKEN" https://deploy.example.invalid/'
      }
    }
  }
}
```

### 4. Jenkins and GitHub Actions side by side

| | Jenkins | GitHub Actions |
|---|---|---|
| Who runs it | You: server, upgrades, plugins, backups | GitHub (or your own self-hosted runners) |
| Pipeline file | `Jenkinsfile` (Groovy-based) | `.github/workflows/*.yml` (YAML) |
| Where builds run | Agents you provide, anywhere on your network | Hosted runners, or self-hosted runners |
| Extensions | Plugins installed on the server | Actions referenced from each workflow |
| Secrets | Credentials store on the controller | Repository and organisation secrets |
| Typical fit | Private networks, special hardware, existing Jenkins expertise | Projects already on GitHub that want little to operate |

Neither is "better": the right choice depends on where builds must run, who will operate the system and what the team already knows.

## Common mistakes

- **Configuring jobs by clicking instead of using a Jenkinsfile.** The configuration cannot be reviewed and is lost with the server.
- **Double-quoted strings around secrets.** Use single quotes so the shell expands credentials.
- **No timeout.** A hanging test can occupy an executor indefinitely.
- **Putting pipeline logic in long inline `sh` blocks.** Keep it in scripts in the repository, as here, so it also runs locally and in other CI systems.
- **Forgetting cleanup.** A `post { always { … } }` block runs even when a stage fails; use it to remove files, containers or test databases a build created.

## Where this fits in a real system

A typical Jenkins pipeline checks out code from **Git**, runs tests in a **Docker** agent, builds and pushes an image, and deploys to **Kubernetes**, with **Jira** issue keys in commit messages linking builds to work items. The same `check-notes.sh` now runs in GitHub Actions and in Jenkins — keeping logic in scripts is what makes moving between CI systems straightforward.
