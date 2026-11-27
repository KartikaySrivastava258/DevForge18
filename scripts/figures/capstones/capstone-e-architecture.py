"""Architecture of Capstone E (MLOps platform); run: python3 scripts/figures/capstones/capstone-e-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 380, "Capstone E architecture: from a commit to a monitored model.")
f.box(20, 30, 140, 70, "f-box"); f.text(90, 58, "Git repository", "f-small f-strong", fit=130); f.text(90, 78, "code, config, data", "f-small", fit=130)
f.box(200, 30, 170, 70, "f-box-accent"); f.text(285, 58, "Airflow training DAG", "f-small f-strong", fit=160); f.text(285, 78, "prepare, train, evaluate", "f-small", fit=160)
f.arrow([(162, 65), (198, 65)])
f.box(410, 20, 170, 90, "f-box-ok"); f.text(495, 48, "MLflow tracking", "f-small f-strong", fit=160); f.text(495, 68, "runs, params, metrics,", "f-small", fit=160); f.text(495, 86, "lineage tags", "f-small", fit=160)
f.arrow([(372, 65), (408, 65)])
f.box(620, 20, 120, 90, "f-box-ok"); f.text(680, 50, "PostgreSQL", "f-small f-strong", fit=110); f.text(680, 70, "MLflow backend", "f-small", fit=110); f.text(680, 88, "store", "f-small", fit=110)
f.arrow([(582, 65), (618, 65)])
f.box(410, 150, 170, 70, "f-box-warn"); f.text(495, 178, "Model Registry", "f-small f-strong", fit=160); f.text(495, 198, "alias: champion", "f-small f-mono", fit=160)
f.arrow([(495, 112), (495, 148)]); f.text(560, 135, "promote only if better", "f-small", fit=170)
f.box(20, 150, 340, 120, "f-box-faint"); f.text(250, 186, "Kubernetes (kind)", "f-small f-strong", fit=200)
f.box(40, 190, 140, 60, "f-box"); f.text(110, 216, "model API", "f-small f-strong", fit=130); f.text(110, 234, "2 replicas, probes", "f-small", fit=130)
f.box(200, 190, 140, 60, "f-box"); f.text(270, 216, "drift job", "f-small f-strong", fit=130); f.text(270, 234, "inputs vs training", "f-small", fit=130)
f.arrow([(408, 168), (110, 168), (110, 188)])
f.box(410, 260, 330, 90, "f-box"); f.text(575, 288, "Prometheus + Grafana: latency, errors,", "f-small", fit=320); f.text(575, 308, "predictions per minute, drift score;", "f-small", fit=320); f.text(575, 328, "alerts trigger retraining review", "f-small", fit=320)
f.arrow([(270, 252), (408, 300)])
f.box(20, 300, 340, 60, "f-box"); f.text(190, 324, "Docker images pinned by digest;", "f-small", fit=330); f.text(190, 342, "CI builds, tests and scans them", "f-small", fit=330)
write(ROOT, "capstones", "capstone-e-architecture", f,
      "Code, configuration and a data card live in a Git repository. An Airflow training DAG prepares data, trains and evaluates, logging runs, parameters, metrics and lineage tags to MLflow tracking, whose backend store is PostgreSQL. A model is registered and given the alias champion only if it is better. In a Kubernetes cluster, a model API with two replicas and probes serves the champion, and a drift job compares live inputs with the training data. Prometheus and Grafana track latency, errors, predictions per minute and the drift score, and alerts trigger a retraining review. Docker images are pinned by digest and built, tested and scanned in CI.",
      "Every served model can be traced back to its code, data and run, and is replaced only by a better one.")
