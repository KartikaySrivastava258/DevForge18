"""Weekly library report — first attempt."""
import csv
import glob
from collections import Counter
from datetime import datetime

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"


@dag(schedule="@weekly", start_date=datetime(2026, 2, 2))
def weekly_library_report():
    @task
    def build_report():
        loans = Counter()
        for path in glob.glob(f"{DATA}/loans/*.csv"):
            with open(path, newline="") as f:
                for row in csv.DictReader(f):
                    loans[row["title"]] += 1
        lines = ["# Library report", f"Total loans: {sum(loans.values())}"]
        lines += [f"{t} ({n})" for t, n in loans.most_common(5)]
        with open(f"{DATA}/reports/latest.md", "w") as f:
            f.write("\n".join(lines) + "\n")

    build_report()


weekly_library_report()
