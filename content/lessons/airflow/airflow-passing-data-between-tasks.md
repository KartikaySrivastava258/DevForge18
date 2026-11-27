---
id: airflow-passing-data-between-tasks
title: Passing data between tasks (and why XCom is for small values)
track: airflow
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [airflow-retries-and-failures]
starts_fresh: true
learning_objectives:
  - Pass small values between TaskFlow tasks as XComs, including several named values with multiple_outputs, and read them through the REST API.
  - Move large data through storage and pass only a reference (a path) between tasks, using ObjectStoragePath.
  - Configure the object-storage XCom backend so that large values are written to storage automatically, and explain its threshold.
  - Explain why XComs cannot hold progress across retries.
resources:
  - title: XComs (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/xcoms.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: XComs "are only designed for small amounts of data; do not use them to pass around large values, like dataframes"; multiple_outputs; XComs are cleared on every retry of a task that did not succeed; the object storage XCom backend.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Object Storage (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/objectstorage.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: ObjectStoragePath from airflow.sdk gives one path interface for local files, S3, GCS and others (built on fsspec); the connection ID can be part of the URL.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: apache-airflow-providers-common-io — configuration
    url: https://airflow.apache.org/docs/apache-airflow-providers-common-io/stable/configurations-ref.html
    publisher: Apache Software Foundation
    type: reference
    level: advanced
    official: true
    why: "[common.io] xcom_objectstorage_path and xcom_objectstorage_threshold: -1 keeps every XCom in the database, 0 stores all in object storage, a positive number stores values larger than that many bytes."
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: size
    prompt: A task produces a 200 MB table that the next task needs. What should it return?
    options:
      - { id: a, text: "The table itself — Airflow will pass it on" }
      - { id: b, text: "A reference: write the table to storage (a file, S3, a database table) and return its path; the next task reads it from there" }
      - { id: c, text: "Nothing — tasks cannot share data" }
    answer: b
    explanation: XComs live in the metadata database by default and are loaded whenever pulled; references keep them tiny.
  - id: backend
    prompt: With the object-storage XCom backend and a threshold of 4096 bytes, where does a 20-byte return value go? A 785 KB one?
    options:
      - { id: a, text: "Both go to object storage" }
      - { id: b, text: "The 20-byte value stays in the database; the 785 KB one is written to object storage and the database keeps only a reference" }
      - { id: c, text: "Both stay in the database" }
    answer: b
    explanation: The lab shows exactly one file in the XCom store — the large list — while small values stay in the database.
  - id: retry
    prompt: A load task pushes rows_done=5000 and then fails. On the retry it reads rows_done. What does it get?
    options:
      - { id: a, text: "5000" }
      - { id: b, text: "None — XComs of a task that did not succeed are cleared before each retry, so they cannot carry progress between attempts" }
      - { id: c, text: "An error" }
    answer: b
    explanation: Keep progress in the target system (for example, which rows already exist) — the idea behind the next lesson.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/airflow:slim-3.4.0-python3.12 image (pinned by digest, which includes apache-airflow-providers-common-io 1.11.0) running airflow standalone, starting from nothing, and its output is compared with this lesson. The order data is generated with a fixed random seed. Checked against the Airflow 3.4.0 and common-io provider documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Tasks pass values to each other as **XComs** — small records kept in Airflow's metadata database — so pass **counts, IDs and paths**, and move real data through **storage**, either explicitly (`ObjectStoragePath`) or with the **object-storage XCom backend** for values above a size threshold.

## Explain it like I'm twelve

When one class hands work to another, the teacher sends a **sticky note**: "the essays are in cupboard 3". Nobody staples all 30 essays to the note. XComs are the sticky notes; the cupboard is storage. If someone does staple a huge pile to a note, a careful school has a rule: anything thicker than a few pages goes into the cupboard automatically, and the note just says where.

## What problem it solves

Each task may run in a different process, container or machine, so tasks cannot share Python variables. Airflow passes return values between them through its metadata database — convenient for small values, harmful for large ones: big rows slow the database, and every task that pulls them loads them into memory. Knowing where data should travel keeps the database healthy and DAGs fast.

## How it works

![](media:airflow/xcom-and-storage.svg)

- A `@task` function's **return value** is pushed as an XCom with key `return_value`; passing it to another task (`summarize(extract())`) pulls it. `multiple_outputs=True` pushes each key of a returned dictionary as its own XCom too.
- XComs must be serialisable; they are stored in the metadata database by the default backend.
- **`ObjectStoragePath`** (`from airflow.sdk import ObjectStoragePath`) opens `file://`, `s3://`, `gs://` and other URLs with one interface; tasks exchange the path.
- The **object-storage XCom backend** (`XComObjectStorageBackend`, from the common-io provider) stores values larger than `xcom_objectstorage_threshold` bytes at `xcom_objectstorage_path` and keeps a reference in the database.
- **Retries clear XComs** of the failed task, so an attempt never sees what an earlier failed attempt pushed.

## Try it yourself

> **Local lab** — needs Docker. Airflow runs as `airflow standalone`, as in *DAGs, tasks and runs*, with two more shared folders: `data` (the lab's "data lake") and `xcom-store` (where the XCom backend puts large values). Every command is run automatically in DevForge's tests.

### 1. Three DAGs

```bash run
mkdir -p airflow-data/dags airflow-data/data airflow-data/xcom-store && cd airflow-data
cat > dags/orders_report.py <<'EOF'
import csv, random
from datetime import datetime
from airflow.sdk import ObjectStoragePath, dag, get_current_context, task

LAKE = ObjectStoragePath("file:///opt/airflow/data")   # on a real system: s3://conn_id@bucket/path

@dag(dag_id="orders_report", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def orders_report():
    @task
    def extract():
        rng = random.Random(42)                            # the same "orders" on every run
        run_id = get_current_context()["run_id"].replace(":", "-").replace("+", "-")
        path = LAKE / f"orders-{run_id}.csv"
        with path.open("w") as f:
            writer = csv.writer(f)
            writer.writerow(["order_id", "amount"])
            for i in range(20000):
                writer.writerow([f"o{i}", rng.randint(50, 5000)])
        return str(path)                                   # a reference, not the data

    @task(multiple_outputs=True)
    def summarize(path):
        with ObjectStoragePath(path).open() as f:
            amounts = [int(row["amount"]) for row in csv.DictReader(f)]
        return {"orders": len(amounts), "revenue": sum(amounts)}

    summarize(extract())

orders_report()
EOF
cat > dags/orders_in_xcom.py <<'EOF'
import random
from datetime import datetime
from airflow.sdk import dag, task

@dag(dag_id="orders_in_xcom", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def orders_in_xcom():
    @task
    def extract_everything():                              # the anti-pattern: 20,000 orders as one XCom
        rng = random.Random(42)
        return [{"order_id": f"o{i}", "amount": rng.randint(50, 5000)} for i in range(20000)]

    @task
    def count(orders):
        return len(orders)

    count(extract_everything())

orders_in_xcom()
EOF
cat > dags/flaky_progress.py <<'EOF'
from datetime import datetime, timedelta
from airflow.sdk import dag, get_current_context, task

@dag(dag_id="flaky_progress", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def flaky_progress():
    @task(retries=1, retry_delay=timedelta(seconds=1))
    def load():
        ti = get_current_context()["ti"]
        earlier = ti.xcom_pull(task_ids="load", key="rows_done")   # what an earlier attempt pushed
        ti.xcom_push(key="rows_done", value=5000)
        if ti.try_number == 1:
            raise RuntimeError("connection reset after 5000 rows")
        return f"try {ti.try_number} saw rows_done={earlier}"
    load()

flaky_progress()
EOF
python3 -m py_compile dags/*.py && echo "three DAG files are valid Python"
```

```text output
three DAG files are valid Python
```

### 2. Start Airflow with the object-storage XCom backend

```bash run
IMAGE=apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-airflow --user "$(id -u):0" -p 127.0.0.1:8095:8080 \
  -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/data:/opt/airflow/data" -v "$PWD/xcom-store:/opt/airflow/xcom-store" \
  -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -e AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION=False \
  -e AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL=5 \
  -e AIRFLOW__CORE__XCOM_BACKEND=airflow.providers.common.io.xcom.backend.XComObjectStorageBackend \
  -e AIRFLOW__COMMON_IO__XCOM_OBJECTSTORAGE_PATH=file:///opt/airflow/xcom-store \
  -e AIRFLOW__COMMON_IO__XCOM_OBJECTSTORAGE_THRESHOLD=4096 \
  "$IMAGE" standalone > /dev/null
AF=http://127.0.0.1:8095
for i in $(seq 1 180); do curl -sf -o /dev/null "$AF/api/v2/monitor/health" && break; sleep 1; done
for i in $(seq 1 60); do docker exec devforge-airflow test -f /opt/airflow/simple_auth_manager_passwords.json.generated && break; sleep 1; done
password=$(docker exec devforge-airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
for dag in orders_report orders_in_xcom flaky_progress; do
  for i in $(seq 1 60); do af "$AF/api/v2/dags/$dag" | grep '"dag_id"' > /dev/null && break; sleep 1; done
done
af "$AF/api/v2/importErrors" | grep -o '"total_entries":[0-9]*'
docker exec devforge-airflow airflow config get-value core xcom_backend
```

```text output
"total_entries":0
airflow.providers.common.io.xcom.backend.XComObjectStorageBackend
```

The three `AIRFLOW__…` variables at the end switch on the object-storage backend: values larger than 4096 bytes go to `/opt/airflow/xcom-store` (the shared `xcom-store` folder); smaller ones stay in the database. On a real deployment the path would be a bucket, such as `s3://aws_default@my-bucket/xcom`. The container runs as your own user ID (`--user "$(id -u):0"`; the image accepts any user ID as long as the group is 0), so the files Airflow writes into the shared folders belong to you and you can edit or delete them.

### 3. Pass a reference, not the data

```bash run
run_dag() {
  local dag=$1 run state
  run=$(af -X POST -H 'Content-Type: application/json' -d '{"logical_date": null}' "$AF/api/v2/dags/$dag/dagRuns" \
    | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4)
  for i in $(seq 1 180); do
    state=$(af "$AF/api/v2/dags/$dag/dagRuns/$run" | grep -o '"state":"[a-z_]*"' | head -n 1 | cut -d'"' -f4)
    [ "$state" = success ] || [ "$state" = failed ] && break
    sleep 1
  done
  echo "$run"
}
xcom() { af "$AF/api/v2/dags/$1/dagRuns/$2/taskInstances/$3/xcomEntries/$4" | grep -o '"value":.*' | sed 's/}$//'; }
RUN=$(run_dag orders_report)
echo "extract   → $(xcom orders_report "$RUN" extract return_value)"
echo "summarize → orders $(xcom orders_report "$RUN" summarize orders), revenue $(xcom orders_report "$RUN" summarize revenue)"
echo "files in the data lake: $(ls data | wc -l), $(cat data/*.csv | wc -c) bytes"
echo "files in the XCom store: $(find xcom-store -type f | wc -l)"
```

```text output
extract   → "value":"file:///opt/airflow/data/orders-manual__….csv"
summarize → orders "value":20000, revenue "value":50555493
files in the data lake: 1, 244922 bytes
files in the XCom store: 0
```

- `extract` wrote 245 KB of orders to the data lake and returned only its path; `summarize` received the path, read the file, and returned two numbers. Every XCom is a few bytes, so the database stayed small and nothing went to the XCom store.
- `multiple_outputs=True` made `orders` and `revenue` separate XComs (as well as the whole dictionary under `return_value`), so later tasks can pull just one.
- The file name includes the run ID, so two runs never overwrite each other's data.

### 4. The same data as one XCom

```bash run
RUN=$(run_dag orders_in_xcom)
echo "count → $(xcom orders_in_xcom "$RUN" count return_value)"
find xcom-store -type f | sed 's|^xcom-store/\([^/]*\)/[^/]*/\([^/]*\)/[^/]*/|xcom-store/\1/<run>/\2/<task instance>/|'
echo "size: $(find xcom-store -type f -exec cat {} + | wc -c) bytes"
```

```text output
count → "value":20000
xcom-store/orders_in_xcom/<run>/extract_everything/<task instance>/return_value.json
size: 784905 bytes
```

Returning the 20,000 orders produced a 785 KB XCom — three times the size of the CSV, because JSON repeats every field name. The backend saw that it was over the 4096-byte threshold and wrote it to the XCom store (one file per value: DAG, run, task instance, key), keeping only a short reference in the database. With the default backend, those 785 KB would sit in the metadata database and be loaded by every task that pulls them. The backend is a safety net; passing a path, as in step 3, is still the better design.

### 5. XComs do not survive a retry

```bash run
RUN=$(run_dag flaky_progress)
af "$AF/api/v2/dags/flaky_progress/dagRuns/$RUN/taskInstances/load" | grep -o '"state":"[a-z_]*"\|"try_number":[0-9]*' | paste - -
echo "load → $(xcom flaky_progress "$RUN" load return_value)"
```

```text output
"state":"success"	"try_number":2
load → "value":"try 2 saw rows_done=None"
```

Try 1 pushed `rows_done=5000` and failed. Before try 2, Airflow cleared that task's XComs, so the retry saw `None`. This keeps attempts independent: a retry starts from the same inputs as the first try, never from half-finished state. If a task needs to know what is already done, it must ask the target system — the topic of the next lesson.

### 6. Clean up

```bash run
docker rm -f devforge-airflow > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Returning DataFrames, file contents or API responses.** Write them to storage and return the path.
- **Fixed file names** (`/data/orders.csv`). Concurrent or repeated runs overwrite each other; include the run ID or the data interval in the path.
- **Storing secrets in XComs.** They are visible in the UI and API; use connections and secrets backends.
- **Using XComs as a progress log across retries.** They are cleared; keep progress in the target system.
- **Assuming the XCom backend fixes the design.** It protects the database, but every pull still loads the whole value into memory.

## Where this fits in a real system

The data lake path is usually a bucket — the same `ObjectStoragePath` code works with `s3://` or `gs://` URLs and a connection ID — while summary values (row counts, checksums) travel as XComs and are checked by quality tasks. **Kafka** topics, **PostgreSQL** tables or **MLflow** artifact stores play the "storage" role in other pipelines, and the reference-passing idea is the same one **GitHub Actions** uses for artifacts between jobs.
