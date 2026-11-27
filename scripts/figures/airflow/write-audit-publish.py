"""Figure for airflow-backfills-and-data-quality; run: python3 scripts/figures/airflow/write-audit-publish.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Write, audit, publish, from Backfills and data-quality checks.")
f.box(10, 40, 150, 70, "f-box-faint"); f.text(85, 66, "raw file", "f-small f-strong"); f.text(85, 90, "for ds", "f-small f-mono")
f.box(200, 40, 150, 70, "f-box-accent"); f.text(275, 66, "write", "f-small f-strong f-mono"); f.text(275, 90, "→ staging", "f-small")
f.box(390, 40, 150, 70, "f-box-accent"); f.text(465, 66, "audit", "f-small f-strong f-mono"); f.text(465, 90, "checks", "f-small")
f.box(580, 40, 130, 70, "f-box-ok"); f.text(645, 66, "publish", "f-small f-strong f-mono"); f.text(645, 90, "→ sales", "f-small")
f.arrow([(162, 75), (198, 75)]); f.arrow([(352, 75), (388, 75)]); f.arrow([(542, 75), (578, 75)])
f.box(390, 130, 320, 50, "f-box-danger"); f.text(550, 152, "check fails → AirflowFailException", "f-small", fit=310); f.text(550, 171, "publish = upstream_failed: bad day stays out", "f-small", fit=310)
f.arrow([(465, 112), (465, 128)])
f.text(360, 214, "backfill 1 → 4 Jan, reprocess none:   1 ✓   2 ✓   3 ✗   4 ✓", "f-small f-mono", fit=700)
f.text(360, 240, "fix the 3 Jan file, backfill again, reprocess failed:   only 3 Jan re-runs → ✓", "f-small f-mono", fit=700)
f.text(360, 272, "none: skip dates with runs · failed: re-run failed ones · completed: re-run all", "f-small", fit=700)
write(ROOT, "airflow", "write-audit-publish", f,
      "For each day, the raw file for ds is written to a staging table, audited with quality checks, and published to the sales table. If a check fails, the audit task raises AirflowFailException, publish becomes upstream_failed, and the bad day stays out of the sales table. A backfill from 1 to 4 January with reprocess behaviour none succeeds on 1, 2 and 4 January and fails on 3 January. After the 3 January file is fixed, a second backfill with reprocess behaviour failed re-runs only 3 January, which then succeeds. Reprocess behaviours: none skips dates that have runs, failed re-runs failed ones, completed re-runs all.",
      "Only audited data is published; a backfill with reprocess failed repairs just the failed days.")
