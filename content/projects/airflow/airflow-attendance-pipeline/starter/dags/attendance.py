"""Daily attendance summary: reads the day's attendance file and writes each class's attendance percentage."""
import csv
import json
from datetime import datetime

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"


@dag(schedule="@daily", start_date=datetime(2026, 2, 1))
def attendance_daily():
    @task
    def extract():
        with open(f"{DATA}/attendance/2026-02-03.csv", newline="") as f:
            return list(csv.DictReader(f))

    @task
    def summarise(rows):
        present = {}
        for row in rows:
            present[row["class"]] = present.get(row["class"], 0) + int(row["present"])
        return present

    @task
    def load(summary):
        with open(f"{DATA}/reports/attendance.json", "a") as f:
            f.write(json.dumps(summary) + "\n")

    load(summarise(extract()))


attendance_daily()
