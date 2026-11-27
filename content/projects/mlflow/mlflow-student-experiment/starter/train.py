"""Trains a model to predict final exam scores — first attempt."""
import mlflow
import numpy as np
from sklearn.tree import DecisionTreeRegressor

from data import FEATURES, TARGET, make_students

df = make_students(seed=np.random.randint(1000))
model = DecisionTreeRegressor().fit(df[FEATURES], df[TARGET])
rmse = float(np.sqrt(((model.predict(df[FEATURES]) - df[TARGET]) ** 2).mean()))
with mlflow.start_run():
    mlflow.log_metric("rmse", rmse)
print("rmse", rmse)
