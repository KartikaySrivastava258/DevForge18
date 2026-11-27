"""Nightly training of the student-score model: reproducible, traceable to its data and Airflow run, and promoted
only when it beats the current champion."""
import hashlib
import os
from datetime import datetime

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"
EXPERIMENT, MODEL_NAME, ALIAS = "student-pipeline", "student-pipeline-model", "champion"


@dag(schedule="@daily", start_date=datetime(2026, 3, 1), catchup=False, max_active_runs=1, tags=["ml"])
def student_model_training():
    @task
    def prepare_data(ds=None):
        from students import make_students   # dags/ is on the import path

        # The seed comes from the logical date, so rerunning a night regenerates exactly that night's cohort.
        df = make_students(n=600, seed=int(ds.replace("-", "")))
        os.makedirs(DATA, exist_ok=True)
        path = f"{DATA}/students_{ds}.csv"
        df.to_csv(path, index=False)
        with open(path, "rb") as f:
            return {"path": path, "sha256": hashlib.sha256(f.read()).hexdigest()}

    @task
    def train(data, ds=None, dag_run=None):
        # Heavy imports inside the task: the DAG processor parses this file often and should stay fast.
        import mlflow
        import mlflow.sklearn
        import pandas as pd
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.metrics import mean_squared_error
        from sklearn.model_selection import train_test_split
        from students import FEATURES, TARGET

        df = pd.read_csv(data["path"])
        X_train, X_test, y_train, y_test = train_test_split(df[FEATURES], df[TARGET], test_size=0.25, random_state=42)
        model = RandomForestRegressor(n_estimators=100, max_depth=6, random_state=42).fit(X_train, y_train)
        mlflow.set_experiment(EXPERIMENT)
        with mlflow.start_run(run_name=f"nightly-{ds}") as run:
            mlflow.log_params({"data_sha256": data["sha256"], "n_estimators": 100, "max_depth": 6, "random_state": 42})
            mlflow.set_tags({"airflow_dag_id": dag_run.dag_id, "airflow_run_id": dag_run.run_id, "logical_date": ds})
            mlflow.log_metric("rmse", float(mean_squared_error(y_test, model.predict(X_test)) ** 0.5))
            mlflow.sklearn.log_model(model, name="model", skops_trusted_types=["sklearn.tree._tree.Tree"])
        return run.info.run_id

    @task
    def evaluate_and_promote(mlflow_run_id):
        # (Not "run_id": task arguments named like Airflow context keys — run_id, ds, params … — are reserved.)
        import mlflow
        from mlflow import MlflowClient
        from mlflow.exceptions import MlflowException

        client = MlflowClient()
        new_rmse = client.get_run(mlflow_run_id).data.metrics["rmse"]
        try:
            champion = client.get_model_version_by_alias(MODEL_NAME, ALIAS)
            champion_rmse = client.get_run(champion.run_id).data.metrics["rmse"]
        except MlflowException:
            champion_rmse = None
        if champion_rmse is None or new_rmse < champion_rmse:
            version = mlflow.register_model(f"runs:/{mlflow_run_id}/model", MODEL_NAME)
            client.set_registered_model_alias(MODEL_NAME, ALIAS, version.version)
            decision = "promoted"
        else:
            decision = "kept"          # not registered: the registry holds only models that were champions
        client.set_tag(mlflow_run_id, "promotion", decision)
        return decision

    evaluate_and_promote(train(prepare_data()))


student_model_training()
