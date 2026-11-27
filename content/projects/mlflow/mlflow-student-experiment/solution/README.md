# Predicting final exam scores — an MLflow experiment

The academic office wants to know which students might need support before the final exam. Real records cannot
be used for a student project, so `data.py` generates **synthetic** students (do not change it). Your job is a
proper, reproducible experiment, tracked in MLflow, that answers: *which kind of model predicts the final score
best, and is it better than guessing the average?*

`train.py` (the tracking URI comes from the standard `MLFLOW_TRACKING_URI` environment variable) must:

1. Generate the data with `make_students(n=600, seed=42)` and split it with scikit-learn's
   `train_test_split(…, test_size=0.25, random_state=42)` — features are `FEATURES`, the target is `TARGET`.
2. Log every run to the experiment **`student-performance`**, one run per model:
   - `baseline` — a `DummyRegressor` that always predicts the training mean;
   - at least three real models, for example `ridge`, `decision_tree` and `random_forest`.
3. For every run log: the parameters `model` (the name above) and `seed` (42) plus the model's own
   hyperparameters; the metrics `rmse` and `r2` **on the test set**; the tag `dataset` = `synthetic-v1`; the
   fitted model with `mlflow.sklearn.log_model(…, name="model")`; and a file `data_card.md` describing the data
   (where it comes from, rows, features, target, and that it is synthetic).
4. Be reproducible: running `train.py` again gives exactly the same metrics.

The first attempt uses a random seed, measures the error on the data it trained on, and logs only that number.
