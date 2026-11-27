"""Figure for mlflow-serving-and-monitoring; run: python3 scripts/figures/mlflow/serving-and-monitoring.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Serving, promotion and monitoring, from Serving and monitoring models.")
f.box(10, 30, 200, 100, "f-box-faint"); f.text(110, 54, "model registry", "f-small f-strong"); f.text(110, 80, "v1 ← @champion", "f-small f-mono"); f.text(110, 102, "v2 (challenger)", "f-small f-mono")
f.box(260, 30, 200, 100, "f-box-accent"); f.text(360, 54, "model server", "f-small f-strong"); f.text(360, 78, "resolves alias at load", "f-small", fit=190); f.text(360, 100, "/invocations · /ping", "f-small f-mono", fit=190)
f.arrow([(212, 80), (258, 80)])
f.box(510, 30, 200, 100, "f-box-ok"); f.text(610, 54, "clients", "f-small f-strong"); f.text(610, 78, "signature-checked", "f-small", fit=190); f.text(610, 100, "requests", "f-small")
f.arrow([(508, 80), (462, 80)])
f.box(260, 180, 200, 70, "f-box-faint"); f.text(360, 206, "prediction log", "f-small f-strong"); f.text(360, 228, "inputs + outputs", "f-small")
f.arrow([(360, 132), (360, 178)])
f.box(510, 180, 200, 70, "f-box-danger"); f.text(610, 206, "drift check", "f-small f-strong"); f.text(610, 228, "PSI vs training data", "f-small", fit=190)
f.arrow([(462, 215), (508, 215)])
f.text(360, 290, "promote / roll back = move the alias, then reload the server", "f-small f-strong", fit=700)
f.text(360, 314, "watch latency · errors · drift now; accuracy once outcomes arrive", "f-small", fit=700)
write(ROOT, "mlflow", "serving-and-monitoring", f,
      "The model registry holds version 1 with the champion alias and version 2 as a challenger. The model server resolves the alias when it loads and serves the invocations and ping endpoints; clients send requests that are checked against the model's signature. Every request and prediction goes to a prediction log, and a drift check compares the logged inputs with the training data using the population stability index. Promoting or rolling back means moving the alias and then reloading the server. Monitor latency, errors and drift now, and accuracy once true outcomes arrive.",
      "Aliases decide what is served after a reload; logged predictions feed drift and quality monitoring.")
