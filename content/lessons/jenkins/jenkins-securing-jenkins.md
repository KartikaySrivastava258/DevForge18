---
id: jenkins-securing-jenkins
title: Securing Jenkins
track: jenkins
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [jenkins-configuration-as-code]
learning_objectives:
  - Give each person or service account only the permissions it needs with the matrix authorization strategy, configured as code.
  - Prove the permissions with real requests — who can read, build, administer and reach the script console.
  - Use per-user API tokens for scripts instead of passwords, and explain why tokens are exempt from CSRF crumbs.
  - List the other essentials of a secure Jenkins — no builds on the controller, plugin updates and security advisories, and credentials handling.
resources:
  - title: Access control
    url: https://www.jenkins.io/doc/book/security/access-control/
    publisher: Jenkins project
    type: documentation
    level: advanced
    official: true
    why: Security realm and authorization strategy, matrix authorization, and not granting significant permissions to anonymous or authenticated.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: CSRF protection
    url: https://www.jenkins.io/doc/book/security/csrf-protection/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Crumbs for changing requests; requests authenticated with an API token are exempt.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Controller isolation
    url: https://www.jenkins.io/doc/book/security/controller-isolation/
    publisher: Jenkins project
    type: documentation
    level: advanced
    official: true
    why: Builds should not run on the built-in node; agent-to-controller access control.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Jenkins security advisories
    url: https://www.jenkins.io/security/advisories/
    publisher: Jenkins project
    type: reference
    level: intermediate
    official: true
    why: Published fixes for Jenkins core and plugins — what to watch and act on when upgrading pinned versions.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: least
    prompt: A deployment script only needs to start the release job. Which permissions should its Jenkins account have?
    options:
      - { id: a, text: "Overall/Administer, to be safe" }
      - { id: b, text: "Overall/Read, Job/Read and Job/Build (ideally only on that job) — nothing more" }
      - { id: c, text: "Anonymous access" }
    answer: b
    explanation: The lab's dev account can read and build but gets 403 on the script console and the management pages.
  - id: script-console
    prompt: Why is the script console (/script) limited to administrators?
    options:
      - { id: a, text: "It is slow" }
      - { id: b, text: "It runs arbitrary Groovy inside the controller, with access to every credential and file Jenkins has — whoever can use it controls Jenkins" }
      - { id: c, text: "It only shows logs" }
    answer: b
    explanation: Treat Overall/Administer as full control of the server and of every secret stored in it.
  - id: token
    prompt: Why should scripts use an API token rather than the user's password?
    options:
      - { id: a, text: "Tokens are longer" }
      - { id: b, text: "A token can be created per script, revoked on its own, never unlocks the web UI login, and is exempt from CSRF crumbs — the password stays with the person" }
      - { id: c, text: "Passwords do not work with curl" }
    answer: b
    explanation: The lab shows the same request refused with a password and no crumb, and accepted with dev's token.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and pinned plugins (matrix-auth 3.3 and the others from the Configuration as Code lesson), after that lesson, and its output is compared with this lesson. Checked against the Jenkins security documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Jenkins holds the keys to everything it deploys, so give every person and script the **least permission** it needs (matrix authorization), let scripts use **revocable API tokens**, keep builds **off the controller**, and keep **plugins patched** — all of it in configuration you can review.

## Explain it like I'm twelve

The school office has a safe with every key in the school. The head has the safe's combination; teachers can borrow a register and ring the bell; visitors can read the notice board. A substitute teacher gets a temporary badge that opens one classroom and can be cancelled at any time (**API token**). And nobody runs a science experiment inside the office (**no builds on the controller**).

Where the analogy breaks: in Jenkins, "the office" also runs code — which is why the script console is the safe.

## What problem it solves

Jenkins stores deployment credentials, cloud keys and signing secrets, and runs code from many repositories. A Jenkins where every logged-in user can do anything turns one stolen password — or one malicious pull request — into control of production. Most Jenkins security advisories concern plugins, so unpatched plugins are the other common way in.

## How it works

![](media:jenkins/security.svg)

