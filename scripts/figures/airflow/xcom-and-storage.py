"""Figure for airflow-passing-data-between-tasks; run: python3 scripts/figures/airflow/xcom-and-storage.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Where data travels between tasks, from Passing data between tasks.")
f.box(10, 40, 160, 70, "f-box-accent"); f.text(90, 68, "extract", "f-small f-strong f-mono"); f.text(90, 92, "writes 245 KB", "f-small")
f.box(280, 20, 160, 60, "f-box-faint"); f.text(360, 46, "data lake", "f-small f-strong"); f.text(360, 66, "orders-<run>.csv", "f-small f-mono", fit=150)
f.box(550, 40, 160, 70, "f-box-ok"); f.text(630, 68, "summarize", "f-small f-strong f-mono"); f.text(630, 92, "reads the file", "f-small")
f.arrow([(172, 60), (278, 50)]); f.arrow([(442, 50), (548, 60)])
f.box(250, 100, 220, 44, "f-box-faint"); f.text(360, 127, "XCom: the path (few bytes)", "f-small", fit=210)
f.arrow([(172, 95), (248, 120)]); f.arrow([(472, 120), (548, 95)])
f.box(10, 190, 300, 90, "f-box-faint"); f.text(160, 214, "metadata database", "f-small f-strong")
f.text(160, 238, "small XComs: counts, IDs, paths", "f-small", fit=290); f.text(160, 260, "large ones: only a reference", "f-small", fit=290)
f.box(410, 190, 300, 90, "f-box-faint"); f.text(560, 214, "XCom object store", "f-small f-strong")
f.text(560, 238, "values > threshold (4096 B here)", "f-small", fit=290); f.text(560, 260, "e.g. a 785 KB list of orders", "f-small", fit=290)
f.arrow([(312, 235), (408, 235)])
f.text(360, 306, "retries clear a failed task's XComs: they cannot carry progress", "f-small f-danger", fit=700)
write(ROOT, "airflow", "xcom-and-storage", f,
      "The extract task writes 245 KB of orders to a file in the data lake, named after the run, and passes only the file's path to the summarize task as an XCom of a few bytes; summarize reads the file. Below: small XComs such as counts, IDs and paths live in the metadata database; with the object-storage XCom backend, values above the threshold, 4096 bytes here, such as a 785 KB list of orders, are written to the XCom object store and the database keeps only a reference. Retries clear a failed task's XComs, so they cannot carry progress.",
      "Pass references between tasks; keep XComs small; large values belong in storage.")
