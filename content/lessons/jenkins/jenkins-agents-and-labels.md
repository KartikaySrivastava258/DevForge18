---
id: jenkins-agents-and-labels
title: Agents, labels and running builds in containers
track: jenkins
order: 5
level: intermediate
estimated_minutes: 45
prerequisites: [jenkins-configuration-as-code]
learning_objectives:
  - Explain why builds should run on agents rather than on the controller's built-in node.
  - Connect an inbound agent running in a container over WebSocket, with a label, configured from JCasC.
  - Route pipeline stages to agents with labels, and read why a build waits in the queue.
  - Compare static agents with containerised and on-demand agents (Docker, Kubernetes).
resources:
  - title: Managing nodes (controllers, agents, executors)
    url: https://www.jenkins.io/doc/book/managing/nodes/
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: How distributed builds use nodes, agents and executors, separate from the controller.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Controller isolation
    url: https://www.jenkins.io/doc/book/security/controller-isolation/
    publisher: Jenkins project
    type: documentation
    level: advanced
    official: true
    why: Builds on the built-in node can access the controller's files; it is highly advisable to run builds only on agents and give the built-in node no executors.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: jenkins/inbound-agent image
    url: https://github.com/jenkinsci/docker-agents/blob/master/README_inbound-agent.md
    publisher: Jenkins project
    type: documentation
    level: intermediate
    official: true
    why: Environment variables JENKINS_URL, JENKINS_SECRET, JENKINS_AGENT_NAME and JENKINS_WEB_SOCKET for connecting an agent container.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: built-in
    prompt: Why set the built-in node's executors to 0?
    options:
      - { id: a, text: "To save memory" }
      - { id: b, text: "Builds on the built-in node run with Jenkins' own access to the controller's files — a malicious or buggy build could read credentials and configuration; agents keep builds away from the controller" }
      - { id: c, text: "Agents are faster" }
    answer: b
    explanation: The Jenkins handbook calls it highly advisable. With 0 executors, every build must go to an agent.
  - id: label-wait
    prompt: A pipeline asks for agent { label 'windows' } and no agent has that label. What happens?
    options:
      - { id: a, text: "It runs on any agent" }
      - { id: b, text: "It waits in the queue; the queue's reason says there are no nodes with that label" }
      - { id: c, text: "Jenkins creates a Windows agent" }
    answer: b
    explanation: The lab reads the reason from the queue API. Typos in labels look exactly like this, so check the queue before blaming capacity.
  - id: inbound
    prompt: An inbound agent connects to the controller, not the other way round. Why is that useful?
    options:
      - { id: a, text: "It is required by Linux" }
      - { id: b, text: "The agent can sit behind a firewall or NAT and still work, because it opens the connection (here over WebSocket on the controller's normal HTTP port)" }
      - { id: c, text: "It makes builds faster" }
    answer: b
    explanation: The secret proves which agent is connecting; treat it like a password.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Jenkins 2.580.2 LTS and pinned plugins (from the previous lesson) and jenkins/inbound-agent 3395.v6e5377b_0fb_3c-4-jdk21 pinned by digest, after the previous lesson, and its output is compared with this lesson. Docker- and Kubernetes-based agents are described from the documentation, not executed. Checked against the Jenkins handbook and the agent image README on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

The Jenkins **controller** schedules work and should run none of it; builds run on **agents** — often containers — that connect to the controller and are chosen by **labels**, so the right tools, the right platform and enough capacity are available for each stage.

## Explain it like I'm twelve

A head chef takes orders and decides who cooks what, but does not stand at the stove — otherwise one burnt pan stops the whole kitchen. Cooks (**agents**) wear badges — "pastry", "grill" (**labels**) — and the head chef hands each order to a free cook with the right badge. If an order needs a "sushi" cook and nobody has that badge, the order waits on the board (**queue**) with a note saying why.

Where the analogy breaks: new cooks can be created in seconds — containers started for one build and thrown away afterwards.

## What problem it solves

