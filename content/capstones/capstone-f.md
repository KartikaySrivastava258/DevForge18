---
id: capstone-f
letter: F
title: Automated software delivery platform
summary: The path every change takes from a work item to production — reviewed pull requests, CI that builds and attests one image, environments defined in Terraform, rolling deployments to Kubernetes with approval and automatic rollback, and monitoring that decides whether a release stays.
level: advanced
estimated_hours: 70
tracks: [git-github, jira, docker, github-actions, jenkins, terraform, kubernetes, prometheus-grafana, opentelemetry]
architecture: media:capstones/capstone-f-architecture.svg
user_stories:
  - As a developer, I want every pull request built and tested automatically so that I learn about a mistake in minutes, not after a release.
  - As a release manager, I want production to receive exactly the image that was tested and approved so that "it worked in staging" means something.
  - As an on-call engineer, I want a bad release rolled back automatically when it is not ready so that users barely notice.
  - As a team lead, I want every deployment traceable to a work item, a commit and a review so that we can answer what changed and why.
milestones:
  - id: workflow
    title: From work item to reviewed pull request
    goal: Run the team's work through Jira and GitHub — work item keys in branches and commits, protected main, pull request templates and required reviews.
    deliverables:
      - A Jira project and a repository with branch protection and a pull request template.
      - A check that refuses commits without a work item key.
    acceptance:
      - No change reaches main without a reviewed pull request and green checks.
      - Every commit on main names a work item.
    reuses:
      - { kind: project, id: git-team-task-tracker }
      - { kind: project, id: jira-release-triage }
      - { kind: lab, id: jira-enforce-work-item-keys }
  - id: ci
    title: Build once, test everywhere
    goal: Build, test and scan the service on every pull request in GitHub Actions — with a version matrix, pinned actions and least-privilege permissions — and produce one attested image per release; build the same pipeline in Jenkins and compare.
    deliverables:
      - CI workflows with a matrix, a reusable test workflow and an attested image build.
      - An equivalent Jenkinsfile and a short comparison of the two.
    acceptance:
      - Actions are pinned by commit SHA and jobs have only the permissions they need.
      - The release uses the image built and attested in CI; nothing is rebuilt later.
      - A failing test blocks the image from being pushed.
    reuses:
      - { kind: project, id: gha-node-matrix }
      - { kind: project, id: gha-release-pipeline }
      - { kind: project, id: jenkins-container-pipeline }
  - id: infrastructure
    title: Environments as code
    goal: Describe staging and production with Terraform modules, review every plan in the pull request, and keep the lock file and state handled safely.
    deliverables:
      - A reusable module and two environments that use it.
      - A CI job that runs fmt, validate and plan, and posts the plan for review.
    acceptance:
      - Applying the same configuration twice changes nothing.
      - No apply happens without a reviewed plan; drift is detected and reported.
    reuses:
      - { kind: project, id: tf-reusable-module }
      - { kind: project, id: tf-ci-repository }
      - { kind: lab, id: terraform-detect-drift }
  - id: deployment
    title: Safe deployments to Kubernetes
    goal: Deploy the attested image to staging and, after approval, to production with rolling updates, readiness gates, resource limits and an automatic rollback when a release does not become ready.
    deliverables:
      - Manifests with probes, requests and limits, and a deployment pipeline with an approval step.
      - A rehearsed rollback.
    acceptance:
      - A broken release never receives traffic and is rolled back without a person typing commands.
      - Deployments to production happen only after an approval that is recorded.
    reuses:
      - { kind: project, id: k8s-rolling-rollback }
      - { kind: project, id: k8s-probes-and-limits }
      - { kind: project, id: jenkins-k8s-deploy }
  - id: feedback
    title: Monitoring that decides
    goal: Mark deployments on dashboards, alert on SLO burn rates, and trace requests, so that the team can tell within minutes whether a release made things worse.
    deliverables:
      - Dashboards with deployment markers, SLO alerts with unit tests and tracing for the service.
      - A short post-release checklist that uses them.
    acceptance:
      - A release that raises the error rate is visible on the dashboard and triggers the burn-rate alert.
      - One trace explains a slow request introduced by a release.
    reuses:
      - { kind: project, id: prom-slo-dashboard }
      - { kind: project, id: otel-latency-investigation }
rubric:
  - { criterion: "Pipeline integrity", excellent: "One attested image travels unchanged from CI to production; every step is pinned, least-privilege and logged; the supply chain is explained in an ADR.", good: "CI builds, tests and deploys the same image.", needs_work: "Images rebuilt per environment, or mutable tags in production." }
  - { criterion: "Infrastructure as code", excellent: "Modules with validated inputs, reviewed plans, a committed lock file, drift detection and no manual changes.", good: "Environments are created and changed only through Terraform.", needs_work: "Manual changes in the console or cluster." }
  - { criterion: "Release safety", excellent: "Readiness gates, approvals, automatic rollback and a rehearsed incident; the team knows its change failure rate.", good: "Rollouts and rollbacks work.", needs_work: "Releases that can take the service down." }
  - { criterion: "Feedback", excellent: "SLOs, burn-rate alerts and traces drive release decisions, with markers that tie changes to their effects.", good: "Dashboards and alerts exist.", needs_work: "Problems are found by users." }
  - { criterion: "Traceability", excellent: "From any running image to its work item, commit, review, CI run and approval in a few clicks, documented for an auditor.", good: "Releases link to their pull requests.", needs_work: "Nobody can tell what is deployed." }
stretch_goals:
  - Add a canary step that sends a small share of traffic to the new release and promotes it only when its error rate matches the old one.
  - Measure the four delivery metrics (deployment frequency, lead time, change failure rate, time to restore) from the repository and the pipeline.
  - Replace the approval with a policy check that verifies the image's attestation before deploying.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Build the delivery platform for a small service: the path every change takes from a Jira work item to production,
with no shortcuts. A pull request is reviewed and tested; CI builds one image and attests it; Terraform defines the
environments; Kubernetes rolls the image out to staging and, after approval, to production, and rolls it back by
itself if it does not become ready; monitoring tells the team within minutes whether the release made things worse.

The service itself can be small — the mini-projects' REST API is enough. The capstone is about the platform: making
the safe path the easy path. The "team slice" of this capstone (milestones 1 and 2, done as a team) is the capstone
of the Engineering Team Workflow path.

## Architecture

The image built and attested in CI is the only artefact that moves; environments differ only in configuration,
which Terraform manages. Kubernetes gates traffic on readiness, so a broken release never serves users, and
monitoring closes the loop. Every step leaves a record — work item, commit, review, CI run, plan, approval — so any
deployment can be explained.

Record your main decisions — GitHub Actions or Jenkins, how approvals work, what triggers a rollback — as
architecture decision records.

## Getting started

1. Agree the workflow (milestone 1) on day one; every later change already goes through it.
2. Get one small change all the way to "production" in the first week, even if each step is basic, then harden each
   step.
3. Rehearse failure: a failing test, a broken image, a bad Terraform change, a release that raises the error rate.
4. Present a change from work item to production, then a broken release that rolls itself back.
