---
id: mlflow-model-comparison
track: mlflow
title: Model comparison dashboard
level: intermediate
estimated_hours: 5
prerequisites: [mlflow-comparing-runs, mlflow-models-and-registry]
related_tracks: []
user_stories:
  - As an academic advisor, I want one page that shows the best run of each model and how much better than guessing the champion is so that I understand the result without opening MLflow.
  - As a member of the serving team, I want the best model registered under a fixed name and alias so that I deploy "student-score@champion" instead of a run ID someone pasted into a chat.
  - As an ML engineer, I want crashed runs and runs on other data left out of the comparison so that a broken experiment can never become the champion.
acceptance_criteria:
  - compare.py considers only finished runs of student-performance tagged dataset = synthetic-v1, and lists those without an rmse as incomplete.
  - comparison.md shows the best run per model, sorted by rmse, the champion with its improvement over the baseline, and the incomplete runs, exactly in the specified format.
  - The champion's model is registered as student-score and the alias champion points at it; running compare.py again registers nothing new.
  - When a better run appears, a new version is registered and the alias moves to it.
  - When no model beats the baseline, the page says so and nothing is registered.
rubric:
  - { criterion: "Querying runs", excellent: "Filtering is done in search_runs (filter_string on tags and status), with paging understood, and the README explains why failed runs and other datasets are excluded.", good: "Correct runs selected.", needs_work: "Everything compared, including crashed runs." }
  - { criterion: "The page", excellent: "Exact, readable, sorted output that answers the advisor's question in the first lines; numbers formatted consistently.", good: "Matches the specification.", needs_work: "A raw dump of run data." }
  - { criterion: "Registry use", excellent: "Aliases rather than stages, registration only when the champion changes, and a note on how serving picks up the new champion and how to roll back by moving the alias.", good: "Correct registration and alias.", needs_work: "A new version on every run, or no registration." }
hints:
  - 'client.search_runs([experiment_id], filter_string="tags.dataset = ''synthetic-v1'' and attributes.status = ''FINISHED''") does the filtering in MLflow.'
  - Group by the parameter model and keep the run with the lowest rmse per group; then sort those rows by rmse.
  - 'mlflow.register_model(f"runs:/{run_id}/model", "student-score") returns the new version; client.set_registered_model_alias(name, "champion", version) points the alias at it.'
  - 'Before registering, ask client.get_model_version_by_alias(name, "champion") which run the current champion came from (it raises an exception if there is no such alias yet).'
  - Compare your file with the README's example character by character — the check does.
stretch_goals:
  - Render the same comparison as an HTML page with a bar chart of rmse per model.
  - Add the champion's data card and parameters to the registered version's description.
  - Serve student-score@champion with mlflow models serve (see "Serving and monitoring models").
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

After a few weeks of experiments, the MLflow experiment `student-performance` holds dozens of runs: different
models and settings, a couple that crashed, some logged against another dataset, one that never recorded its
metric. The advisor wants a single page that says which model is best and by how much; the serving team wants the
best model registered under a stable name so they can deploy it without hunting for run IDs.

Write `compare.py`: it selects the comparable runs, writes the comparison page in a fixed format, and keeps the
Model Registry's `champion` alias on the best model — registering a new version only when the champion actually
changes. The README in the starter gives the exact page format.

## Getting started

1. Copy the starter. Reuse the tracking store from the beginner project (or run its `train.py` a few times with
   different settings) so there is something to compare.
2. Run it in the MLflow image, as before:

   ```bash
   MLFLOW_TRACKING_URI=http://localhost:5000 python compare.py && cat comparison.md
   ```

3. Check the registry in the UI (Models → student-score) after each run of `compare.py`.
4. Run the check, which builds its own stores with known runs:

   ```bash
   bash check.sh path/to/your/project
   ```
