---
id: terraform-remote-state-locking-workspaces
title: Remote state, locking and workspaces
track: terraform
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [terraform-modules-and-refactoring]
learning_objectives:
  - Move Terraform state out of a local file into a shared backend (here PostgreSQL), configured without writing credentials to disk.
  - Show state locking stopping a second run while one is in progress, and wait for a lock with -lock-timeout.
  - Use workspaces to keep separate state for the same configuration, and explain when separate configurations are the better choice.
resources:
  - title: Backend type — pg
    url: https://developer.hashicorp.com/terraform/language/backend/pg
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: Stores state in a PostgreSQL table keyed by workspace, locks with advisory locks, and reads PG_CONN_STR and the standard libpq environment variables so credentials stay off disk.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: State locking
    url: https://developer.hashicorp.com/terraform/language/state/locking
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: Locking happens automatically on every operation that could write state; if it fails, Terraform does not continue; force-unlock is a last resort.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Workspaces
    url: https://developer.hashicorp.com/terraform/language/state/workspaces
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: terraform.workspace, the default workspace, and the warning that workspaces are not appropriate for deployments that need separate credentials and access controls.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: time_sleep resource (hashicorp/time)
    url: https://github.com/hashicorp/terraform-provider-time/blob/main/docs/resources/sleep.md
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: A resource that only waits — used in the lab to keep an apply running long enough to see the lock.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-remote
    prompt: Two engineers each have their own terraform.tfstate file for the same infrastructure. What goes wrong?
    options:
      - { id: a, text: "Nothing, Terraform merges them" }
      - { id: b, text: "Each sees a different record of reality: one may create resources the other already created, or delete what the other's file does not mention" }
      - { id: c, text: "Terraform refuses to run" }
    answer: b
    explanation: State is Terraform's memory of what it manages. A team needs one shared copy — a remote backend — and a lock so only one run changes it at a time.
  - id: lock
    prompt: An apply is running when a colleague starts another apply on the same workspace. What happens with a backend that supports locking?
    options:
      - { id: a, text: "Both run and the last one to finish wins" }
      - { id: b, text: "The second one fails with \"Error acquiring the state lock\" (or waits, if -lock-timeout is set) instead of writing state at the same time" }
      - { id: c, text: "The first one is cancelled" }
    answer: b
    explanation: The lab shows both — an immediate failure, and a plan that waits with -lock-timeout. Never disable locking to "get past" the error; find out who holds the lock.
  - id: workspaces
    prompt: Should production and staging be two workspaces of one configuration?
    options:
      - { id: a, text: "Always" }
      - { id: b, text: "Only if they can share the same backend, credentials and access rules; HashiCorp advises separate configurations and backends when they need separate credentials and access control" }
      - { id: c, text: "Never use workspaces" }
    answer: b
    explanation: Anyone who can run in one workspace can switch to another. For a strong boundary between production and everything else, use separate state locations with separate permissions.
verification:
  method: executed
  details: Every command is run by the test suite with Terraform 1.15.6, the hashicorp/local and hashicorp/time providers and PostgreSQL 16, after the previous lessons, and its output is compared with this lesson. Backend, locking and workspace behaviour were checked against HashiCorp's documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A team shares **one copy of the state** in a **remote backend**, Terraform **locks** it so only one run can change it at a time, and **workspaces** keep separate state for separate copies of the same configuration.

## Explain it like I'm twelve

A class keeps one register of who has borrowed which book. If every pupil kept their own copy of the register, the copies would soon disagree. So there is one register on the teacher's desk (**remote state**), and only one pupil may write in it at a time — the others wait for the pen (**locking**). The library also keeps separate pages for the junior and senior sections, using the same columns (**workspaces**).

Where the analogy breaks: Terraform's lock is released automatically when a run ends or its connection drops; nobody has to remember to hand back the pen.

## What problem it solves

So far, state has been a `terraform.tfstate` file in your folder. That works for one person on one laptop. In a team or in CI, a local state file gets lost, goes stale, or exists in several versions; two runs at once can corrupt it. A remote backend gives everyone the same state, keeps it off laptops, and its lock prevents two writers.

## How it works

![](media:terraform/remote-state.svg)

- A `backend` block says where state lives. Common backends are object storage (S3, Azure Storage, Google Cloud Storage), HCP Terraform, Kubernetes, Consul — and PostgreSQL (`pg`), used here because it runs on your machine.
- Credentials belong in the environment, not in `.tf` files: the `pg` backend reads `PG_CONN_STR` and the standard `PG*` variables.
- Before any operation that could write state, Terraform takes a **lock**; if it cannot, it stops. `-lock-timeout=30s` waits instead of failing at once.
- **Workspaces** are named copies of the state for one configuration (`default`, `staging` …); `terraform.workspace` holds the current name.

## Try it yourself

> **Local lab** — needs Terraform (as in the previous lessons) and access to a PostgreSQL server through the usual `PGHOST`, `PGUSER` and `PGPASSWORD` settings, as in the PostgreSQL track. It creates a database called `devforge_tf_state` and removes it at the end. `terraform init` downloads two small providers. Every command is run automatically in DevForge's tests.

### 1. A configuration whose state lives in PostgreSQL

