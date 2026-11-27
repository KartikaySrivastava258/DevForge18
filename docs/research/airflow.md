# Apache Airflow — research notes

Checked 2026-11-26/27 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| `apache/airflow:slim-3.4.0-python3.12` | `@sha256:2d3e42b9…` | Airflow 3.4.0 released 2026-11-06; includes providers common-compat, common-io 1.11.0, common-sql, smtp, standard; no PostgreSQL driver |
| `apache/airflow:3.4.0-python3.12` (full) | `@sha256:818f94af…` | 665 MB compressed; not used — the slim image extended with the PostgreSQL provider is smaller |
| apache-airflow-providers-postgres | 7.1.1 | pinned by the 3.4.0 constraints file (psycopg 3.3.6, psycopg2-binary 2.9.13) |
| constraints | `/home/airflow/constraints.txt` in the image | identical (sha256 `3cecb4fe…`) to `constraints-3.4.0/constraints-3.12.txt` on GitHub |
| postgres | 16.15-alpine3.23 `@sha256:8dc5ce24…` | shared with the Kafka outbox lesson |

## Facts confirmed (source → wording)

- Tasks (…/3.4.0/core-concepts/tasks.html): `execution_timeout` breach raises `AirflowTaskTimeout`; the supervisor also enforces it from outside the process (SIGTERM, then SIGKILL after `killed_task_cleanup_time`); `AirflowFailException` fails "ignoring any remaining retry attempts"; `AirflowSkipException` skips.
- Callbacks (…/logging-monitoring/callbacks.html): five types — success, failure (DAG or task), retry, execute, skipped (task); `on_skipped_callback` only when the task runs and raises AirflowSkipException; Deadline Alert callbacks exist.
- XComs (…/core-concepts/xcoms.html): "only designed for small amounts of data; do not use them to pass around large values, like dataframes"; XComs of a task that did not succeed are cleared on every retry; object storage recommended for large values.
- common-io provider config: `xcom_objectstorage_path`, `xcom_objectstorage_threshold` (-1 database only, 0 always object storage, N > 0 bytes), `xcom_objectstorage_compression`; backend class `airflow.providers.common.io.xcom.backend.XComObjectStorageBackend`.
- Best practices: "tasks should produce the same outcome on every re-run"; "Do not use INSERT during a task re-run … Replace it with UPSERT"; read/write a specific partition (data_interval_start); never `datetime.now()` in a task.
- DAG runs: in Airflow 3 a bare cron such as `@daily` uses `CronTriggerTimetable` by default (zero-length data interval, logical date = trigger time).
- Backfill (…/core-concepts/backfill.html): reprocess behaviours none (missing runs), failed (missing and errored), completed (all runs); runs still running/queued are never duplicated; backfill `max_active_runs` independent of the DAG's.
- Architecture overview: the executor is a property of the scheduler and runs in its process; DAG processor serialises DAGs into the metadata DB; triggerer optional.
- Local executor page: "LocalExecutor runs tasks by spawning processes … on the scheduler node. The parameter parallelism limits the number of process spawned".
- Docker stack build page: add `apache-airflow==${AIRFLOW_VERSION}` to pip installs; image constraints at `${HOME}/constraints.txt`.
- Docker stack entrypoint page: the image runs with any UID as long as GID is 0; umask 0002.
- Health check page: component healthy if any instance's heartbeat is within the threshold.

## Observed while building lessons

- A manual run with `logical_date` gets a zero-length data interval at that date; a second trigger for the same DAG and logical date fails with "Unique constraint violation" — re-run by `POST /dags/{id}/clearTaskInstances`.
- `dagrun_timeout`: the run becomes failed, the running task is marked **skipped**, and the DAG `on_failure_callback` gets `reason=timed_out` a few seconds after the run ends.
- Callbacks set in `default_args` receive `exception` in the context (`AirflowTaskTimeout`, `AirflowFailException`).
- With the object-storage XCom backend, a 20,000-item list (784,905 bytes of JSON) was stored at `<path>/<dag>/<run>/<task>/ti-<uuid>/return_value.json`; the API still returns the value.
- Files written by the container as uid 50000 into a mounted work folder could not be deleted by the test runner (EACCES); `--user "$(id -u):0"` fixes it.
- With catchup off, an unpaused `@daily` DAG gets a run for the most recent midnight; `end_date` in the past prevents it.
- Backfill run IDs are `backfill__<logical date>`; `reprocess_behavior: failed` re-runs the failed date in the same run (its tasks' `try_number` increases).
- The slim image has no `hostname` command.
- Stopping the scheduler: triggered runs stay `queued`; the health endpoint reports the scheduler `unhealthy` once its heartbeat is older than the threshold; restarting it completes the run.
- `docker build` inside this machine's legacy builder could not reach raw.githubusercontent.com, while PyPI worked; using the image's own constraints file avoids the download entirely.
