"""Reference architecture: batch data platform with quality gates; run: python3 scripts/figures/architecture/batch-data-platform.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 330, "Reference architecture: batch data platform with write-audit-publish.")
# Sources
f.box(10, 30, 130, 60, "f-box-accent"); f.text(75, 56, "Kafka", "f-small f-strong", fit=120); f.text(75, 74, "replayable events", "f-small", fit=120)
f.box(10, 130, 130, 60, "f-box"); f.text(75, 156, "daily files", "f-small f-strong", fit=120); f.text(75, 174, "one per day", "f-small", fit=120)
f.box(170, 40, 120, 60, "f-box"); f.text(230, 66, "raw tables", "f-small f-strong", fit=110); f.text(230, 84, "keyed landing", "f-small", fit=110)
f.arrow([(142, 62), (168, 68)])
# Airflow run for one logical date
f.box(320, 20, 425, 180, "f-box-faint"); f.text(532, 42, "Airflow DAG run for one logical date (ds)", "f-small f-strong", fit=400)
f.box(335, 60, 120, 75, "f-box"); f.text(395, 88, "write", "f-small f-strong", fit=110); f.text(395, 106, "replace ds", "f-small", fit=110); f.text(395, 122, "in staging", "f-small", fit=110)
f.box(475, 60, 120, 75, "f-box-warn"); f.text(535, 88, "audit", "f-small f-strong", fit=110); f.text(535, 106, "checks; fail", "f-small", fit=110); f.text(535, 122, "with a reason", "f-small", fit=110)
f.box(615, 60, 120, 75, "f-box"); f.text(675, 88, "publish", "f-small f-strong", fit=110); f.text(675, 106, "only if audit", "f-small", fit=110); f.text(675, 122, "passed", "f-small", fit=110)
f.arrow([(292, 75), (333, 85)]); f.arrow([(142, 160), (333, 115)])
f.arrow([(457, 97), (473, 97)]); f.arrow([(597, 97), (613, 97)])
f.text(420, 165, "retries, timeouts,", "f-small f-muted", fit=170); f.text(420, 181, "one transaction per step", "f-small f-muted", fit=170)
# Outputs
f.box(475, 230, 120, 55, "f-box-warn"); f.text(535, 254, "quarantine", "f-small f-strong", fit=110); f.text(535, 272, "rows + reason", "f-small", fit=110)
f.box(615, 230, 130, 55, "f-box-ok"); f.text(680, 254, "warehouse", "f-small f-strong", fit=120); f.text(680, 272, "reports read", "f-small", fit=120)
f.arrow([(535, 137), (535, 228)]); f.arrow([(675, 137), (675, 228)])
# Monitoring
f.box(10, 230, 210, 55, "f-box-ok"); f.text(115, 254, "Prometheus + Grafana", "f-small f-strong", fit=200); f.text(115, 272, "failed runs, lateness, lag", "f-small", fit=200)
f.text(380, 316, "raw, staging and warehouse are PostgreSQL schemas; backfills re-run past dates", "f-small", fit=600)
write(ROOT, "architecture", "batch-data-platform", f,
      "Kafka keeps a replayable log of events, which are landed into raw tables with keys. Daily files arrive alongside. An Airflow DAG run for one logical date (ds) then runs three steps: write replaces that date in staging from the raw tables and the day's file; audit checks the staged day and fails with a reason, sending invalid rows to quarantine; publish replaces the day in the warehouse that reports read, only if the audit passed. Steps use retries, timeouts and one transaction each. Prometheus and Grafana watch failed runs, lateness and consumer lag. Raw, staging and warehouse are PostgreSQL schemas, and backfills re-run the same DAG for past dates.",
      "Every step is keyed by the logical date, and nothing reaches the warehouse without passing its audit.")
