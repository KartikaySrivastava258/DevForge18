---
id: terraform-testing-and-policy
title: Testing modules and checking plans against policy
track: terraform
order: 6
level: advanced
estimated_minutes: 45
prerequisites: [terraform-modules-and-refactoring]
learning_objectives:
  - Reject bad input early with variable validation rules.
  - Write terraform test files with plan-mode and apply-mode runs, expected failures, and a mocked provider.
  - Read a failing test's report and fix the cause.
  - Check a saved plan against a rule ("no world-writable files") by reading its JSON form — the idea behind policy tools such as OPA and Sentinel.
resources:
  - title: Tests (terraform test)
    url: https://developer.hashicorp.com/terraform/language/tests
    publisher: HashiCorp
    type: documentation
    level: advanced
    official: true
    why: Test files, run blocks, command = plan versus apply, assert and expect_failures (available from Terraform 1.6).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Mocks (mock_provider)
    url: https://developer.hashicorp.com/terraform/language/tests/mocking
    publisher: HashiCorp
    type: documentation
    level: advanced
    official: true
    why: Mock providers return the real provider's schema without calling it (available from Terraform 1.7).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: JSON output format
    url: https://developer.hashicorp.com/terraform/internals/json-format
    publisher: HashiCorp
    type: reference
    level: advanced
    official: true
    why: The machine-readable plan from terraform show -json, including resource_changes with each change's actions and after values.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Open Policy Agent — Terraform
    url: https://www.openpolicyagent.org/docs/terraform
    publisher: Open Policy Agent
    type: tutorial
    level: advanced
    official: true
    why: The same approach with a dedicated policy engine — save a plan, convert it to JSON, and evaluate rules against resource_changes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: local_file resource (hashicorp/local)
    url: https://github.com/hashicorp/terraform-provider-local/blob/main/docs/resources/file.md
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: file_permission defaults to "0777" (before umask) — the setting the lab's policy checks.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: plan-vs-apply
    prompt: Why write most test runs with command = plan?
    options:
      - { id: a, text: "Plan-mode runs are the only kind terraform test allows" }
      - { id: b, text: "They check the module's logic — names, values, validation — without creating real infrastructure, so they are fast, free and safe; keep a few apply runs for what only exists after creation" }
      - { id: c, text: "Apply-mode runs cannot have assertions" }
    answer: b
    explanation: In the lab, three of four runs use plan; one applies, checks the real file, and terraform test destroys it afterwards.
  - id: expect-failures
    prompt: A run sets students = 0 and expect_failures = [var.students]. When does it pass?
    options:
      - { id: a, text: "When the plan succeeds" }
      - { id: b, text: "When the validation rule on var.students rejects the value — the test proves that bad input is refused" }
      - { id: c, text: "Never" }
    answer: b
    explanation: Testing the error cases matters as much as the happy path; a validation rule that silently accepts 0 is a bug.
  - id: policy
    prompt: Tests passed, yet a plan would create a world-writable file. Which check catches it before apply?
    options:
      - { id: a, text: "terraform fmt" }
      - { id: b, text: "A policy check on the saved plan's JSON (resource_changes → change.after.file_permission), run in CI between plan and apply" }
      - { id: c, text: "terraform init" }
    answer: b
    explanation: Tests check what a module's author intended; policy checks enforce organisation-wide rules on every plan, whoever wrote the configuration.
verification:
  method: executed
  details: Every command is run by the test suite with Terraform 1.15.6, the hashicorp/local provider and jq, after the previous lessons, and its output is compared with this lesson. Test, mock and plan-JSON behaviour was checked against HashiCorp's documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Infrastructure code deserves the same safety net as application code: **validation** rejects bad input, **`terraform test`** proves a module does what it promises (including refusing what it should refuse), and **policy checks** on the saved plan enforce rules that apply to everyone's code.

## Explain it like I'm twelve

Before a school trip, the form says "age must be 8 to 12" (**validation**). The teacher practises the trip on a map first, and walks one short part of the route for real (**plan and apply tests**). And the head teacher has rules for *every* trip — "no swimming without a lifeguard" — checked on the final plan whoever organised it (**policy**).

Where the analogy breaks: Terraform's checks run in seconds, on every change.

## What problem it solves