A single Jenkins running builds on itself runs out of capacity, mixes tool versions between projects, and lets any build script read the controller's secrets. Agents spread the load, give each build the environment it needs (a JDK, Node.js, Windows, a GPU), and keep untrusted build code off the machine that holds credentials and configuration.

## How it works

![](media:jenkins/agents.svg)

- The **built-in node** (the controller itself) gets `numExecutors: 0`, so no build runs there.
- A **permanent agent** is declared in JCasC with a name, labels, a working directory and executors. An **inbound** agent connects *to* the controller — here over WebSocket on the normal HTTP port — authenticating with a secret.
- `agent { label 'linux' }` in a pipeline (or per stage) asks for any executor on a node with that label; if none exists or all are busy, the build waits in the **queue**, and the queue records why.
- Beyond static agents: the Docker Pipeline plugin runs stages inside containers on an agent with Docker, and the Kubernetes plugin starts a fresh Pod per build — both ways to get clean, disposable build environments.

## Try it yourself

> **Local lab** — needs Docker and Node.js, and builds the Jenkins image from *Configuration as Code and plugin management* (the previous lesson). The agent image is about 300 MB. Every command is run automatically in DevForge's tests, and the last step removes everything.

### 1. A controller that never builds, and one declared agent

```bash run
cd ..   # leave the previous lesson's folder
mkdir -p jenkins-agents/casc && cd jenkins-agents
cp ../jenkins-casc/plugins.txt ../jenkins-casc/Dockerfile .
docker build -q -t devforge-jenkins-casc:1 . > ../jenkins-build.log 2>&1 || { tail -n 20 ../jenkins-build.log; exit 1; }
cat > casc/jenkins.yaml <<'EOF'
jenkins:
  numExecutors: 0                 # the built-in node runs no builds
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: ${ADMIN_PASSWORD}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
  nodes:
    - permanent:
        name: "agent-1"
        labelString: "linux"
        remoteFS: "/home/jenkins/agent"
        numExecutors: 1
        launcher:
          inbound:
            webSocket: true       # the agent connects over the controller's HTTP port
jobs:
  - script: >
      pipelineJob('on-agent') {
        definition { cps { sandbox(true); script('''
          pipeline {
            agent { label 'linux' }
            stages { stage('Where am I') { steps { sh 'echo "running on $NODE_NAME in $WORKSPACE"' } } }
          }''') } }
      }
  - script: >
      pipelineJob('needs-windows') {
        definition { cps { sandbox(true); script('''
          pipeline {
            agent { label 'windows' }
            stages { stage('Build') { steps { echo 'no agent has this label' } } }
          }''') } }
      }
EOF
docker network create devforge-jenkins-net > /dev/null
docker run -d --name devforge-jenkins --network devforge-jenkins-net -p 127.0.0.1:8085:8080 \
  -e ADMIN_PASSWORD=lesson-only-pw -v "$PWD/casc:/var/jenkins_home/casc:ro" devforge-jenkins-casc:1 > /dev/null
J=http://127.0.0.1:8085; A="admin:lesson-only-pw"
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' -u "$A" "$J/api/json")" = 200 ] && break; sleep 2; done
json() { node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const j = JSON.parse(s); console.log(eval(process.argv[1])); });' "$1"; }
curl -sg -u "$A" "$J/computer/api/json?tree=computer[displayName,offline,numExecutors,assignedLabels[name]]" \
  | json 'j.computer.map((c) => `${c.displayName}: ${c.numExecutors} executor(s), labels ${c.assignedLabels.map((l) => l.name).join(" ")}, ${c.offline ? "offline" : "online"}`).join("\n")'
```

```text output
Built-In Node: 0 executor(s), labels built-in, online
agent-1: 1 executor(s), labels linux agent-1, offline
```

`agent-1` exists — configured from YAML — but is offline until an agent process connects with its secret.

### 2. Start the agent container

