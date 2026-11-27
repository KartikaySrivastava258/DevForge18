"""Writes comparison.md from the runs of the experiment "student-performance" — first attempt."""
import mlflow

runs = mlflow.search_runs(experiment_names=["student-performance"])
best = runs.sort_values("metrics.rmse").iloc[0]
with open("comparison.md", "w") as f:
    f.write(f"Best run: {best['run_id']} rmse {best['metrics.rmse']}\n")
