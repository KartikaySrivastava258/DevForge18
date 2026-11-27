---
id: airflow-retries-and-failures
title: Retries, failures and safe re-runs
track: airflow
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [airflow-schedules-and-catchup]
learning_objectives:
  - Give a task retries and watch a temporary failure recover.
  - Explain what happens to downstream tasks when a task fails for good.
  - Explain why tasks should produce the same outcome when they run again.
resources:
  - title: Tasks (task instances and states)
    url: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html
    publisher: The Apache Software Foundation
    type: documentation
    level: beginner
    official: true
    why: Task states such as up_for_retry and upstream_failed, and how retries are applied.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Airflow best practices
    url: https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Why tasks should produce the same outcome on every re-run, and other advice for production DAGs.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: retry-or-not
    prompt: Which failure is a good fit for automatic retries?
    options:
      - { id: a, text: "A timeout calling a payment service that is briefly overloaded" }
      - { id: b, text: "A missing configuration file" }
      - { id: c, text: "A bug that divides by zero on every run" }
    answer: a
    explanation: Retries help with temporary problems that may be gone a few seconds later. A missing file or a bug fails the same way every time, so retries only delay the error.
  - id: upstream-failed
    prompt: refund_check failed and notify_finance shows upstream_failed. Why did notify_finance not run?
    options:
      - { id: a, text: "It ran and failed too" }
      - { id: b, text: "By default a task runs only when all of its upstream tasks succeeded; one of them failed, so Airflow did not start it" }
      - { id: c, text: "Airflow skipped it to save time" }
    answer: b
    explanation: The default trigger rule is all_success. upstream_failed means the task never started because something it needed failed — fix the upstream task and clear it, and the downstream task will run.
  - id: same-outcome
    prompt: A load task inserts a day's orders into a table. It fails halfway, and the retry inserts them again. What should the task have done?
    options:
      - { id: a, text: "Nothing — duplicates are unavoidable" }
      - { id: b, text: "Make the work repeatable, for example replacing that day's rows (delete then insert, or an upsert) so a second run leaves the same result" }
      - { id: c, text: "Disable retries" }
    answer: b
    explanation: Airflow may run a task more than once — retries, re-runs, backfills. The best-practices guide says tasks should produce the same outcome on every re-run; writing per logical date, replacing rather than appending, is the usual way.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with apache/airflow:slim-3.4.0-python3.12 (pinned by digest), after the previous lessons; the output shown was recorded from that run. Facts about task states, trigger rules and re-runs were checked against the Airflow 3.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A task can be given **retries**, so a temporary failure is tried again after a delay; a task that still fails stops the tasks that depend on it (**upstream_failed**), and because Airflow may run any task more than once, every task should leave the same result however many times it runs.

## Explain it like I'm twelve

If the bakery is closed when you go for bread, you try again in ten minutes — maybe it has opened. If the bakery has burned down, trying again every ten minutes will not help, and the sandwich-making step cannot start. And if you go to the bakery twice by mistake, you should not end up with two loaves: check the cupboard first.

Retrying is the second trip; **upstream_failed** is the sandwich step that cannot start; checking the cupboard is making the task **safe to repeat**.

Where the analogy breaks: Airflow keeps a record of every try, so you can see exactly when and why each attempt failed.

## What problem it solves

Networks drop, services restart, databases are briefly busy. Without retries, every such blip would fail a whole pipeline and wake someone up. With retries, temporary problems fix themselves — while real errors still fail clearly and stop the steps that depended on them, instead of producing half-finished results downstream.

## How it works

```diagram steps=airflow/retry-flow
```

- `retries=2` allows two extra attempts; `retry_delay` is the wait between them. Between attempts the task's state is **up_for_retry**.
- Each attempt increases the task instance's **try number**.
- By default a task runs only when **all** of its upstream tasks succeeded (the `all_success` trigger rule). If one fails for good, its downstream tasks become **upstream_failed** and the run fails.

## Try it yourself

> **Local lab** — continue with the `devforge-airflow` container, from inside `airflow-lab`, with `AF`, `af` and `run_dag` defined (previous lessons). Every command is run automatically in DevForge's tests.

