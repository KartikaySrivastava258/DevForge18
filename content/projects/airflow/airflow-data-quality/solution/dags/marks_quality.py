"""Write–audit–publish for exam marks: row checks with quarantine, dataset checks, then an atomic publish."""
import csv
import glob
import json
import os
import re
from datetime import datetime

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"
COURSES = {"CS101", "CS201", "MA102", "HS110"}
MAX_INVALID_SHARE = 0.05
MIN_VOLUME_SHARE = 0.5


def row_problem(row):
    if not re.fullmatch(r"S\d{5}", row.get("student_id") or ""):
        return "student_id must be S followed by five digits"
    if row.get("course") not in COURSES:
        return "unknown course"
    mark = row.get("mark") or ""
    if not re.fullmatch(r"\d{1,3}", mark) or int(mark) > 100:
        return "mark must be a whole number from 0 to 100"
    return None


def write_csv(path, fieldnames, rows):
    """Write to a temporary name, then rename: readers see the old file or the complete new one."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(path + ".tmp", path)


@dag(schedule="@daily", start_date=datetime(2026, 3, 1), catchup=False, max_active_runs=1, tags=["quality"])
def marks_quality():
    @task
    def validate_rows(ds=None):
        """Write: split the day's upload into staged valid rows and quarantined invalid rows."""
        with open(f"{DATA}/incoming/marks_{ds}.csv", newline="") as f:
            reader = csv.DictReader(f)
            fields, rows = reader.fieldnames, list(reader)
        valid, bad = [], []
        for row in rows:
            problem = row_problem(row)
            if problem:
                bad.append({**row, "reason": problem})
            else:
                valid.append(row)
        write_csv(f"{DATA}/staging/{ds}.csv", fields, valid)
        write_csv(f"{DATA}/quarantine/{ds}.csv", fields + ["reason"], bad)
        return {"rows_in": len(rows), "rows_valid": len(valid), "rows_quarantined": len(bad)}

    @task
    def audit(counts, ds=None):
        """Audit: dataset checks on the staged rows. Writes the quality report; fails the run if a check fails."""
        with open(f"{DATA}/staging/{ds}.csv", newline="") as f:
            staged = list(csv.DictReader(f))
        seen, duplicates = set(), 0
        for row in staged:
            key = (row["student_id"], row["course"])
            duplicates += key in seen
            seen.add(key)
        earlier = sorted(p for p in glob.glob(f"{DATA}/warehouse/marks/*.csv") if os.path.basename(p)[:-4] < ds)
        previous_rows = None
        if earlier:
            with open(earlier[-1], newline="") as f:
                previous_rows = sum(1 for _ in csv.DictReader(f))
        failures = []
        if counts["rows_in"] and counts["rows_quarantined"] / counts["rows_in"] > MAX_INVALID_SHARE:
            failures.append(f"{counts['rows_quarantined']} of {counts['rows_in']} rows are invalid (more than 5%)")
        if duplicates:
            failures.append(f"{duplicates} duplicate student and course rows")
        if previous_rows is not None and counts["rows_valid"] < MIN_VOLUME_SHARE * previous_rows:
            failures.append(f"only {counts['rows_valid']} valid rows, less than half of the last published day ({previous_rows})")
        report = {**counts, "duplicates": duplicates, "previous_rows": previous_rows, "passed": not failures, "failures": failures}
        os.makedirs(f"{DATA}/quality", exist_ok=True)
        with open(f"{DATA}/quality/{ds}.json", "w") as f:
            json.dump(report, f, indent=2)
        alert = f"{DATA}/alerts/{ds}.txt"
        if failures:
            os.makedirs(f"{DATA}/alerts", exist_ok=True)
            with open(alert, "w") as f:
                f.write("\n".join(failures) + "\n")
            raise ValueError("; ".join(failures))   # publish does not run; the run is failed
        if os.path.exists(alert):                    # a rerun that now passes clears the old alert
            os.remove(alert)
        return report

    @task
    def publish(report, ds=None):
        """Publish: copy the audited staging file into the warehouse, atomically."""
        with open(f"{DATA}/staging/{ds}.csv", newline="") as f:
            reader = csv.DictReader(f)
            fields, rows = reader.fieldnames, list(reader)
        write_csv(f"{DATA}/warehouse/marks/{ds}.csv", fields, rows)

    publish(audit(validate_rows()))


marks_quality()
