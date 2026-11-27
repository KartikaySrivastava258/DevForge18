"""Figure for airflow-idempotent-etl; run: python3 scripts/figures/airflow/idempotent-load.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "Append versus replace on re-run, from Building an idempotent ETL.")
f.text(130, 26, "run for 2026-01-02", "f-small f-strong", fit=240)
for i, label in enumerate(["first run", "re-run", "re-run, corrected file"]):
    y = 40 + i * 80
    f.box(10, y, 240, 60, "f-box-faint"); f.text(130, y + 26, label, "f-small f-strong", fit=230); f.text(130, y + 46, "ds = 2026-01-02", "f-small f-mono")
f.text(400, 26, "append (INSERT)", "f-small f-strong")
f.text(600, 26, "replace the day", "f-small f-strong")
rows = [("3 rows · 669", "3 rows · 669", "f-box-faint", "f-box-ok"),
        ("6 rows · 1338", "3 rows · 669", "f-box-danger", "f-box-ok"),
        ("8 rows · 1897", "2 rows · 559", "f-box-danger", "f-box-ok")]
for i, (a, b, ca, cb) in enumerate(rows):
    y = 40 + i * 80
    f.arrow([(252, y + 30), (308, y + 30)])
    f.box(310, y, 180, 60, ca); f.text(400, y + 36, a, "f-small f-mono")
    f.box(510, y, 180, 60, cb); f.text(600, y + 36, b, "f-small f-mono")
f.text(360, 290, "DELETE day = ds + INSERT, in one transaction: same input, same result, every time", "f-small", fit=700)
write(ROOT, "airflow", "idempotent-load", f,
      "Three runs for 2 January 2026, each with ds 2026-01-02: the first run, a re-run, and a re-run after the source file was corrected. The append load, using INSERT, holds 3 rows and revenue 669 after the first run, 6 rows and 1338 after the re-run, and 8 rows and 1897 after the corrected re-run. The load that replaces the day holds 3 rows and 669, then 3 rows and 669, then 2 rows and 559, matching the corrected source. Deleting the day and inserting in one transaction gives the same result for the same input every time.",
      "An append load drifts with every re-run; replacing the day's partition stays correct.")
