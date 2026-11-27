"""Figure for mlflow-tracking-server-and-stores; run: python3 scripts/figures/mlflow/tracking-stores.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "The tracking server's two stores, from The tracking server and its stores in depth.")
f.box(10, 110, 190, 80, "f-box-faint"); f.text(105, 136, "clients", "f-small f-strong"); f.text(105, 158, "training jobs, CI,", "f-small", fit=180); f.text(105, 176, "notebooks", "f-small")
f.box(260, 110, 200, 80, "f-box-accent"); f.text(360, 136, "tracking server", "f-small f-strong"); f.text(360, 158, "REST API + UI", "f-small"); f.text(360, 176, "stateless", "f-small")
f.arrow([(202, 150), (258, 150)]); f.text(230, 138, "URL only", "f-small")
f.box(520, 30, 190, 90, "f-box-ok"); f.text(615, 56, "backend store", "f-small f-strong"); f.text(615, 80, "PostgreSQL", "f-small f-mono"); f.text(615, 100, "runs · params · metrics", "f-small", fit=180)
f.box(520, 180, 190, 90, "f-box-ok"); f.text(615, 206, "artifact store", "f-small f-strong"); f.text(615, 230, "folder / s3:// bucket", "f-small f-mono", fit=180); f.text(615, 250, "files · models", "f-small")
f.arrow([(462, 135), (518, 85)]); f.arrow([(462, 165), (518, 215)])
f.text(360, 290, "default: sqlite:///mlflow.db + ./mlartifacts inside the server — lost with the container", "f-small f-danger", fit=700)
write(ROOT, "mlflow", "tracking-stores", f,
      "Clients such as training jobs, CI and notebooks know only the tracking server's URL. The tracking server, which serves the REST API and UI and keeps no state of its own, writes run metadata, parameters and metrics to the backend store, a PostgreSQL database, and files and models to the artifact store, a folder or s3 bucket, proxying uploads for the clients. By default both are a SQLite file mlflow.db and an mlartifacts folder inside the server, which are lost with its container.",
      "Metadata goes to a database, files to an artifact store; clients only talk to the server.")