```bash run
secret=$(curl -s -u "$A" "$J/computer/agent-1/jenkins-agent.jnlp" | sed -E 's|.*<argument>([0-9a-f]{64})</argument>.*|\1|')
AGENT_IMAGE=jenkins/inbound-agent:3395.v6e5377b_0fb_3c-4-jdk21@sha256:0c5908a376ff73381f3617c8277b77559a9c8916fe0c22efd9b9e9ef326aeb27
docker pull -q "$AGENT_IMAGE" > /dev/null
docker run -d --name devforge-agent --network devforge-jenkins-net \
  -e JENKINS_URL=http://devforge-jenkins:8080 -e JENKINS_SECRET="$secret" -e JENKINS_AGENT_NAME=agent-1 \
  -e JENKINS_WEB_SOCKET=true -e JENKINS_AGENT_WORKDIR=/home/jenkins/agent "$AGENT_IMAGE" > /dev/null
for i in $(seq 1 60); do curl -sg -u "$A" "$J/computer/agent-1/api/json?tree=offline" | grep -q '"offline":false' && break; sleep 2; done
curl -sg -u "$A" "$J/computer/agent-1/api/json?tree=offline" | json '`agent-1 is ${j.offline ? "offline" : "online"}`'
```

```text output
agent-1 is online
```

The secret came from the controller (`jenkins-agent.jnlp`, readable only by an authorised user) and went to the agent as an environment variable. The agent opened a WebSocket connection to `devforge-jenkins:8080` — no extra port on the controller.

### 3. A build goes to the labelled agent

```bash run
crumb=$(curl -s -c cookies.txt -u "$A" "$J/crumbIssuer/api/json" | json '`${j.crumbRequestField}:${j.crumb}`')
curl -s -o /dev/null -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/job/on-agent/build"
for i in $(seq 1 90); do curl -sg -u "$A" "$J/job/on-agent/1/api/json?tree=result" 2> /dev/null | grep -q '"result":"' && break; sleep 2; done
curl -s -u "$A" "$J/job/on-agent/1/consoleText" | grep -E '^Running on|^running on|^Finished'
```

```text output
Running on agent-1 in /home/jenkins/agent/workspace/on-agent
running on agent-1 in /home/jenkins/agent/workspace/on-agent
Finished: SUCCESS
```

The controller had no executors; the `linux` label sent the build to `agent-1`, which checked out and ran it in its own workspace.

### 4. Why a build waits

```bash run
curl -s -o /dev/null -X POST -b cookies.txt -H "$crumb" -u "$A" "$J/job/needs-windows/build"
for i in $(seq 1 60); do curl -sg -u "$A" "$J/queue/api/json?tree=items[why]" | grep -q 'label' && break; sleep 2; done
curl -sg -u "$A" "$J/queue/api/json?tree=items[task[name],why]" | json 'j.items.map((i) => `${i.task.name}: ${i.why}`).join("\n")'
```

```text output
part of needs-windows #1: There are no nodes with the label ‘windows’
```

The build started, but its `agent { label 'windows' }` block is waiting in the queue. The reason is exact: no node has that label. The same message appears when a label is misspelled.

### 5. Clean up

```bash run
docker rm -f devforge-agent devforge-jenkins > /dev/null
docker network rm devforge-jenkins-net > /dev/null
docker image rm devforge-jenkins-casc:1 > /dev/null
echo "removed"
```

```text output
removed
```

## Common mistakes

- **Building on the built-in node.** Set its executors to 0; use agents.
- **One agent with every tool.** Tool versions collide; give agents labels by capability and keep their images small and specific — or use per-build containers.
- **Labels as typos.** A build waiting forever with "no nodes with the label" is often a spelling mistake.
- **Treating the agent secret as harmless.** It lets a machine connect as that agent; store it like a password.
- **Long-lived agents that collect state.** Workspaces and caches leak between builds; disposable container or Kubernetes agents avoid that.

## Where this fits in a real system

Most large Jenkins installations use the Kubernetes plugin: each build gets a fresh Pod (from **Kubernetes** lessons) with the containers it needs, built from images like those in the **Docker** track, and labels map to Pod templates. **GitHub Actions** solves the same problem with `runs-on` labels and self-hosted or hosted runners.
