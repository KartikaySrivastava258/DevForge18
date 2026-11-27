"""Writes comparison.md from the runs of the experiment "student-performance" and keeps the registered model
"student-score" with the alias "champion" pointing at the best run's model.
Run: MLFLOW_TRACKING_URI=http://localhost:5000 python compare.py"""
import mlflow
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

EXPERIMENT, MODEL_NAME, ALIAS = "student-performance", "student-score", "champion"
client = MlflowClient()
experiment = client.get_experiment_by_name(EXPERIMENT)
runs = client.search_runs(
    [experiment.experiment_id],
    # Only finished runs on the agreed dataset: a crashed run's metrics or another dataset's are not comparable.
    filter_string="tags.dataset = 'synthetic-v1' and attributes.status = 'FINISHED'",
    max_results=5000,
) if experiment else []

complete = [r for r in runs if "rmse" in r.data.metrics and r.data.params.get("model")]
incomplete = sorted(r.info.run_name for r in runs if r not in complete)
best_per_model = {}
for r in complete:
    name = r.data.params["model"]
    if name not in best_per_model or r.data.metrics["rmse"] < best_per_model[name].data.metrics["rmse"]:
        best_per_model[name] = r
rows = sorted(best_per_model.values(), key=lambda r: r.data.metrics["rmse"])

lines = [f"# Model comparison: {EXPERIMENT}", "## Best run per model", "| model | run | rmse | r2 |", "|---|---|---|---|"]
for r in rows:
    m = r.data.metrics
    lines.append(f"| {r.data.params['model']} | {r.info.run_name} | {m['rmse']:.3f} | {m.get('r2', float('nan')):.3f} |")
lines.append("## Champion")
baseline = best_per_model.get("baseline")
champion = rows[0] if rows and baseline and rows[0].data.params["model"] != "baseline" else None
if champion:
    b, c = baseline.data.metrics["rmse"], champion.data.metrics["rmse"]
    lines.append(f"{champion.data.params['model']} ({champion.info.run_name}), rmse {c:.3f} — {100 * (b - c) / b:.1f}% lower than the baseline")
else:
    lines.append("No model beats the baseline")
lines.append("## Incomplete runs")
lines += [f"- {name}" for name in incomplete] or ["- none"]
with open("comparison.md", "w") as f:
    f.write("\n".join(lines) + "\n")

if champion:
    try:
        current = client.get_model_version_by_alias(MODEL_NAME, ALIAS)
    except MlflowException:
        current = None
    if current is None or current.run_id != champion.info.run_id:   # register only when the champion changes
        version = mlflow.register_model(f"runs:/{champion.info.run_id}/model", MODEL_NAME)
        client.set_registered_model_alias(MODEL_NAME, ALIAS, version.version)
print("\n".join(lines))
