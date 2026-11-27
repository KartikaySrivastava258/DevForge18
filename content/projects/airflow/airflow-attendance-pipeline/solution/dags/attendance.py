"""Daily attendance summary: reads the day's attendance file and writes each class's attendance percentage."""
import csv
import json
import os
from datetime import datetime, timedelta

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"


@dag(
    schedule="@daily",
    start_date=datetime(2026, 2, 1),
    catchup=False,            # switched on later, it does not run every missed day since 1 February
    tags=["attendance"],
    default_args={"retries": 2, "retry_delay": timedelta(minutes=5)},
)
def attendance_daily():
    @task
    def extract(ds=None):
        # ds is the run's logical date (YYYY-MM-DD): each run reads its own day's file, so a rerun or a
        # backfill of an old day reads that day's data, not today's.
        path = f"{DATA}/attendance/{ds}.csv"
        with open(path, newline="") as f:      # a missing file raises, so the task (and the run) fails
            return list(csv.DictReader(f))

    @task
    def summarise(rows):
        totals, present = {}, {}
        for row in rows:
            totals[row["class"]] = totals.get(row["class"], 0) + 1
            present[row["class"]] = present.get(row["class"], 0) + int(row["present"])
        return {c: round(100 * present[c] / totals[c], 1) for c in sorted(totals)}

    @task
    def load(summary, ds=None):
        os.makedirs(f"{DATA}/reports", exist_ok=True)
        # One file per day, written whole and then renamed into place: running the day again replaces it
        # with the same content instead of appending a second copy.
        final = f"{DATA}/reports/attendance_{ds}.json"
        with open(final + ".tmp", "w") as f:
            json.dump(summary, f, sort_keys=True)
        os.replace(final + ".tmp", final)

    load(summarise(extract()))


attendance_daily()
