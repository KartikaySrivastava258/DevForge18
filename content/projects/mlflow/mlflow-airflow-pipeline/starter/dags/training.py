"""Nightly training of the student-score model — first attempt."""
from datetime import datetime

import mlflow
import mlflow.sklearn
import numpy as np
from airflow.sdk import dag, task
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import train_test_split

from students import FEATURES, TARGET, make_students


@dag(schedule="@daily", start_date=datetime(2026, 3, 1), catchup=False)
def student_model_training():
    @task
    def train():
        df = make_students(seed=np.random.randint(10_000))
        X_train, X_test, y_train, y_test = train_test_split(df[FEATURES], df[TARGET])
        model = RandomForestRegressor().fit(X_train, y_train)
        with mlflow.start_run():
            mlflow.log_metric("rmse", mean_squared_error(y_test, model.predict(X_test)) ** 0.5)
            mlflow.sklearn.log_model(model, name="model", registered_model_name="student-pipeline-model",
                                     skops_trusted_types=["sklearn.tree._tree.Tree"])

    train()


student_model_training()
