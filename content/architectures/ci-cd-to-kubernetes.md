---
id: ci-cd-to-kubernetes
title: Continuous delivery to Kubernetes
summary: Changes reach main only through reviewed pull requests with required checks; GitHub Actions then builds one image, pushes it and promotes that same digest through protected staging and production environments onto Kubernetes, whose cluster and cloud resources Terraform creates through reviewed plans.
problem: A team wants to ship several times a week without deploying untested code, rebuilding different bytes for each environment or keeping long-lived cloud keys in CI — and must be able to undo a bad release within minutes.
tracks: [git-github, github-actions, docker, kubernetes, terraform]
diagram: media:architecture/ci-cd-to-kubernetes.svg
components:
  - { name: Protected main branch, track: git-github, role: "Branch protection on the server requires a pull request with approvals and passing status checks for everyone, and blocks force pushes." }
  - { name: Pull request checks, track: github-actions, role: "A workflow runs tests on every pull request as a required check; pull requests build the image but never push it or receive write tokens." }
  - { name: Image build, track: docker, role: "Builds the image once from pinned base images, labels it with its source repository and commit, pushes it to a registry and outputs its digest." }
  - { name: Deployment workflow, track: github-actions, role: "Chains build, staging and production with needs, waits for each environment's protection rules, gets short-lived cloud credentials through OIDC, and queues deployments with one concurrency group per environment." }
  - { name: Kubernetes, track: kubernetes, role: "Runs the Deployment; readiness probes keep traffic away from Pods that are not ready, and a rolling update replaces Pods gradually and can be rolled back." }
  - { name: Terraform, track: terraform, role: "Creates the cluster, the database and the cloud identity roles from Git; each change is planned on a pull request, reviewed, and applied from the saved plan against remote, locked state." }
flow:
  - A developer opens a pull request; CI runs the tests and builds the image without pushing it, and branch protection blocks the merge until the checks pass and a reviewer approves.
  - On merge to main, the workflow builds the image once, tags it with the commit, pushes it and passes its digest to the next jobs.
  - The staging job sets the Deployment's image to that digest and waits with kubectl rollout status and a timeout; a stalled rollout fails the job.
  - The production job waits for the environment's required reviewers, then receives its secrets and OIDC credentials and deploys the same digest the same way.
  - If the rollout fails, or alerts show errors rising after it, the previous digest is deployed again (or the rollout is undone).
  - Infrastructure changes follow their own pull requests — terraform plan on the pull request, review of the plan, then apply of exactly that saved plan.
trade_offs:
  - { choice: "Build once and promote the same digest", gain: "Production runs exactly the bytes that were tested in staging, and rollback means redeploying a known digest.", cost: "Everything that differs between environments must come from outside the image — ConfigMaps, Secrets or environment variables." }
  - { choice: "Protected environments with required reviewers", gain: "Production secrets reach only jobs that passed approval, and GitHub records every deployment with its status.", cost: "Someone must be available to approve; on GitHub Free, Pro and Team plans, required reviewers and wait timers are available for public repositories only." }
  - { choice: "OIDC federation instead of stored cloud keys", gain: "No long-lived key to leak; credentials are short-lived and tied to the repository and environment.", cost: "The role's trust conditions must be exact — a wildcard in the subject trusts every repository and pull request in the organisation." }
  - { choice: "Terraform applied only from a reviewed, saved plan", gain: "Reviewers see exactly what will change, and Terraform refuses to apply a plan whose state has changed since.", cost: "Needs a remote backend with locking, and careful handling of plan files and state, which can contain secrets in plain text." }
failure_modes:
  - { failure: "The new image's Pods never become ready", effect: "Without probes and a rollout timeout, traffic reaches broken Pods or the release hangs unnoticed.", mitigation: "Readiness probes on every Deployment, kubectl rollout status with a timeout in the pipeline, and an automatic rollback when it fails." }
  - { failure: "A moving tag such as latest or main is deployed", effect: "Nobody can tell which version runs, nodes may pull different versions, and rollback has nothing to return to.", mitigation: "Deploy the digest (or at least an immutable commit tag) and keep the previous one recorded." }
  - { failure: "A third-party action changes or is compromised", effect: "Its code runs with the workflow's token and secrets.", mitigation: "Pin every action to a full commit SHA, let Dependabot propose updates, and set read-only default permissions with extra permissions per job." }
  - { failure: "Two deployments to one environment run at once, or one is cancelled half-way", effect: "The environment ends up in a state nobody chose.", mitigation: "One concurrency group per environment without cancel-in-progress, so deployments queue instead." }
alternatives:
  - { instead_of: "GitHub Actions", consider: "Jenkins", when: "You need full control on your own servers, a large plugin ecosystem or integration with on-premise systems, and will operate it (see Self-managed CI with Jenkins and build agents)." }
  - { instead_of: "Kubernetes", consider: "Google Cloud Run", when: "You run stateless HTTP services or jobs and want scaling handled for you, including scaling to zero." }
  - { instead_of: "Kubernetes", consider: "Docker Swarm mode", when: "You have a small cluster, already know Docker and Compose files, and want minimal extra setup." }
  - { instead_of: "Terraform", consider: "OpenTofu", when: "You want Terraform-style HCL workflows under an open-source licence with community governance." }
decision_prompts:
  - Which checks must pass before a pull request may merge, and who, if anyone, may bypass branch protection?
  - How is the previous digest found and redeployed during an incident, and when did the team last practise it?
  - Which settings differ between staging and production, and how do they reach the Pods without rebuilding the image?
  - What exactly must the OIDC token's audience and subject be for the production role to trust it?
  - Which signal decides that a rollout has failed — readiness, a rollout timeout or an alert — and who acts on it?
learn_more:
  - { kind: lesson, id: github-actions-environments-and-deployments }
  - { kind: lesson, id: github-actions-building-and-pushing-images }
  - { kind: lesson, id: kubernetes-services-and-rollouts }
  - { kind: lesson, id: terraform-in-ci-with-plan-review }
  - { kind: lab, id: github-actions-protected-deployment }
  - { kind: lab, id: kubernetes-self-healing-and-rollouts }
capstones: [capstone-a, capstone-e]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when a team already runs, or genuinely needs, Kubernetes, keeps its code on GitHub and wants every
change to reach production the same way: reviewed, tested, built once, tried in staging and approved. It suits
services that deploy often, where a quick, practised rollback matters more than a perfect release.

For one small application, a cluster may cost more to operate than it gives back; a managed service for stateless
containers, such as Cloud Run, may fit better. If CI must run inside your own network or on special hardware, see Self-managed
CI with Jenkins and build agents — the stages are the same, only the CI system changes.

## How it works

The pipeline builds the image exactly once and from then on refers to it only by its digest, which can never change.
Staging and production receive the same bytes; the only differences between them are configuration and the rules
that guard each environment. That is what makes a staging test meaningful and a rollback trivial: redeploying the
previous digest restores exactly what ran before.

Each step adds one guarantee. Branch protection makes review and tests a condition of merging. The production
environment releases its secrets and short-lived cloud credentials only to a job that a person approved. Kubernetes
replaces Pods gradually and sends traffic only to ready ones, and `kubectl rollout status` with a timeout turns a
release that never becomes ready into a failed job instead of a quiet outage. Terraform applies the same discipline
to the cluster and cloud resources underneath: plan, review, apply exactly what was reviewed.
