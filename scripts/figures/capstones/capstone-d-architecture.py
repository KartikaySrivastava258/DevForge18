"""Architecture of Capstone D (data pipeline); run: python3 scripts/figures/capstones/capstone-d-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 380, "Capstone D architecture: streams and files in, audited tables out.")
f.box(20, 30, 150, 60, "f-box"); f.text(95, 57, "badge, library,", "f-small", fit=140); f.text(95, 75, "canteen events", "f-small", fit=140)
f.box(220, 30, 130, 60, "f-box-warn"); f.text(285, 57, "Kafka", "f-small f-strong", fit=120); f.text(285, 75, "raw event topics", "f-small", fit=120)
f.arrow([(172, 60), (218, 60)])
f.box(20, 130, 150, 60, "f-box"); f.text(95, 157, "daily CSV exports", "f-small", fit=140); f.text(95, 175, "(marks, loans)", "f-small", fit=140)
f.box(400, 20, 160, 80, "f-box"); f.text(480, 50, "landing consumer", "f-small f-strong", fit=150); f.text(480, 70, "events → raw tables", "f-small", fit=150); f.text(480, 86, "(idempotent)", "f-small", fit=150)
f.arrow([(352, 60), (398, 60)])
f.box(220, 120, 340, 100, "f-box-accent"); f.text(390, 145, "Airflow DAGs (daily, backfillable)", "f-small f-strong", fit=330)
f.text(390, 168, "stage → audit (quality checks) → publish", "f-small", fit=330); f.text(390, 188, "quarantine bad rows, alert on failures", "f-small", fit=330)
f.text(390, 206, "logical dates, retries, idempotent loads", "f-small", fit=330)
f.arrow([(172, 160), (218, 165)]); f.arrow([(480, 102), (480, 118)])
f.box(610, 110, 130, 120, "f-box-ok"); f.text(675, 140, "PostgreSQL", "f-small f-strong", fit=120); f.text(675, 162, "raw, staging,", "f-small", fit=120); f.text(675, 180, "warehouse schemas,", "f-small", fit=120); f.text(675, 198, "indexes, views", "f-small", fit=120)
f.arrow([(562, 170), (608, 170)])
f.box(220, 260, 340, 60, "f-box"); f.text(390, 285, "reports and dashboards read only", "f-small", fit=330); f.text(390, 303, "published tables (read-only role)", "f-small", fit=330)
f.arrow([(675, 232), (562, 285)])
f.box(20, 260, 170, 100, "f-box"); f.text(105, 290, "Prometheus +", "f-small f-strong", fit=160); f.text(105, 308, "Grafana: freshness,", "f-small", fit=160); f.text(105, 326, "failed runs, lag,", "f-small", fit=160); f.text(105, 344, "rows quarantined", "f-small", fit=160)
f.box(610, 260, 130, 100, "f-box"); f.text(675, 290, "Docker Compose", "f-small f-strong", fit=120); f.text(675, 308, "the whole", "f-small", fit=120); f.text(675, 326, "platform, one", "f-small", fit=120); f.text(675, 344, "command", "f-small", fit=120)
write(ROOT, "capstones", "capstone-d-architecture", f,
      "Badge, library and canteen events flow into raw Kafka topics, from which an idempotent landing consumer writes raw tables. Daily CSV exports of marks and loans arrive as files. Airflow DAGs, daily and backfillable, stage the data, audit it with quality checks, quarantine bad rows, alert on failures and publish to PostgreSQL, which holds raw, staging and warehouse schemas with indexes and views. Reports and dashboards read only published tables through a read-only role. Prometheus and Grafana watch freshness, failed runs, consumer lag and quarantined rows. Docker Compose runs the whole platform with one command.",
      "Data reaches the reports only through stage, audit and publish; everything can be rerun for any past day.")
