---
id: self-managed-ci
title: Self-managed CI with Jenkins and build agents
summary: A Jenkins controller, built as a Docker image with pinned plugins and configured as code, reads Jenkinsfiles from Git, runs none of the work itself and sends each stage to agents chosen by label — containers or a fresh Kubernetes Pod per build — with credentials bound only to the stages that need them.
problem: An organisation must run CI inside its own network, or with tools and capacity that a hosted service does not offer, without the CI server becoming an over-privileged machine that was configured by hand and that nobody can rebuild.
tracks: [jenkins, docker, git-github, kubernetes]
diagram: media:architecture/self-managed-ci.svg
components:
  - { name: Git repository, track: git-github, role: "Holds the code, the Jenkinsfile and the scripts it calls, so the pipeline is reviewed and versioned with the code; a multibranch job builds every branch." }
  - { name: Jenkins controller, track: jenkins, role: "Stores pipelines and schedules builds but runs none of them (0 executors on the built-in node); security, users and jobs come from Configuration as Code kept in Git." }
  - { name: Controller image, track: docker, role: "A pinned Jenkins release with plugins pinned in plugins.txt, rebuilt deliberately after reading security advisories; JENKINS_HOME lives on a backed-up volume." }
  - { name: Shared library, track: jenkins, role: "Versioned steps that many Jenkinsfiles load with @Library at a tag, so fixes reach every team on a version they choose." }
  - { name: Labelled agents, track: jenkins, role: "Machines or containers that connect to the controller and run stages; a stage asks for a label and waits in the queue until an executor with that label is free." }
  - { name: Kubernetes Pod agents, track: kubernetes, role: "The Kubernetes plugin starts a fresh Pod per build from a Pod template mapped to a label, so no workspace or cache leaks between builds." }
  - { name: Credentials store, track: jenkins, role: "Secrets stored in Jenkins, masked in logs and bound to environment variables only for the stage that needs them." }
flow:
  - A push reaches Git; a webhook or polling (pollSCM) starts the multibranch job for that branch.
  - The controller reads the branch's Jenkinsfile, loads the shared library at its pinned version and queues each stage for an agent with the requested label.
  - Agents run the stages — independent checks in parallel when executors are free — each with a timeout so a hanging step cannot hold an executor for ever.
  - Stages that deploy or push get their credential bound for that stage only, and only on main; the shell receives a single-quoted command so the secret never becomes part of the command text.
  - Test results are published with junit and chosen artifacts archived in post always, so reports exist even when tests fail; the build image is pushed and, on main, deployed.
trade_offs:
  - { choice: "Self-hosted Jenkins instead of a hosted CI service", gain: "CI runs inside your own network with full control, a large plugin ecosystem and access to on-premise systems.", cost: "You operate, patch and secure the server and its plugins yourself; most Jenkins security advisories concern plugins." }
  - { choice: "Configuration as Code with pinned plugins", gain: "The controller is reproducible, reviewable and disposable.", cost: "Changes clicked in the UI are undone by the next reload, and JCasC does not recreate build history or stored credentials, which still need backups." }
  - { choice: "Disposable container or Pod agents", gain: "Clean environments for every build, no tool versions colliding on one machine and no state carried between builds.", cost: "Agent images and Pod templates must be kept small, specific and up to date, and the Docker hosts or cluster become part of the CI system." }
  - { choice: "A shared library for common stages", gain: "Fixes and improvements reach every pipeline from one place.", cost: "Global libraries run outside the sandbox with elevated trust, so they must be reviewed like Jenkins configuration and their default version pinned to a tag." }
failure_modes:
  - { failure: "Builds run on the controller", effect: "A malicious or buggy build can reach everything Jenkins knows, including every credential.", mitigation: "Set the built-in node's executors to 0 and run every stage on an agent." }
  - { failure: "Jenkins is exposed to the internet with unpatched plugins", effect: "Publicly reachable, unpatched Jenkins servers are a common target.", mitigation: "Pin and update plugins after reading advisories, put Jenkins behind single sign-on, a VPN or at least TLS, and grant least-privilege permissions." }
  - { failure: "Builds wait in the queue for ever", effect: "Nothing runs, although capacity seems to exist.", mitigation: "Check the queue's reason: often a misspelt label or too few executors with the right label; size executors from how often builds arrive and how long they take." }
  - { failure: "A secret is interpolated into a double-quoted command", effect: "It appears in the process list or can be used for shell injection.", mitigation: "Bind credentials to environment variables and pass the shell a literal, single-quoted command." }
  - { failure: "The JENKINS_HOME volume is lost", effect: "Jobs' history and stored credentials are gone; configuration as code recreates only the configuration.", mitigation: "Keep JENKINS_HOME on a volume and back it up." }
alternatives:
  - { instead_of: "Jenkins", consider: "GitHub Actions (see Continuous delivery to Kubernetes)", when: "Your code is on GitHub and you want CI with no server to run, plus a large marketplace of reusable actions." }
  - { instead_of: "Jenkins", consider: "Buildkite", when: "You want a hosted control plane while builds run on your own machines, for example for security or special hardware." }
  - { instead_of: "Jenkins", consider: "Tekton", when: "You already run Kubernetes and want pipelines as Kubernetes resources, built into a platform." }
decision_prompts:
  - Why must CI run on your own infrastructure, and who will patch Jenkins and its plugins, and how often?
  - Which labels do your agents offer, and how many executors per label does your build queue need?
  - Which credentials exist, which stages and branches may use them, and how are they kept out of logs?
  - If the controller were deleted today, how would you rebuild it, and what would be lost?
  - Which steps belong in the shared library, and how do teams move to a new version of it?
learn_more:
  - { kind: lesson, id: jenkins-agents-and-labels }
  - { kind: lesson, id: jenkins-configuration-as-code }
  - { kind: lesson, id: jenkins-securing-jenkins }
  - { kind: lab, id: jenkins-labels-and-executors }
  - { kind: lab, id: jenkins-store-credentials-safely }
  - { kind: project, id: jenkins-container-pipeline }
capstones: []
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when CI has to run inside your own network — next to on-premise systems, on special hardware or for
security reasons — or when you need Jenkins' flexibility and plugin ecosystem. With many similar services, a shared
library keeps each service's Jenkinsfile a few lines long.

If your code is on GitHub and nothing forces CI onto your own machines, GitHub Actions gives you CI with no server to
operate — see Continuous delivery to Kubernetes. Running Jenkins means patching it: if nobody will read the plugin
security advisories and update the pinned versions, do not run one.

## How it works

The controller is the brain and holds the keys, so it does no work. It schedules builds and hands every stage to an
agent chosen by label; disposable agents — containers, or a fresh Kubernetes Pod per build — mean a build cannot
leave anything behind for the next one, and a compromised build does not run where the credentials live.

The second idea is that nothing about the server is configured by hand. The image pins the Jenkins release and every
plugin, Configuration as Code sets security, executors and jobs, the pipelines are Jenkinsfiles in the repositories
they build, and shared steps come from a versioned library. Rebuilding the controller is then a matter of building
and starting the image; only build history and stored credentials, kept in the backed-up JENKINS_HOME, are state.
