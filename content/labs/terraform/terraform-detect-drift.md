---
id: terraform-detect-drift
title: Detect configuration drift
track: terraform
level: advanced
mode: local
estimated_minutes: 30
prerequisites: [terraform-first-configuration]
objectives:
  - Detect changes made outside Terraform with a refresh-only plan and with -detailed-exitcode.
  - Decide, for each drifted object, whether the configuration or the real world is right — and act on that decision.
  - Explain how a scheduled plan in CI turns drift into an alert.
checkpoints:
  - { id: refresh-only, text: "The refresh-only plan reported that local_file.app_config changed outside Terraform" }
  - { id: exit-code, text: "terraform plan -detailed-exitcode exited with 2 while there was drift, and 0 afterwards" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Command — terraform plan
    url: https://developer.hashicorp.com/terraform/cli/commands/plan
    publisher: HashiCorp (Terraform documentation)
    type: documentation
    level: intermediate
    official: true
    why: Planning modes, including refresh-only, and the meaning of -detailed-exitcode's exit codes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Manage resource drift (tutorial)
    url: https://developer.hashicorp.com/terraform/tutorials/state/resource-drift
    publisher: HashiCorp (Terraform tutorials)
    type: tutorial
    level: intermediate
    official: true
    why: How Terraform refreshes state, and how to review and accept or undo drift.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Terraform 1.15.6 and the hashicorp/local provider, and their output is compared with this page (provider download messages vary, so the lab filters them out). The meaning of -detailed-exitcode was checked against the Terraform documentation on 2026-11-26. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Terraform manages two files on a "server" (a folder). Then people change things by hand, as they do in real teams. You **detect** the drift, **decide** which side is right for each change, bring configuration, state and the real world back into agreement, and prove there is nothing left to change.

## Before you start

You need Terraform, as in *Your first configuration* (internet access for `terraform init`). The lab uses a new folder and the `local` provider, which only writes files — no cloud account.

## Steps

### 1. Two managed files

```bash run
mkdir drift-lab && cd drift-lab
cat > main.tf <<'EOF'
terraform {
  required_version = ">= 1.6"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "local_file" "app_config" {
  filename = "${path.module}/app.conf"
  content  = "port = 8080\n"
}

resource "local_file" "motd" {
  filename = "${path.module}/motd.txt"
  content  = "Welcome to the lab server\n"
}
EOF
terraform init -no-color > /dev/null
terraform apply -auto-approve -no-color | tail -n 1
```

```text output
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
```

### 2. Two changes outside Terraform

An operator moves the app to port 9090 by editing the file on the server, and someone else deletes the message of the day.

```bash run
printf 'port = 9090\n' > app.conf
rm motd.txt
```

Terraform does not notice by itself: nothing runs until you ask.

### 3. Detect: a refresh-only plan

A **refresh-only** plan reads the real objects and reports how they differ from the state, without proposing to change anything.

```bash run
terraform plan -refresh-only -no-color | grep -E '^  # |^Note: Objects|refresh-only plan'
```

```text output
Note: Objects have changed outside of Terraform
  # local_file.app_config has been deleted
  # local_file.motd has been deleted
This is a refresh-only plan, so Terraform will not take any actions to undo
```

Both files count as "deleted". For `motd.txt` that is literal. For `app.conf` it is how this provider works: a `local_file` is identified by a hash of its content (its `id` is the SHA-1 of the content), so a file with different content is a different object, and the one Terraform created is gone. Other providers report an edit as an in-place change (`~`) instead.

### 4. Detect: an exit code for scripts

`-detailed-exitcode` makes `terraform plan` exit with **0** when there are no changes, **1** on an error and **2** when there are changes — something a scheduled CI job can alert on.

```bash run fails
terraform plan -no-color -detailed-exitcode > plan.txt
echo "exit code: $?"
grep -E '^  # |^Plan:' plan.txt
```

```text output
exit code: 2
  # local_file.app_config will be created
  # local_file.motd will be created
Plan: 2 to add, 0 to change, 0 to destroy.
```

Applying this plan now would put both files back exactly as the configuration says — including **undoing the port change**. Never apply a drift plan without reading it.

### 5. Decide, then act

- **The port change was intentional** (the team moved the app). The real world is right, so update the configuration to match it.
- **The deleted message was a mistake.** The configuration is right, so let Terraform restore it.

```bash run
sed -i.bak 's/port = 8080/port = 9090/' main.tf && rm main.tf.bak
terraform plan -no-color | grep -E '^  # |^Plan:'
terraform apply -auto-approve -no-color | tail -n 1
cat app.conf motd.txt
```

```text output
  # local_file.app_config will be created
  # local_file.motd will be created
Plan: 2 to add, 0 to change, 0 to destroy.
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
port = 9090
Welcome to the lab server
```

The plan still says *create* for `app.conf` because the object in the state is gone; Terraform writes the file again — now with the content you chose, which is already what the operator set.

### 6. Prove there is no drift left

```bash run
terraform plan -no-color -detailed-exitcode > plan.txt
echo "exit code: $?"
grep '^No changes' plan.txt
```

```text output
exit code: 0
No changes. Your infrastructure matches the configuration.
```

In a team, a job that runs this plan every night and alerts on exit code 2 catches drift within a day — before the next person's `apply` silently reverts someone's emergency fix.

## Check your work

Run this inside `drift-lab`.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "this folder has a Terraform state" '[ -f terraform.tfstate ] && terraform state list | grep -x local_file.app_config > /dev/null'
check "the configuration sets port 9090" 'grep -q "port = 9090" main.tf'
check "app.conf on disk says port 9090" 'grep -qx "port = 9090" app.conf'
check "motd.txt exists again" '[ -f motd.txt ]'
check "terraform plan finds no changes (exit code 0)" 'terraform plan -no-color -detailed-exitcode'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: this folder has a Terraform state
PASS: the configuration sets port 9090
PASS: app.conf on disk says port 9090
PASS: motd.txt exists again
PASS: terraform plan finds no changes (exit code 0)
All checks passed
```

## Reset

Run `terraform destroy -auto-approve` inside `drift-lab`, leave the folder and delete it — `cd .. && rm -rf drift-lab` — then begin again at step 1.

## What you practised

Drift is the gap between state and reality. A refresh-only plan shows it, `-detailed-exitcode` lets a schedule alert on it, and the fix is a decision, not a command: update the configuration when the real world is right, apply when the configuration is.
