"""Weekly library report: the previous Monday-to-Sunday's loans, every Monday at 07:00."""
import csv
import os
import shutil
from collections import Counter
from datetime import date, datetime, timedelta

from airflow.sdk import Param, dag, task

DATA = "/opt/airflow/data"


@dag(
    schedule="0 7 * * 1",          # Mondays 07:00
    start_date=datetime(2026, 2, 2),
    catchup=False,
    max_active_runs=1,             # two runs never write the reports at the same time
    params={"top_n": Param(5, type="integer", minimum=1, maximum=20)},
    tags=["library"],
)
def weekly_library_report():
    @task
    def check_inputs(ds=None):
        """The seven days before the run's logical date, all of which must have a file."""
        monday = date.fromisoformat(ds)
        days = [(monday - timedelta(days=n)).isoformat() for n in range(7, 0, -1)]
        missing = [d for d in days if not os.path.exists(f"{DATA}/loans/{d}.csv")]
        if missing:
            raise FileNotFoundError(f"no loans file for {', '.join(missing)}")
        return days

    @task
    def build_report(days, params=None):
        loans = Counter()
        for day in days:
            with open(f"{DATA}/loans/{day}.csv", newline="") as f:
                for row in csv.DictReader(f):
                    loans[row["title"]] += 1
        top = sorted(loans.items(), key=lambda kv: (-kv[1], kv[0]))[: params["top_n"]]
        lines = [f"# Library report: {days[0]} to {days[-1]}", f"Total loans: {sum(loans.values())}", "## Top books"]
        lines += [f"{i}. {title} ({count})" for i, (title, count) in enumerate(top, 1)]
        return "\n".join(lines) + "\n"

    @task
    def write_report(text, ds=None):
        os.makedirs(f"{DATA}/reports", exist_ok=True)
        path = f"{DATA}/reports/library_{ds}.md"
        with open(path + ".tmp", "w") as f:
            f.write(text)
        os.replace(path + ".tmp", path)   # the dated report appears complete or not at all
        return path

    @task
    def publish(path):
        # Runs only if every earlier task succeeded, so a failed week never replaces the noticeboard.
        shutil.copyfile(path, f"{DATA}/reports/latest.md.tmp")
        os.replace(f"{DATA}/reports/latest.md.tmp", f"{DATA}/reports/latest.md")

    publish(write_report(build_report(check_inputs())))


weekly_library_report()
