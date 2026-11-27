"""Publishes each day's exam marks to the warehouse — first attempt, no checks at all."""
import os
import shutil
from datetime import datetime

from airflow.sdk import dag, task

DATA = "/opt/airflow/data"


@dag(schedule="@daily", start_date=datetime(2026, 3, 1), catchup=False)
def marks_quality():
    @task
    def publish(ds=None):
        os.makedirs(f"{DATA}/warehouse/marks", exist_ok=True)
        shutil.copyfile(f"{DATA}/incoming/marks_{ds}.csv", f"{DATA}/warehouse/marks/{ds}.csv")

    publish()


marks_quality()
