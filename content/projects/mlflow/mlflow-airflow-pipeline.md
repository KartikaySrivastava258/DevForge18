---
id: mlflow-airflow-pipeline
track: mlflow
title: Reproducible training pipeline coordinated by Airflow
level: advanced
estimated_hours: 8
prerequisites: [mlflow-reproducible-pipelines-with-airflow, mlflow-models-and-registry, airflow-idempotent-etl]
related_tracks: [airflow]
user_stories:
  - As an auditor, I want every model traceable to the exact data file and Airflow run that produced it so that I can explain any prediction months later.
  - As an ML engineer, I want rerunning a night's training to give exactly the same model so that a retry or a backfill never silently changes results.
  - As a serving engineer, I want the champion replaced only by a model that is measurably better so that a bad night's data cannot make production worse.
acceptance_criteria:
  - The DAG student_model_training loads with the tasks prepare_data → train → evaluate_and_promote.
  - Each DAG run logs one MLflow run in student-pipeline, with the SHA-256 of the exact data file it trained on and the tags airflow_dag_id, airflow_run_id and logical_date.
  - Rerunning the same logical date reproduces the same data hash and the same rmse.
  - A model is registered as student-pipeline-model and gets the alias champion only if there is no champion or its rmse is strictly lower; the decision is recorded as the tag promotion.
  - Models that are not promoted are not registered.
rubric:
  - { criterion: "Reproducibility", excellent: "Data, split and model are seeded from the logical date and constants; package versions are pinned in the image; the README shows the same rmse from two reruns.", good: "Reruns reproduce the metrics.", needs_work: "Random seeds or datetime.now() anywhere in the pipeline." }
  - { criterion: "Lineage", excellent: "Data hash, Airflow ids and logical date on every run, the data card or schema logged too, and the README shows how to go from a registered version back to its data file.", good: "The required parameters and tags are logged.", needs_work: "Runs that cannot be traced to their data." }
  - { criterion: "Promotion policy", excellent: "A clear, tested rule (strictly better on the same metric), the decision recorded on the run, and a note on what a fair comparison needs (the same test set, or an evaluation set kept fixed).", good: "Correct promotion and registration.", needs_work: "Every new model becomes the champion." }
  - { criterion: "DAG design", excellent: "Small tasks passing small values (a path and a hash, a run id), heavy imports inside tasks, no overlapping runs, and a README that explains each choice.", good: "Three tasks that work in order.", needs_work: "One task that does everything, or large data passed through XCom." }
hints:
  - 'Derive the seed from the logical date — int(ds.replace("-", "")) — so each night has its own cohort but a rerun regenerates exactly the same one.'
  - Pass small values between tasks — the file path and its SHA-256, then the MLflow run id — not the data itself.
  - 'Do not name a task argument run_id, ds or params unless you mean Airflow''s own value — those names are reserved for the task context. mlflow_run_id is a safe name.'
  - 'Register only after you have decided to promote. mlflow.register_model(f"runs:/{mlflow_run_id}/model", …) then client.set_registered_model_alias(…, "champion", version).'
  - Import mlflow and scikit-learn inside the task functions; the DAG processor parses the file often and should not import heavy libraries each time.
stretch_goals:
  - Evaluate every new model and the champion on a fixed evaluation set kept outside the nightly data, so the comparison is fair across nights.
  - Add a task that serves the champion with mlflow models serve and checks one prediction after promotion.
  - Alert (a failure callback, see the Airflow track) when three nights in a row are not promoted.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The student-score model is retrained every night on the newest cohort. The first version of the pipeline is a
single task with a random seed: rerun it and you get a different model, nobody can tell which data a model came
from, and every new model is registered — even when it is worse than the one in production.

Rebuild it as a three-task Airflow DAG that logs to an MLflow tracking server: prepare the night's data
deterministically and fingerprint it, train and log the run with full lineage, then promote the model only when it
beats the current champion. This is the minimum a team needs before it can trust an automated training pipeline.

The check builds the same Airflow image as the starter's `Dockerfile`, starts an MLflow server next to it, runs
the DAG for one night twice and for the next night once, and inspects the runs and the Model Registry.

## Getting started

1. Copy the starter. Build the image and start MLflow and Airflow on one network, as in "Reproducible training
   pipelines with Airflow":

   ```bash
   docker build -t airflow-ml:project .
   docker network create ml-project
   docker run -d --name mlflow --hostname mlflow --network ml-project -p 127.0.0.1:5051:5000 \
     ghcr.io/mlflow/mlflow:v3.18.0 mlflow server --host 0.0.0.0 --port 5000 --allowed-hosts "mlflow:5000,127.0.0.1:5051"
   docker run --rm -it --network ml-project --user "$(id -u):0" -e MLFLOW_TRACKING_URI=http://mlflow:5000 \
     -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/data:/opt/airflow/data" airflow-ml:project bash
   airflow db migrate && airflow dags test student_model_training 2026-03-02    # inside the container
   ```

2. Open MLflow at http://localhost:5051 and look at what the run recorded. Run the same day again and compare.
3. Split the work into the three tasks, add the lineage, then the promotion rule.
4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
