# Nightly training pipeline

Every night a new cohort's data arrives and the student-score model is retrained. Training must be
**reproducible** (the same night's run gives the same model and metrics, however often it is rerun), every
model must be **traceable** to the exact data and Airflow run that produced it, and a new model may replace the
champion **only if it is better**. Build the DAG `student_model_training` in `dags/training.py`
(`dags/students.py` generates the data; do not change it). The MLflow tracking server comes from the standard
`MLFLOW_TRACKING_URI` environment variable; the `Dockerfile` builds the Airflow image with the pinned MLflow
client and scikit-learn.

Tasks, in this order:

1. **`prepare_data`** — for the run's logical date `ds`, generate the cohort with
   `make_students(n=600, seed=<the date as the number YYYYMMDD>)`, write it to `/opt/airflow/data/students_<ds>.csv`,
   and pass on the file's path and its SHA-256 hash.
2. **`train`** — read that file, split it with `train_test_split(…, test_size=0.25, random_state=42)`, fit a
   `RandomForestRegressor(n_estimators=100, max_depth=6, random_state=42)`, and log one MLflow run in the
   experiment **`student-pipeline`** with: the parameter `data_sha256`, the tags `airflow_dag_id`, `airflow_run_id`
   and `logical_date`, the metric `rmse` on the test split, and the model (logged as `model`).
3. **`evaluate_and_promote`** — register the run's model as **`student-pipeline-model`** and move the alias
   **`champion`** to it only if there is no champion yet or its `rmse` is strictly lower than the current champion's.
   Record the decision on the run as the tag `promotion` = `promoted` or `kept`. A model that is not promoted must
   not be registered.
