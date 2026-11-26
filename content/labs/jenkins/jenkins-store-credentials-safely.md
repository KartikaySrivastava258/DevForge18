---
id: jenkins-store-credentials-safely
title: Store credentials safely
track: jenkins
level: advanced
mode: local
estimated_minutes: 35
prerequisites: [jenkins-parallel-artifacts-tests]
objectives:
  - Bind a Jenkins credential to an environment variable instead of writing the secret into the Jenkinsfile.
  - Show, with real processes, why a secret pasted into a command line leaks (process list) and can run as code (injection).
  - Write a Jenkinsfile and script that only ever let the shell read the secret from its environment, and check them.
checkpoints:
  - { id: leak, text: "ps showed the secret in the command line of the interpolated version, and not in the safe one" }
  - { id: injection, text: "The secret containing $(…) ran a command when interpolated, and stayed text when read from the environment" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Using a Jenkinsfile — Handling credentials and string interpolation
    url: https://www.jenkins.io/doc/book/pipeline/jenkinsfile/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: credentials() and withCredentials, and why Groovy string interpolation must never be used with credentials.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: The shell demonstrations, the script, and writing and committing the Jenkinsfile in the practice repository are run by DevForge's test suite, and their output is compared with this page; every Jenkinsfile shown is checked by DevForge's Jenkinsfile checker, including the wrong one, which must be caught. Jenkins' own handling of credentials was checked against the Jenkins documentation on 2026-11-26 but is not executed, because it needs a Jenkins with the Credentials and Pipeline plugins.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

The notes pipeline needs a token to publish. You see the most common way a Jenkinsfile leaks a secret, reproduce **why** it leaks with real processes on your machine, and then write a pipeline and script where the secret is never part of any command text — and check them.

## Before you start

Continue in the `student-notes` practice repository from the Jenkins lessons (on Windows, Git Bash). The token in this lab is made up; never put a real secret in a practice repository.

## Steps

### 1. The tempting, wrong version

In Jenkins, a secret is stored once as a **credential** (here with the ID `notes-publish-token`) and bound to a variable when a pipeline runs. A first attempt often looks like this:

```groovy jenkinsfile invalid
pipeline {
  agent any
  environment {
    NOTES_TOKEN = credentials('notes-publish-token')
  }
  stages {
    stage('Publish') {
      steps {
        sh "curl -fsS -H 'Authorization: Bearer ${NOTES_TOKEN}' https://notes.example.edu/publish"
      }
    }
  }
}
```

Using `credentials(…)` is right. The bug is the **double quotes**. In Groovy, a double-quoted string is a *GString*: `${NOTES_TOKEN}` is replaced by the secret **before** the command is sent to the shell. Jenkins' documentation says plainly that Groovy string interpolation should never be used with credentials: the secret is copied into the process arguments, where tools such as `ps` can see it, and any shell metacharacters in it are executed. DevForge's Jenkinsfile checker reports exactly this line.

### 2. See the leak with real processes

You do not need Jenkins to see why. Here, `SECRET` plays the part of the credential, and `sh -c "…"` the part of a GString command — the value is pasted into the command text:

```bash run
SECRET='demo-token-12345'
sh -c "echo 'Authorization: Bearer $SECRET' > /dev/null; sleep 2" &
sleep 0.5
echo "pasted into the command:  $(ps -o args= -p $!)"
wait
TOKEN="$SECRET" sh -c 'echo "Authorization: Bearer $TOKEN" > /dev/null; sleep 2' &
sleep 0.5
echo "read from the environment: $(ps -o args= -p $!)"
wait
```

```text output
pasted into the command:  sh -c echo 'Authorization: Bearer demo-token-12345' > /dev/null; sleep 2
read from the environment: sh -c echo "Authorization: Bearer $TOKEN" > /dev/null; sleep 2
```

The process list — readable by other programs and users on the same machine — shows the secret in the first command line, and only the variable's *name* in the second. On a build agent, that process list is shared by everything else running there.

### 3. See the injection

Secrets are random strings, and random strings can contain characters the shell treats as code. Pretend the token contains `$(…)`:

```bash run
SECRET='abc$(echo INJECTED)xyz'
echo "pasted into the command:  $(sh -c "echo token is $SECRET")"
echo "read from the environment: $(TOKEN="$SECRET" sh -c 'echo token is "$TOKEN"')"
```

```text output
pasted into the command:  token is abcINJECTEDxyz
read from the environment: token is abc$(echo INJECTED)xyz
```

Pasted into the command text, the shell *ran* `echo INJECTED` — any command could have been there, and the token arrived changed. Read from the environment, it stayed an exact string. If the token is changed on the way, Jenkins can also no longer recognise it to mask it in the build log.

### 4. The safe version

The script reads the token from its environment and never prints it:

```bash run
cat > scripts/publish.sh <<'EOF'
#!/usr/bin/env bash
# Publishes the notes. Reads NOTES_TOKEN from the environment; never prints it.
set -euo pipefail
: "${NOTES_TOKEN:?NOTES_TOKEN is not set}"
echo "publishing notes with a token of ${#NOTES_TOKEN} characters"
# A real script would send it in a header, for example:
#   curl -fsS -H "Authorization: Bearer ${NOTES_TOKEN}" https://notes.example.edu/publish
EOF
NOTES_TOKEN='demo-token-12345' bash scripts/publish.sh
```

```text output
publishing notes with a token of 16 characters
```

And the Jenkinsfile only passes a **single-quoted**, literal command, so the shell — not Groovy — reads the variable:

```bash run
cat > Jenkinsfile <<'EOF'
pipeline {
  agent any
  options {
    timeout(time: 10, unit: 'MINUTES')
  }
  stages {
    stage('Checks') {
      steps {
        sh 'bash scripts/test.sh'
      }
    }
    stage('Publish') {
      when {
        branch 'main'
      }
      environment {
        NOTES_TOKEN = credentials('notes-publish-token')
      }
      steps {
        sh 'bash scripts/publish.sh'
      }
    }
  }
}
EOF
git add Jenkinsfile scripts/publish.sh
git commit -q -m "Publish with a credential, never interpolated"
git show --stat --format=%s HEAD | tail -n 3
```

```text output
 Jenkinsfile        | 29 ++++++++++-------------------
 scripts/publish.sh |  7 +++++++
 2 files changed, 17 insertions(+), 19 deletions(-)
```

- `environment { NOTES_TOKEN = credentials('notes-publish-token') }` inside the **Publish** stage: the secret exists only while that stage runs, not during the checks.
- `when { branch 'main' }` — only builds of `main` reach the stage that can read the token. (The Jenkins documentation notes that this condition only works in a multibranch Pipeline, which knows the branch being built.)
- `sh 'bash scripts/publish.sh'` — the command text contains no secret at all; the script reads `NOTES_TOKEN` from its environment.
- In Jenkins, create the credential under **Manage Jenkins → Credentials** as *Secret text* with the ID `notes-publish-token`. Jenkins masks the bound value in the build log — one more reason never to transform it before use.

## Check your work

Run this inside `student-notes`.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "Jenkinsfile and publish.sh are committed" 'git ls-files --error-unmatch Jenkinsfile scripts/publish.sh'
check "the token comes from a Jenkins credential" 'grep -qE "NOTES_TOKEN = credentials\(.notes-publish-token.\)" Jenkinsfile'
check "no double-quoted string in the Jenkinsfile uses the token" '! grep -E "\"[^\"]*\\\$\{?NOTES_TOKEN" Jenkinsfile'
check "no secret value is written in the repository" '! git grep -qE "demo-token-[0-9]+" -- Jenkinsfile scripts'
check "publish.sh refuses to run without the token" '! env -u NOTES_TOKEN bash scripts/publish.sh'
check "publish.sh never prints the token" 'out=$(NOTES_TOKEN=check-secret-value bash scripts/publish.sh) && ! echo "$out" | grep -q check-secret-value'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: Jenkinsfile and publish.sh are committed
PASS: the token comes from a Jenkins credential
PASS: no double-quoted string in the Jenkinsfile uses the token
PASS: no secret value is written in the repository
PASS: publish.sh refuses to run without the token
PASS: publish.sh never prints the token
All checks passed
```

## Reset

Undo the lab's commit with `git reset --hard HEAD~1` (only if you have not pushed it), then start again at step 4.

## What you practised

A secret is safe in a pipeline only if it is never part of a command's text: store it as a credential, bind it to an environment variable for the one stage that needs it, pass the shell a literal single-quoted command, and let scripts read it without printing it. The process list and shell injection are why "it worked" is not the same as "it was safe".
