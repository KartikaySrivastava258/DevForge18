"""Reference architecture: model training, registry and serving; run: python3 scripts/figures/architecture/ml-training-and-serving.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 330, "Reference architecture: model training, registry and serving.")
# Airflow training DAG
f.box(10, 20, 250, 110, "f-box-faint"); f.text(135, 40, "Airflow training DAG", "f-small f-strong", fit=230)
f.box(25, 52, 100, 65, "f-box"); f.text(75, 78, "prepare", "f-small f-strong", fit=90); f.text(75, 96, "seeded split", "f-small", fit=90)
f.box(145, 52, 100, 65, "f-box"); f.text(195, 78, "train", "f-small f-strong", fit=90); f.text(195, 96, "pinned image", "f-small", fit=90)
f.arrow([(127, 85), (143, 85)])
# MLflow server and its stores
f.box(300, 30, 150, 90, "f-box-accent"); f.text(375, 60, "MLflow server", "f-small f-strong", fit=140); f.text(375, 80, "runs, metrics,", "f-small", fit=140); f.text(375, 96, "lineage tags", "f-small", fit=140)
f.arrow([(262, 80), (298, 75)])
f.box(285, 170, 95, 55, "f-box-ok"); f.text(332, 194, "PostgreSQL", "f-small f-strong", fit=90); f.text(332, 212, "runs, registry", "f-small", fit=90)
f.box(390, 170, 80, 55, "f-box-ok"); f.text(430, 194, "artifacts", "f-small f-strong", fit=75); f.text(430, 212, "model files", "f-small", fit=75)
f.arrow([(350, 122), (335, 168)]); f.arrow([(410, 122), (428, 168)])
# Registry and gate
f.box(500, 30, 120, 90, "f-box"); f.text(560, 60, "Registry", "f-small f-strong", fit=110); f.text(560, 80, "versions 1..n", "f-small", fit=110); f.text(560, 96, "@champion", "f-small f-mono", fit=110)
f.arrow([(452, 75), (498, 75)])
f.box(500, 170, 120, 55, "f-box-warn"); f.text(560, 194, "gate", "f-small f-strong", fit=110); f.text(560, 212, "beats champion?", "f-small", fit=110)
f.arrow([(560, 168), (560, 122)]); f.text(595, 150, "moves alias", "f-small f-muted", fit=80)
# Serving on Kubernetes and monitoring
f.box(650, 30, 100, 90, "f-box-accent"); f.text(700, 60, "Model server", "f-small f-strong", fit=95); f.text(700, 80, "Kubernetes,", "f-small", fit=95); f.text(700, 96, "loads alias", "f-small", fit=95)
f.arrow([(622, 75), (648, 75)])
f.box(650, 170, 100, 55, "f-box-ok"); f.text(700, 194, "monitoring", "f-small f-strong", fit=95); f.text(700, 212, "latency, drift", "f-small", fit=95)
f.arrow([(700, 122), (700, 168)])
# Retraining loop
f.arrow([(700, 227), (700, 262), (75, 262), (75, 119)])
f.text(390, 282, "drift alert: investigate, then retrain through the same pipeline", "f-small f-muted", fit=480)
f.text(380, 318, "every run records its Airflow run, data hash, code hash and image", "f-small", fit=560)
write(ROOT, "architecture", "ml-training-and-serving", f,
      "An Airflow training DAG runs a prepare task, which makes a seeded split of the run date's data, and a train task in a pinned image. Training logs runs, metrics and lineage tags to the MLflow server, which keeps runs and the registry in PostgreSQL and model files in an artifact store, and registers each model as a new version in the registry. A gate checks whether the new version beats the champion and, if so, moves the champion alias. A model server on Kubernetes loads the version the alias points to and sends latency and drift data to monitoring. A drift alert leads to investigation and retraining through the same pipeline. Every run records its Airflow run, data hash, code hash and image.",
      "The champion alias is the only way into production; every version can be traced to its data and code.")