- **Security realm** (who you are: here Jenkins' own user database) and **authorization strategy** (what you may do: here the matrix of users and permissions, from the matrix-auth plugin) are both set in JCasC.
- Permissions are named like `Overall/Read`, `Job/Build`, `Overall/Administer`; Administer includes everything — including the **script console**, which runs code on the controller.
- **API tokens** are generated per user and per purpose; requests that use them need no CSRF crumb and they can be revoked without touching the password.
- Also part of the baseline: the built-in node has 0 executors (lesson 5), credentials are stored in Jenkins and masked (the credentials lab), and plugin versions are pinned and updated after reading the security advisories (lesson 4).

## Try it yourself

> **Local lab** — needs Docker and Node.js, and builds the Jenkins image from *Configuration as Code and plugin management*. The passwords are for this lesson only. Every command is run automatically in DevForge's tests, and the last step removes everything.

### 1. Three users and a permission matrix

```bash run
cd ..   # leave the previous lesson's folder
mkdir -p jenkins-security/casc && cd jenkins-security
cp ../jenkins-casc/plugins.txt ../jenkins-casc/Dockerfile .
docker build -q -t devforge-jenkins-casc:1 . > ../jenkins-build.log 2>&1 || { tail -n 20 ../jenkins-build.log; exit 1; }
cat > casc/jenkins.yaml <<'EOF'
jenkins:
  numExecutors: 1      # only to keep the lab short; use agents (lesson 5)
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${ADMIN_PASSWORD}
        - id: dev
          password: ${DEV_PASSWORD}
        - id: viewer
          password: ${VIEWER_PASSWORD}
  authorizationStrategy:
    globalMatrix:
      entries:                      # anyone not listed (including anonymous) gets nothing
        - user:
            name: admin
            permissions:
              - Overall/Administer
        - user:
            name: dev
            permissions:
              - Overall/Read
              - Job/Read
              - Job/Build
        - user:
            name: viewer
            permissions:
              - Overall/Read
              - Job/Read
jobs:
  - script: >
      pipelineJob('release') {
        definition { cps { sandbox(true); script('''
          pipeline { agent any
            stages { stage('Release') { steps { echo 'releasing' } } } }''') } }
      }
EOF
docker run -d --name devforge-jenkins -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=admin-lesson-pw -e DEV_PASSWORD=dev-lesson-pw -e VIEWER_PASSWORD=viewer-lesson-pw \
  -v "$PWD/casc:/var/jenkins_home/casc:ro" devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u admin:admin-lesson-pw "$J/api/json")" = 200 ] && break; sleep 2; done
echo "Jenkins is up"
```

```text output
Jenkins is up
```

### 2. Prove what each account can do

```bash run
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
printf '%-10s %-10s %-15s %s\n' account "read job" "script console" "manage Jenkins"
for account in anonymous viewer:viewer-lesson-pw dev:dev-lesson-pw admin:admin-lesson-pw; do
  if [ "$account" = anonymous ]; then auth=(); else auth=(-u "$account"); fi
  printf '%-10s %-10s %-15s %s\n' "${account%%:*}" "$(code "${auth[@]}" "$J/job/release/api/json")" "$(code "${auth[@]}" "$J/script")" "$(code "${auth[@]}" "$J/manage/")"
done
```

```text output
account    read job   script console  manage Jenkins
anonymous  403        403             403
viewer     200        403             403
dev        200        403             403
admin      200        200             200
```

Every row matches the matrix: anonymous gets nothing, `viewer` and `dev` can read the job, and only `admin` reaches the script console and the management pages. Test permissions this way after every change — a matrix that *looks* right in YAML can still grant too much.

### 3. API tokens for scripts

```bash run
new_token() {   # signs in with the password once, in a session with a crumb, and creates a named token
  local user=$1 password=$2 crumb
  crumb=$(curl -s -c "cookies-$user.txt" -u "$user:$password" "$J/crumbIssuer/api/json" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const c = JSON.parse(s); console.log(`${c.crumbRequestField}:${c.crumb}`); });')
  curl -s -b "cookies-$user.txt" -H "$crumb" -u "$user:$password" -X POST --data newTokenName=release-script \
    "$J/user/$user/descriptorByName/jenkins.security.ApiTokenProperty/generateNewToken" \
    | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).data.tokenValue));'
}
DEV_TOKEN=$(new_token dev dev-lesson-pw)
VIEWER_TOKEN=$(new_token viewer viewer-lesson-pw)
echo "dev, password, no crumb: $(code -X POST -u dev:dev-lesson-pw "$J/job/release/build")"
echo "dev, API token:          $(code -X POST -u "dev:$DEV_TOKEN" "$J/job/release/build")"
echo "viewer, API token:       $(code -X POST -u "viewer:$VIEWER_TOKEN" "$J/job/release/build")"
for i in $(seq 1 60); do curl -sg -u admin:admin-lesson-pw "$J/job/release/1/api/json?tree=result" 2> /dev/null | grep -q '"result":"' && break; sleep 2; done
curl -sg -u admin:admin-lesson-pw "$J/job/release/1/api/json?tree=result,actions[causes[shortDescription]]" | grep -oE '"shortDescription":"[^"]*"|"result":"[A-Z]+"'
```

```text output
dev, password, no crumb: 403
dev, API token:          201
viewer, API token:       403
"shortDescription":"Started by user dev"
"result":"SUCCESS"
```

- With a password, a changing request needs a crumb; with an API token it does not — the token itself proves the request is not a forged browser request.
- A token carries its user's permissions: `viewer`'s token still cannot build.
- The build records who started it. Tokens are named, so each script can have its own, revocable on the user's page without changing the password.

### 4. Clean up

```bash run
docker rm -f devforge-jenkins > /dev/null
docker image rm devforge-jenkins-casc:1 > /dev/null
echo "removed"
```

```text output
removed
```

## Common mistakes

- **"Logged-in users can do anything" in production.** Fine for a laptop; with many users it means any account is an admin.
- **Permissions for `anonymous` or `authenticated`.** Grant to specific users or groups.
- **Sharing the admin password with scripts.** Create a service user with minimal permissions and a named API token.
- **Ignoring plugin security advisories.** Subscribe, read, update the pinned version, rebuild the image.
- **Exposing Jenkins directly to the internet.** Put it behind single sign-on, a VPN or at least TLS termination (see the **Nginx** track), and restrict agent connections.

## Where this fits in a real system

Organisations connect Jenkins to their identity provider (LDAP, SAML or OIDC) and map groups to permissions in JCasC, store build secrets in a vault, and run agents on **Kubernetes** with network policies. The same least-privilege thinking appears in **GitHub Actions** (`permissions:` per job, OIDC instead of stored keys) and in **Kubernetes** RBAC.
