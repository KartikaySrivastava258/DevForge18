---
id: capstone-e
letter: E
title: MLOps experiment platform
summary: A small MLOps platform for a student-support model — tracked experiments, a reproducible training pipeline, a registry with a promotion rule, a served model on Kubernetes, and monitoring that notices when the world changes.
level: advanced
estimated_hours: 70
tracks: [git-github, postgresql, docker, mlflow, airflow, kubernetes, prometheus-grafana]
architecture: media:capstones/capstone-e-architecture.svg
user_stories:
  - As an academic advisor, I want risk predictions from a model that was checked against a baseline so that I offer support where it helps.
  - As a data scientist, I want every experiment tracked with its data and settings so that I can reproduce and compare any result.
  - As a platform engineer, I want a model replaced in production only through the registry so that every deployment is traceable and reversible.
  - As an on-call engineer, I want an alert when inputs drift away from the training data so that a silently degrading model is caught early.
milestones:
  - id: experiments
    title: Tracked, honest experiments
    goal: Track every training run in MLflow against a PostgreSQL backend store — parameters, metrics on held-out data, the model and a data card — and compare models against a baseline.
    deliverables:
      - An MLflow server with a PostgreSQL backend and proxied artifacts.
      - An experiment with a baseline and several models.
    acceptance:
      - Every logged metric can be recomputed from the logged model and the test split.
      - Rerunning training gives identical metrics.
      - The server's data survives replacing its container.
    reuses:
      - { kind: project, id: mlflow-student-experiment }
      - { kind: lesson, id: mlflow-tracking-server-and-stores }
      - { kind: project, id: mlflow-model-comparison }
  - id: pipeline
    title: A reproducible training pipeline
    goal: Retrain on a schedule with Airflow — prepare, train, evaluate — with data hashes and Airflow ids recorded on every run, pinned images, and promotion only when a model is better.
    deliverables:
      - The training DAG and its Docker image.
      - A promotion rule recorded on each run.
    acceptance:
      - Rerunning a night reproduces the same data hash and metrics.
      - A worse model is not registered; a better one moves the champion alias.
    reuses:
      - { kind: project, id: mlflow-airflow-pipeline }
      - { kind: lab, id: mlflow-gated-promotion }
      - { kind: lesson, id: airflow-idempotent-etl }
  - id: serving
    title: Serving the champion on Kubernetes
    goal: Serve the champion model as an API on a local Kubernetes cluster with two replicas, probes, resource limits and a signature that rejects malformed input.
    deliverables:
      - Serving image, manifests and a rollout and rollback procedure based on moving the alias.
    acceptance:
      - A request missing a feature gets a clear 400, not a wrong prediction.
      - Moving the champion alias and restarting the deployment switches models with no failed requests; moving it back rolls back.
      - Deleting a pod causes no failed requests.
    reuses:
      - { kind: lesson, id: mlflow-serving-and-monitoring }
      - { kind: lab, id: kubernetes-self-healing-and-rollouts }
      - { kind: lab, id: mlflow-choose-and-promote-a-champion }
  - id: monitoring
    title: Monitoring a model, not just a server
    goal: Expose latency, errors and prediction volume, compute an input-drift score against the training data, and alert on both with tested rules.
    deliverables:
      - Metrics, a drift job, alert rules with unit tests and a Grafana dashboard.
    acceptance:
      - Shifted input traffic raises the drift alert; normal traffic does not.
      - The dashboard shows which model version is serving.
    reuses:
      - { kind: project, id: prom-slo-dashboard }
      - { kind: project, id: prom-resource-monitoring }
  - id: delivery
    title: Changes through pull requests
    goal: Keep code, configuration and pipeline definitions in Git, review every change, and let CI build images, run tests and the training pipeline on a sample.
    deliverables:
      - CI that builds pinned images, runs unit tests and a smoke training run.
      - A model card in the repository updated with every promoted model.
    acceptance:
      - Every promoted model links to the commit and the pull request that produced it.
      - A failing smoke run blocks the merge.
    reuses:
      - { kind: project, id: git-release-workflow }
      - { kind: project, id: docker-notes-api }
rubric:
  - { criterion: "Experimental rigour", excellent: "Baselines, held-out data used once, honest metrics recomputed in tests, and a model card that states limits and fairness checks.", good: "Tracked experiments with a baseline.", needs_work: "Metrics on training data, or no baseline." }
  - { criterion: "Reproducibility and lineage", excellent: "Any served model traces to commit, data hash, image digest and Airflow run; reruns match exactly.", good: "Runs record their data and code version.", needs_work: "Results that cannot be reproduced." }
  - { criterion: "Deployment safety", excellent: "Promotion rule, signature, probes, limits and alias-based rollback rehearsed and documented.", good: "The champion is served and can be rolled back.", needs_work: "Models copied to the server by hand." }
  - { criterion: "Monitoring", excellent: "Service and model metrics, a drift score with a justified threshold, tested alerts and a retraining runbook.", good: "Dashboards and a drift alert.", needs_work: "Only container health is monitored." }
  - { criterion: "Responsible use", excellent: "Synthetic or approved data only, a clear statement of what the model must not be used for, and a human in the loop for decisions about students.", good: "The data source and limits are stated.", needs_work: "Predictions presented as decisions." }
stretch_goals:
  - Add a shadow deployment that scores live traffic with the candidate model before promotion.
  - Compute fairness metrics across groups in the synthetic data and add them to the promotion rule.
  - Replace the drift threshold with a statistical test and compare false alarms.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The academic office wants an early-warning model that suggests which students might benefit from support — and
wants it run like a product, not like a notebook. Build the platform around it: experiments tracked and
reproducible, training retrained on a schedule, a registry that decides what is served, a model API that rejects
bad input, and monitoring that notices both a broken server and a slowly changing world.

Use synthetic data (as in the MLflow projects) or properly approved, anonymised data, and keep a person in the
loop: the model suggests, advisors decide.

## Architecture

Everything a model depends on — code, configuration, data, image — is versioned and recorded on its MLflow run.
The registry's `champion` alias is the only way a model reaches production; moving it (and restarting the
deployment) is both the release and the rollback. Monitoring covers the service (latency, errors) and the model
(prediction volume, input drift).

Record your main decisions — the promotion rule, the drift threshold, retraining frequency — as architecture
decision records.

## Getting started

1. Run the MLflow server with a PostgreSQL backend first, then reproduce the beginner MLflow project against it.
2. Build the pipeline, then serving, then monitoring; at each step write the test that proves the guarantee.
3. Keep a small sample dataset in the repository so CI can run a full smoke training.
4. Present a promotion, a rollback and a drift alert live, with the run, the registry and the dashboard on screen.