### 1. A DAG with a flaky task and a broken one

```bash run
cat > dags/payments.py <<'EOF'
from datetime import datetime, timedelta
from airflow.sdk import dag, get_current_context, task

@dag(dag_id="payments", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def payments():
    @task(retries=2, retry_delay=timedelta(seconds=3))
    def charge():
        ti = get_current_context()["ti"]
        if ti.try_number < 2:
            raise RuntimeError("payment service timed out")
        return "charged"

    @task
    def send_receipt(result):
        print("receipt:", result)

    @task
    def refund_check():
        raise ValueError("refund rules file is missing")

    @task
    def notify_finance():
        print("finance notified")

    send_receipt(charge())
    refund_check() >> notify_finance()

payments()
EOF
```

- `charge` imitates a service that times out once: its first try raises an error, its second succeeds. `retries=2` and `retry_delay` of 3 seconds give it the chance.
- `refund_check` fails every time — a real error.
- `>>` declares a dependency between tasks that do not pass data: `notify_finance` waits for `refund_check`.

### 2. Run it and look at every task

```bash run
for i in $(seq 1 60); do af "$AF/api/v2/dags/payments" | grep '"dag_id"' > /dev/null && break; sleep 1; done
RUN=$(run_dag payments)
af "$AF/api/v2/dags/payments/dagRuns/$RUN" | grep -o '"state":"[a-z_]*"' | head -n 1
af "$AF/api/v2/dags/payments/dagRuns/$RUN/taskInstances" \
  | grep -o '"task_id":"[a-z_]*"\|"state":"[a-z_]*"\|"try_number":[0-9]*' | paste - - - | sort
```

```text output
"state":"failed"
"task_id":"charge"	"state":"success"	"try_number":2
"task_id":"notify_finance"	"state":"upstream_failed"	"try_number":0
"task_id":"refund_check"	"state":"failed"	"try_number":1
"task_id":"send_receipt"	"state":"success"	"try_number":1
```

- **charge** failed on try 1, waited, and **succeeded on try 2** — the receipt was then sent. Nobody had to do anything.
- **refund_check** failed. It had no retries (the default), so it failed at once.
- **notify_finance** never started: `upstream_failed`, try number 0. Its upstream task failed, and the default rule needs all of them to succeed.
- The run is **failed**, because one of its last tasks did not succeed — even though half the work went through.

In the web interface (<http://localhost:8095>), open the `payments` run: the logs of each try of `charge` show the timeout and the success. This step is not part of the automatic tests.

### 3. Clean up

This removes Airflow, its database and its logs:

```bash run
docker rm -f devforge-airflow
```

```text output
devforge-airflow
```

Your DAG files stay in `airflow-lab/dags`.

## Try it in the simulation

A week went wrong: two runs failed and left half-written rows behind. Repair it with retries, clears and backfills — and watch the table, not only the run states. It is a labelled teaching model of Airflow's scheduler, not a real Airflow.

```simulation airflow-scheduler-timeline scenario=broken-week
```

## Common mistakes

- **Retrying everything.** Retries hide nothing for real errors; they only delay the alert. Give retries to steps that talk to networks and services.
- **No delay between retries.** Retrying instantly hits the same overloaded service again; use `retry_delay` (and back-off for longer outages).
- **Tasks that are not safe to repeat.** Appending rows or charging a card again on a retry creates duplicates. Write per logical date and replace, or check before acting.
- **Ignoring `upstream_failed`.** Fix the upstream task, then clear it; its downstream tasks will then run.
- **Catching every exception inside a task.** A task that swallows its error is marked successful, and Airflow cannot retry it or stop the tasks after it.

## Where this fits in a real system

Retries cover the brief outages of **PostgreSQL**, **Kafka** or an HTTP API; real failures alert someone through Airflow's callbacks or through metrics in **Prometheus**. Making each task safe to repeat is what lets teams re-run a day's pipeline with confidence — the same idea as idempotent consumers in **Kafka** and safe retries in **Postman**-tested APIs.