```bash run
mkdir -p tf-remote-lab && cd tf-remote-lab
dropdb --if-exists devforge_tf_state 2> /dev/null
createdb devforge_tf_state
# Host, user and password come from PGHOST, PGUSER and PGPASSWORD; only the database is named here.
export PG_CONN_STR="postgres:///devforge_tf_state?sslmode=disable"
cat > main.tf <<'EOF'
terraform {
  required_version = ">= 1.6"
  backend "pg" {}
  required_providers {
    local = { source = "hashicorp/local", version = "~> 2.5" }
    time  = { source = "hashicorp/time", version = "~> 0.13" }
  }
}

variable "slow" {
  description = "Add a resource that takes 8 seconds to create, to make the lock visible."
  type        = bool
  default     = false
}

resource "local_file" "settings" {
  filename = "${path.module}/out/${terraform.workspace}.txt"
  content  = "environment: ${terraform.workspace}\n"
}

resource "time_sleep" "pause" {
  count           = var.slow ? 1 : 0
  create_duration = "8s"
}
EOF
terraform init -no-color -input=false > init.log 2>&1 || { cat init.log; exit 1; }
grep 'successfully initialized' init.log
```

```text output
Terraform has been successfully initialized!
```

`backend "pg" {}` is empty on purpose: the connection comes from `PG_CONN_STR` and the `PG*` variables, so no password is written into a file that could be committed.

### 2. Apply, and find the state in the database

```bash run
terraform apply -no-color -auto-approve -input=false | tail -n 1
ls terraform.tfstate 2> /dev/null || echo "no local terraform.tfstate"
psql -d devforge_tf_state -Atc "SELECT name, length(data) > 0 AS has_state FROM terraform_remote_state.states ORDER BY name"
```

```text output
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
no local terraform.tfstate
default|t
```

The backend created a schema `terraform_remote_state` with a table `states`, one row per workspace. Anyone with access to the database — a colleague, a CI job — now sees the same state.

### 3. The lock in action

Start a slow apply in the background, and try a second one while it runs:

```bash run fails
terraform apply -no-color -auto-approve -input=false -var slow=true > slow-apply.log 2>&1 &
sleep 3
terraform apply -no-color -auto-approve -input=false -var slow=true 2>&1 | grep -E '^Error: |already locked|Operation:'
```

```text output
Error: Error acquiring the state lock
Error message: Workspace is already locked: default
  Operation: OperationTypeApply
```

The second run stopped before doing anything: the first one held the lock (a PostgreSQL advisory lock). The error says which operation holds it — in a team, the next step is to ask who is running it, never to add `-lock=false`.

```bash run
wait
tail -n 1 slow-apply.log
```

```text output
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

### 4. Waiting for the lock instead

```bash run
terraform apply -no-color -auto-approve -input=false -var slow=true -replace='time_sleep.pause[0]' > slow-apply.log 2>&1 &
sleep 3
t0=$(date +%s)
terraform plan -no-color -input=false -var slow=true -lock-timeout=60s | tail -n 1
waited=$(( $(date +%s) - t0 ))
[ "$waited" -ge 2 ] && echo "the plan waited for the lock, then ran" || echo "the plan did not wait"
wait
```

```text output
…no changes are needed.
the plan waited for the lock, then ran
```

`-replace` makes the background apply recreate the slow resource, so it holds the lock for about eight seconds. With `-lock-timeout=60s`, the plan waited for it and then ran normally. CI pipelines often set a lock timeout so that two runs queue instead of failing.

### 5. Workspaces: the same configuration, separate state

```bash run
terraform workspace new -no-color staging | grep '^Created'
terraform apply -no-color -auto-approve -input=false | tail -n 1
terraform workspace list -no-color
psql -d devforge_tf_state -Atc "SELECT name FROM terraform_remote_state.states ORDER BY name"
cat out/default.txt out/staging.txt
```

```text output
Created and switched to workspace "staging"!
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
  default
* staging

default
staging
environment: default
environment: staging
```

- `staging` started with empty state, so Terraform created its own file, named after `terraform.workspace`.
- Each workspace is one row in `states`. Both share the same backend and the same credentials — which is why HashiCorp advises *separate configurations and backends* when environments need separate access control, such as production.

### 6. Clean up

```bash run
terraform destroy -no-color -auto-approve -input=false | tail -n 1
terraform workspace select -no-color default > /dev/null
terraform workspace delete -no-color staging
terraform destroy -no-color -auto-approve -input=false -var slow=true | tail -n 1
cd .. && dropdb devforge_tf_state && echo "database removed"
```

```text output
Destroy complete! Resources: 1 destroyed.
Deleted workspace "staging"!
Destroy complete! Resources: 2 destroyed.
database removed
```

A workspace can only be deleted when its state is empty (or with `-force`), which protects you from losing track of real resources.

## Common mistakes

- **Credentials in the backend block.** They end up in Git. Use environment variables or a credentials file outside the repository.
- **`-lock=false` or `force-unlock` to get past a lock.** Two writers can corrupt state. Find the run that holds the lock first.
- **Forgetting which workspace you are in.** `terraform workspace show` before every apply, or put the workspace name in your shell prompt; in CI, select it explicitly.
- **Workspaces as the only wall around production.** Use separate configurations and backends with separate permissions.
- **Reading state for secrets.** State can contain sensitive values in plain text. Protect the backend as you would a password store, with encryption and access control.

## Where this fits in a real system

**GitHub Actions** and **Jenkins** pipelines run `terraform plan` and `apply` against a remote backend, with a lock timeout so concurrent runs queue. The backend is usually object storage or HCP Terraform rather than a database, and **PostgreSQL**-style access control on it decides who can change infrastructure. Outputs from one configuration's state can be read by another with the `terraform_remote_state` data source — for example a **Kubernetes** cluster configuration reading a network configuration's outputs.
