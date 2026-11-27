"""Figure for airflow-deployment-and-executors; run: python3 scripts/figures/airflow/components.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Airflow 3's components, from Deployment and executors.")
f.box(270, 130, 180, 60, "f-box-accent"); f.text(360, 156, "metadata database", "f-small f-strong", fit=170); f.text(360, 176, "PostgreSQL", "f-small")
f.box(10, 20, 200, 60, "f-box-faint"); f.text(110, 46, "API server", "f-small f-strong"); f.text(110, 66, "REST API · UI · execution API", "f-small", fit=190)
f.box(260, 20, 200, 60, "f-box-faint"); f.text(360, 46, "DAG processor", "f-small f-strong"); f.text(360, 66, "parses DAG files", "f-small", fit=190)
f.box(510, 20, 200, 60, "f-box-faint"); f.text(610, 46, "triggerer", "f-small f-strong"); f.text(610, 66, "deferred tasks", "f-small", fit=190)
f.box(10, 240, 260, 70, "f-box-ok"); f.text(140, 264, "scheduler + executor", "f-small f-strong", fit=250); f.text(140, 286, "creates runs, queues tasks", "f-small", fit=250)
f.box(330, 240, 380, 70, "f-box-faint"); f.text(520, 262, "where tasks run (executor):", "f-small f-strong", fit=370)
f.text(520, 284, "Local: processes beside the scheduler (parallelism)", "f-small", fit=370)
f.text(520, 302, "Celery: queue + workers · Kubernetes: a pod per task", "f-small", fit=370)
f.arrow([(110, 82), (300, 128)]); f.arrow([(360, 82), (360, 128)]); f.arrow([(610, 82), (420, 128)]); f.arrow([(140, 238), (300, 192)])
f.arrow([(272, 275), (328, 275)])
write(ROOT, "airflow", "components", f,
      "The metadata database, PostgreSQL, sits in the middle. The API server, which serves the REST API, the UI and the execution API, the DAG processor, which parses DAG files, and the triggerer, which runs deferred tasks, all use it, as does the scheduler with its executor, which creates runs and queues tasks. The executor decides where tasks run: the LocalExecutor runs processes beside the scheduler, limited by parallelism; the CeleryExecutor uses a queue and workers; the KubernetesExecutor starts a pod per task.",
      "Separate components share one metadata database; the executor, inside the scheduler, decides where tasks run.")