A module used by twenty teams can break all twenty with one wrong expression. Without tests, the first sign is a failed — or worse, a wrong — apply in production. And some rules (no public buckets, no world-writable files, required tags) must hold no matter who writes the configuration, which code review alone does not guarantee.

## How it works

![](media:terraform/testing-policy.svg)

- A `validation` block on a variable checks the value during plan and stops with your `error_message`.
- Test files (`*.tftest.hcl`, in `tests/`) contain `run` blocks. Each runs a plan (`command = plan`) or an apply (the default) with given `variables`, then checks `assert` conditions. `expect_failures` makes a run pass only if the listed checks fail.
- Resources created by apply runs are destroyed when the test file finishes. `mock_provider` replaces a provider with a fake that returns its schema without real calls.
- `terraform plan -out=plan.out` saves a plan; `terraform show -json plan.out` turns it into JSON, which any tool — here `jq`; at scale OPA/Conftest or HCP Terraform's Sentinel — can check against rules.

## Try it yourself

> **Local lab** — needs Terraform (as in the previous lessons) and `jq`. The `hashicorp/local` provider writes files on your computer; nothing in the cloud is involved. Every command is run automatically in DevForge's tests.

### 1. A module that validates its input

```bash run
mkdir -p tf-test-lab/tests && cd tf-test-lab
cat > main.tf <<'EOF'
terraform {
  required_providers {
    local = { source = "hashicorp/local", version = "~> 2.5" }
  }
}

variable "code" {
  type = string
  validation {
    condition     = can(regex("^[A-Z]{2,4}[0-9]{3}$", var.code))
    error_message = "code must look like CS101: 2 to 4 capital letters, then 3 digits."
  }
}

variable "students" {
  type = number
  validation {
    condition     = var.students >= 1 && var.students <= 300
    error_message = "students must be between 1 and 300."
  }
}

resource "local_file" "roster" {
  filename        = "${path.root}/rosters/${lower(var.code)}.txt"
  content         = "${var.code}: ${var.students} students\n"
  file_permission = "0644"
}

output "file" {
  value = local_file.roster.filename
}
EOF
terraform init -no-color > /dev/null
```

Now plan with a badly formed course code:

```bash run fails
terraform plan -no-color -input=false -var code=cs-101 -var students=30 2>&1 | grep -E 'Invalid value|code must'
```

```text output
Error: Invalid value for variable
code must look like CS101: 2 to 4 capital letters, then 3 digits.
```

The plan stopped before doing anything, with the module author's own message.

### 2. Tests: plan runs, an apply run and expected failures

```bash run
cat > tests/course.tftest.hcl <<'EOF'
variables {
  code     = "CS101"
  students = 30
}

run "file_name_is_lower_case" {
  command = plan
  assert {
    condition     = local_file.roster.filename == "./rosters/cs101.txt"
    error_message = "unexpected file name: ${local_file.roster.filename}"
  }
}

run "rejects_zero_students" {
  command = plan
  variables {
    students = 0
  }
  expect_failures = [var.students]
}

run "rejects_badly_formed_code" {
  command = plan
  variables {
    code = "cs-101"
  }
  expect_failures = [var.code]
}

run "writes_the_roster" {
  assert {
    condition     = file(local_file.roster.filename) == "CS101: 30 students\n"
    error_message = "the roster file has the wrong content"
  }
}
EOF
terraform test -no-color
echo "roster files left behind: $(ls rosters 2> /dev/null | wc -l | tr -d ' ')"
```

```text output
tests/course.tftest.hcl... in progress
  run "file_name_is_lower_case"... pass
  run "rejects_zero_students"... pass
  run "rejects_badly_formed_code"... pass
  run "writes_the_roster"... pass
tests/course.tftest.hcl... tearing down
tests/course.tftest.hcl... pass

Success! 4 passed, 0 failed.
roster files left behind: 0
```

- File-level `variables` apply to every run; a run can override them.
- Two runs *expect* validation to fail — they prove bad input is refused.
- `writes_the_roster` applies for real and reads the file back; at "tearing down", Terraform destroyed it.

### 3. A bug, caught

Someone "simplifies" the file name and drops `lower()`:

```bash run
sed -i 's|rosters/${lower(var.code)}.txt|rosters/${var.code}.txt|' main.tf
```

```bash run fails
terraform test -no-color 2>&1 | grep -E 'run "|Error:|actual|expected|^    │ [-+] |unexpected file name|^(Success|Failure)'
```

