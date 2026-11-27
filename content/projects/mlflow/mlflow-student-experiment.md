---
id: mlflow-student-experiment
track: mlflow
title: Student performance prediction experiment using synthetic data
level: beginner
estimated_hours: 5
prerequisites: [mlflow-tracking-runs, mlflow-comparing-runs]
related_tracks: []
user_stories:
  - As an academic advisor, I want to know whether a model predicts final scores better than simply guessing the average so that I trust it before using it to offer support.
  - As a student data scientist, I want every training run recorded with its settings, metrics and model so that I can compare them later instead of copying numbers into a notebook.
  - As a reviewer, I want the experiment to give the same numbers when I rerun it so that I can check the conclusions myself.
acceptance_criteria:
  - train.py logs to the experiment student-performance one run per model — a baseline that predicts the mean and at least three real models.
  - Every run logs the parameters model and seed (42), the metrics rmse and r2, the tag dataset = synthetic-v1, the fitted model and a data_card.md.
  - Each logged rmse is the error of the logged model on the held-out test split (test_size 0.25, random_state 42).
  - The best real model has a lower rmse than the baseline.
  - Running train.py again gives exactly the same metrics.
rubric:
  - { criterion: "Experimental design", excellent: "A baseline, models of different kinds, a fixed held-out test set used once, and a README that states the question, the answer and its limits.", good: "Baseline and three models compared on test data.", needs_work: "Error measured on the training data, or no baseline." }
  - { criterion: "Tracking", excellent: "Runs are named, all hyperparameters are logged (get_params), the data card is honest about the synthetic data, and the comparison is done in the MLflow UI or API rather than by hand.", good: "Everything required is logged.", needs_work: "Numbers printed but not logged." }
  - { criterion: "Reproducibility", excellent: "Every random step is seeded from one constant, library versions are recorded, and a colleague gets identical numbers.", good: "Rerunning gives the same metrics.", needs_work: "Different results on every run." }
  - { criterion: "Responsible use", excellent: "The data card and README say clearly that the data is synthetic and the model must not be used on real students without a proper study.", good: "The data is labelled as synthetic.", needs_work: "Claims about real students from invented data." }
hints:
  - Start with the baseline (sklearn's DummyRegressor). Any model worth keeping must beat it.
  - Split once with train_test_split(…, test_size=0.25, random_state=42), fit on the training part only and compute rmse and r2 on the test part.
  - 'mlflow.log_params({"model": name, "seed": 42, **model.get_params()}) logs every hyperparameter in one call.'
  - "mlflow.log_text(text, \"data_card.md\") writes a small file as an artifact without creating it on disk first."
  - MLflow 3.18 saves scikit-learn models with skops, which refuses unknown types when loading. For tree models, pass skops_trusted_types=["sklearn.tree._tree.Tree"] to log_model — trust only the types you created yourself.
stretch_goals:
  - Add cross-validation on the training set to choose each model's hyperparameters, logging each candidate as a child run.
  - Log a plot of predicted against actual scores for the best model.
  - Register the best model in the Model Registry (see "Models, signatures and the registry").
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The academic office would like an early warning for students who may struggle in the final exam. Before anyone
uses real records, they want a careful experiment on **synthetic** data: which kind of model predicts the final
score best — and is it better at all than simply guessing the average?

The starter's training script is the kind of first attempt that leads to wrong conclusions: a different random
dataset on every run, the error measured on the data the model was trained on, and a single number logged with no
settings and no model. Turn it into an experiment tracked in MLflow that anyone can rerun and trust.

`data.py` generates the students; do not change it — the check regenerates the same data to verify your numbers.

## Getting started

1. Copy the starter folder. Run everything in the official MLflow image, which already contains scikit-learn and
   pandas:

   ```bash
   docker run --rm -it -v "$PWD:/w" -w /w -p 127.0.0.1:5050:5000 ghcr.io/mlflow/mlflow:v3.18.0 bash
   mlflow server --host 0.0.0.0 --port 5000 &          # inside the container
   MLFLOW_TRACKING_URI=http://localhost:5000 python train.py
   ```

   The MLflow UI is then at http://localhost:5050.
2. Add the baseline first, then the real models, and compare them in the UI.
3. Run the check — it runs `train.py` twice into fresh stores and reloads every logged model:

   ```bash
   bash check.sh path/to/your/project
   ```
