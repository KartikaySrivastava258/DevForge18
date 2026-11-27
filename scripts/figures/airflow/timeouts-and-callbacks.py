"""Figure for airflow-timeouts-and-callbacks; run: python3 scripts/figures/airflow/timeouts-and-callbacks.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Timeouts, retries and callbacks, from Timeouts and failure callbacks.")
f.text(360, 24, "task export: execution_timeout = 3 s, retries = 1", "f-small f-strong", fit=600)
f.box(10, 40, 180, 60, "f-box-danger"); f.text(100, 64, "try 1: 3 s", "f-small f-mono"); f.text(100, 86, "AirflowTaskTimeout", "f-small f-mono", fit=170)
f.arrow([(192, 70), (238, 70)]); f.text(215, 58, "retry", "f-small")
f.box(240, 40, 180, 60, "f-box-danger"); f.text(330, 64, "try 2: 3 s", "f-small f-mono"); f.text(330, 86, "AirflowTaskTimeout", "f-small f-mono", fit=170)
f.arrow([(422, 70), (468, 70)])
f.box(470, 40, 240, 60, "f-box-accent"); f.text(590, 64, "on_retry_callback (try 1)", "f-small f-mono", fit=230); f.text(590, 86, "on_failure_callback (try 2)", "f-small f-mono", fit=230)
f.text(360, 136, "task validate: retries = 3, raises AirflowFailException", "f-small f-strong", fit=600)
f.box(10, 150, 180, 50, "f-box-danger"); f.text(100, 180, "try 1: fails", "f-small f-mono")
f.arrow([(192, 175), (468, 175)]); f.text(330, 166, "no retries used", "f-small")
f.box(470, 150, 240, 50, "f-box-accent"); f.text(590, 180, "on_failure_callback", "f-small f-mono", fit=230)
f.text(360, 236, "DAG slow_report: dagrun_timeout = 10 s", "f-small f-strong", fit=600)
f.box(10, 250, 410, 50, "f-box-faint"); f.text(215, 280, "run failed at 10 s · running task build → skipped", "f-small", fit=400)
f.arrow([(422, 275), (468, 275)])
f.box(470, 250, 240, 50, "f-box-accent"); f.text(590, 274, "DAG on_failure_callback", "f-small f-mono", fit=230); f.text(590, 292, "reason = timed_out", "f-small f-mono", fit=230)
write(ROOT, "airflow", "timeouts-and-callbacks", f,
      "Three cases. Task export has execution_timeout 3 seconds and one retry: try 1 runs 3 seconds and raises AirflowTaskTimeout, triggering on_retry_callback; try 2 times out the same way and triggers on_failure_callback. Task validate has three retries but raises AirflowFailException, so it fails on try 1 without using any retries and triggers on_failure_callback. DAG slow_report has dagrun_timeout 10 seconds: the run fails at 10 seconds, the running task build is marked skipped, and the DAG-level on_failure_callback receives reason timed_out.",
      "execution_timeout bounds each attempt, dagrun_timeout the whole run; callbacks report what happened.")
