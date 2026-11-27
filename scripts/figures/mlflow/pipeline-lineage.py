"""Figure for mlflow-reproducible-pipelines-with-airflow; run: python3 scripts/figures/mlflow/pipeline-lineage.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Pipeline and lineage, from Reproducible training pipelines with Airflow.")
f.box(10, 30, 330, 150, "f-box-faint"); f.text(175, 52, "Airflow run (ds = 2026-01-15)", "f-small f-strong", fit=320)
f.box(25, 70, 140, 90, "f-box-accent"); f.text(95, 96, "prepare", "f-small f-strong f-mono"); f.text(95, 120, "seeded split", "f-small"); f.text(95, 140, "→ data/<ds>/", "f-small f-mono")
f.box(185, 70, 140, 90, "f-box-accent"); f.text(255, 96, "train", "f-small f-strong f-mono"); f.text(255, 120, "fixed params", "f-small"); f.text(255, 140, "log + register", "f-small")
f.arrow([(167, 115), (183, 115)])
f.box(400, 30, 310, 150, "f-box-ok"); f.text(555, 52, "MLflow run", "f-small f-strong")
f.text(555, 78, "rmse · alpha · random_state", "f-small f-mono", fit=300); f.text(555, 102, "tag airflow.run_id", "f-small f-mono", fit=300)
f.text(555, 124, "tag data.sha256 · code.sha256", "f-small f-mono", fit=300); f.text(555, 148, "model → registered version", "f-small", fit=300)
f.arrow([(327, 115), (398, 115)])
f.box(10, 220, 700, 70, "f-box-faint")
f.text(360, 244, "re-run, same inputs → same rmse, same hashes (reproducible)", "f-small", fit=680)
f.text(360, 268, "change code (alpha) → new code hash, new rmse, new model version (traceable)", "f-small", fit=680)
write(ROOT, "mlflow", "pipeline-lineage", f,
      "An Airflow run for ds 2026-01-15 has two tasks: prepare makes a seeded split and writes it to a folder for the date; train fits the model with fixed parameters, logs it and registers it. The resulting MLflow run holds the rmse metric, the alpha and random_state parameters, tags for the Airflow run ID, the data hash and the code hash, and the model, registered as a version. Re-running with the same inputs gives the same rmse and the same hashes, so the result is reproducible; changing the code, here alpha, gives a new code hash, a new rmse and a new model version, so the change is traceable.",
      "Fixed inputs make reruns identical; lineage tags tie every model version to its data, code and Airflow run.")