```text output
  run "file_name_is_lower_case"... fail
Error: Test assertion failed
  on tests/course.tftest.hcl line 9, in run "file_name_is_lower_case":
    │ --- actual
    │ +++ expected
    │ - "./rosters/CS101.txt"
    │ + "./rosters/cs101.txt"
unexpected file name: ./rosters/CS101.txt
  run "rejects_zero_students"... pass
  run "rejects_badly_formed_code"... pass
  run "writes_the_roster"... pass
Failure! 3 passed, 1 failed.
```

The report names the run, shows actual against expected, and prints the assertion's message. On a case-sensitive file system this change would have created a *second* roster file next to the old one. Put the fix back:

```bash run
sed -i 's|rosters/${var.code}.txt|rosters/${lower(var.code)}.txt|' main.tf
terraform test -no-color | tail -n 1
```

```text output
Success! 4 passed, 0 failed.
```

### 4. A unit test with a mocked provider

```bash run
cat > tests/unit.tftest.hcl <<'EOF'
# A mocked "local" provider: the run "applies", but nothing touches the disk.
mock_provider "local" {}

run "content_with_mocked_provider" {
  command = apply
  variables {
    code     = "DB201"
    students = 25
  }
  assert {
    condition     = local_file.roster.content == "DB201: 25 students\n"
    error_message = "unexpected content"
  }
}
EOF
terraform test -no-color -filter=tests/unit.tftest.hcl | tail -n 1
```

```text output
Success! 1 passed, 0 failed.
```

With cloud providers, mocks let you test a module's logic without credentials, cost or waiting — and keep real apply runs for a separate, slower suite.

### 5. A policy check on the plan

A rule for every configuration in the organisation: **no world-writable files**. A colleague adds a notes file and forgets the permission (the provider's default is `0777`):

```bash run
cat >> main.tf <<'EOF'

resource "local_file" "notes" {
  filename = "${path.root}/rosters/notes.txt"
  content  = "Room changes are announced on Mondays.\n"
}
EOF
cat > policy.sh <<'EOF'
#!/usr/bin/env bash
# Policy: no local_file may be created or updated with world-writable permissions (last digit 2, 3, 6 or 7).
set -euo pipefail
violations=$(terraform show -json "$1" | jq -r '
  .resource_changes[]
  | select(.type == "local_file")
  | select(.change.actions | index("create") or index("update"))
  | select(.change.after.file_permission | test("[2367]$"))
  | "\(.address) would be world-writable (\(.change.after.file_permission))"')
if [ -n "$violations" ]; then echo "POLICY FAILED:"; echo "$violations"; exit 1; fi
echo "policy passed"
EOF
chmod +x policy.sh
terraform plan -no-color -input=false -var code=CS101 -var students=30 -out=plan.out > /dev/null
```

```bash run fails
./policy.sh plan.out
```

```text output
POLICY FAILED:
local_file.notes would be world-writable (0777)
```

```bash run
sed -i 's|  content  = "Room changes are announced on Mondays.\\n"|&\n  file_permission = "0644"|' main.tf
terraform plan -no-color -input=false -var code=CS101 -var students=30 -out=plan.out > /dev/null
./policy.sh plan.out
```

```text output
policy passed
```

The check read the **saved plan** — exactly what apply would do — not the source files, so it works however the configuration is written (modules, loops, variables). In CI it runs between `plan` and `apply`, and a failure stops the pipeline.

## Common mistakes

- **Only testing the happy path.** Test that validation refuses what it should, with `expect_failures`.
- **Apply runs for everything.** Slow and costly with real clouds; use `command = plan` and mocks for logic.
- **Assertions that restate the code.** Test behaviour that matters to users of the module (names, counts, refused input), not every attribute.
- **Policy checks on source files.** Text searches miss values computed by modules and variables; check the plan JSON.
- **Rules nobody can see.** Keep policies in version control, with tests of their own, and make their messages say how to fix the problem.

## Where this fits in a real system

A **GitHub Actions** or **Jenkins** pipeline runs `terraform fmt -check`, `validate` and `test` on every pull request, then `plan -out`, the policy checks (OPA/Conftest, or Sentinel in HCP Terraform), and only then a reviewed `apply`. The same "test the logic, enforce rules on the result" split appears with **Kubernetes** admission policies and in **GitHub Actions** required checks.
