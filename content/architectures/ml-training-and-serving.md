---
id: ml-training-and-serving
title: Model training, registry and serving
summary: An Airflow pipeline prepares a date's data and trains a model with fixed seeds and pinned libraries, logging everything to an MLflow tracking server backed by PostgreSQL; a gate promotes a better version by moving the registry's champion alias, and a model server on Kubernetes loads the champion and is monitored for errors, latency and input drift.
problem: A model must move from experiments to a served API so that every version can be traced to its code and data, only better models reach production, a bad promotion can be undone quickly, and changes in the incoming data are noticed.
tracks: [mlflow, airflow, kubernetes, postgresql]
diagram: media:architecture/ml-training-and-serving.svg
components:
  - { name: Training pipeline, track: airflow, role: "A DAG whose prepare task splits the run date's data with a fixed seed and returns the folder and a hash of the training file, and whose train task fits the model and logs it; it runs in an image with pinned library versions." }
  - { name: MLflow tracking server, track: mlflow, role: "Records every run — parameters, metrics, the model with its signature, and tags such as the Airflow DAG and run IDs and the hashes of data and code." }
  - { name: Backend and artifact stores, track: postgresql, role: "PostgreSQL holds runs and the model registry; an artifact store (a folder or a bucket) holds model files. Both live outside the server's container and are backed up together." }
  - { name: Model registry, track: mlflow, role: "Gives the model a name with numbered versions; the champion alias points at the one version that serves." }
  - { name: Promotion gate, role: "Evaluates the candidate and the current champion on the same held-out data, moves the alias only for an improvement, and writes the decision onto the version." }
  - { name: Model server, track: kubernetes, role: "Loads models:/<name>@champion and rejects requests that break the signature with HTTP 400; runs as a Deployment with replicas, probes and resource limits." }
  - { name: Monitoring, role: "Logs inputs and predictions and tracks latency, errors and prediction volume per model version, plus an input-drift score against the training data." }
flow:
  - On schedule, Airflow's prepare task writes the run date's split (with a fixed seed) and returns its folder and data hash.
  - The train task fits the model with fixed hyperparameters and logs parameters, metrics, lineage tags and the model with a signature to MLflow, registering a new version.
  - The gate compares the new version with the champion on the same held-out data and moves the champion alias only if the new one is better, failing the pipeline otherwise.
  - The model server's Deployment is restarted (a rolling update on Kubernetes) and loads the version the alias now points to.
  - Monitoring watches latency, errors and drift; a drift alert leads to investigation against real outcomes and, if needed, retraining through the same pipeline.
trade_offs:
  - { choice: "Promotion and rollback by moving an alias", gain: "Neither needs a code change; rolling back is moving the alias back.", cost: "Running servers keep what they loaded, so every alias move must be followed by a deliberate restart or reload." }
  - { choice: "Pinned images, fixed seeds and data written per run date", gain: "Clearing an Airflow run reproduces the metric exactly, and a change in code or data shows up as a different hash.", cost: "Library upgrades become deliberate changes, and data must be kept per date (or per snapshot) for as long as runs may need reproducing." }
  - { choice: "A shared tracking server with PostgreSQL and an artifact store", gain: "The team shares runs and the registry, and both survive container restarts.", cost: "Two stores to back up together, a database schema to upgrade (mlflow db upgrade) when a newer MLflow needs it, and authentication to set up before opening it to the network." }
  - { choice: "An automated promotion gate", gain: "Promotion becomes a repeatable step whose decision is recorded on the version.", cost: "It is only as good as its evaluation: candidate and champion must be compared on data neither was chosen with." }
failure_modes:
  - { failure: "A model is logged and served without a signature", effect: "A missing or renamed column produces silent garbage instead of an error.", mitigation: "Log every model with a signature; the server then rejects malformed requests with HTTP 400." }
  - { failure: "The tracking database or the artifact store is lost", effect: "Runs and registry versions disappear, or runs point at artifacts that no longer exist.", mitigation: "Keep both stores outside the container and back them up together." }
  - { failure: "The alias is moved but the server is not reloaded", effect: "The old model keeps serving, and a rollback appears done when it is not.", mitigation: "Treat the alias move and the restart as one release step, and check which version is loaded." }
  - { failure: "The incoming data drifts away from the training data", effect: "Prediction quality can degrade while latency and errors look healthy.", mitigation: "Compare input distributions with the training data (for example with the population stability index), alert on the score, and confirm with real outcomes before retraining." }
  - { failure: "Memory limits are set far below real use", effect: "Model server containers are OOMKilled again and again.", mitigation: "Measure memory first, then set requests and limits from it." }
alternatives:
  - { instead_of: "Self-hosted MLflow tracking and registry", consider: "Weights & Biases", when: "You want a hosted tracker with rich dashboards and collaboration and are comfortable with a vendor service." }
  - { instead_of: "Airflow and MLflow on a cluster", consider: "Kubeflow", when: "The organisation runs Kubernetes and wants pipelines, training and serving as cluster-native components." }
  - { instead_of: "Running the platform yourself", consider: "A cloud ML platform such as Amazon SageMaker", when: "The organisation is committed to one cloud and wants training, tracking and serving managed in one place." }
decision_prompts:
  - What rule decides that a candidate may replace the champion, and on which data is it evaluated?
  - How do you roll back, and how long does it take from the decision until the old model is serving again?
  - Which drift score and threshold raise an alert, and what does the team do when it fires?
  - Could someone reproduce last month's champion from what its run records — data, code, image and seeds?
  - Who may move the champion alias, and where is each move recorded?
learn_more:
  - { kind: lesson, id: mlflow-models-and-registry }
  - { kind: lesson, id: mlflow-reproducible-pipelines-with-airflow }
  - { kind: lesson, id: mlflow-serving-and-monitoring }
  - { kind: lesson, id: mlflow-tracking-server-and-stores }
  - { kind: lab, id: mlflow-gated-promotion }
  - { kind: project, id: mlflow-airflow-pipeline }
capstones: [capstone-e]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when a model is retrained regularly and its predictions are served to other systems or people, so
that "which model is running, and why that one?" must always have an answer. It turns a notebook result into a
product step by step: tracked runs first, then a reproducible pipeline, then a registry that decides what serves,
then monitoring.

A team that mainly needs experiment tracking needs only the first piece — a tracking server with proper stores;
the pipeline, gate and served model belong to the moment a model's predictions are used. Kubeflow or a cloud ML
platform are alternatives when an organisation already runs Kubernetes for everything or is committed to one cloud.

## How it works

The registry's `champion` alias is the only way a model reaches production. Serving code always loads
`models:/<name>@champion`, never a file path or a version number, so promotion and rollback are both "move the alias,
then restart the server". The gate in front of that move compares the candidate with the current champion on the
same held-out data and records its decision on the version.

Every version can be explained because its run records everything it depended on: the Airflow run that produced it,
a hash of its training data, a hash of the pipeline code and the pinned image it ran in. Re-running the same Airflow
run reproduces the same metric; a different hash points at what changed. Monitoring then covers both halves of the
system — the service (latency, errors) and the model (prediction volume, input drift).
