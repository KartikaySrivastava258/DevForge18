---
id: terraform-variables-outputs-state
title: Variables, validation, outputs and state
track: terraform
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [terraform-first-configuration]
learning_objectives:
  - Parameterise a configuration with typed variables and defaults.
  - Reject bad input early with validation rules.
  - Explain the difference between updating and replacing a resource in a plan.
  - Explain what the state file contains and how to protect it.
resources:
  - title: Install Terraform
    url: https://developer.hashicorp.com/terraform/install
    publisher: HashiCorp
    type: documentation
    level: beginner
    official: true
    why: Official installers and package-manager instructions for Windows, macOS and Linux.
    verification: { status: unverified }
  - title: Terraform releases on GitHub
    url: https://github.com/hashicorp/terraform/releases
    publisher: HashiCorp
    type: reference
    level: all
    official: true
    why: Every release with its changelog — check it before choosing or upgrading a version.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: replace
    prompt: A plan says "must be replaced" and "1 to add, 0 to change, 1 to destroy". What will happen?
    options:
      - { id: a, text: "The existing resource is edited in place" }
      - { id: b, text: "Terraform will destroy the existing resource and create a new one, because the changed attribute cannot be updated in place" }
      - { id: c, text: "Nothing; replacement is only a warning" }
    answer: b
    explanation: Some attributes can be changed in place; others force replacement. For a file that is harmless, but replacing a database or a disk can mean losing data — which is why reading the plan matters.
  - id: validation
    prompt: Why add a validation block to a variable instead of letting the provider reject bad values?
    options:
      - { id: a, text: "Validation makes Terraform faster" }
      - { id: b, text: "It stops a bad value at plan time with a clear, project-specific message, before anything is created or changed" }
      - { id: c, text: "Providers never check values" }
    answer: b
    explanation: Validation turns "the cloud API failed halfway through an apply" into "your input is wrong, here is the rule" before anything happens.
  - id: state-secrets
    prompt: Why must terraform.tfstate never be committed to Git?
    options:
      - { id: a, text: "It is too large for Git" }
      - { id: b, text: "It records every managed value in plain text — which can include passwords and keys — and it must have a single, locked copy shared by the team, not one per clone" }
      - { id: c, text: "Terraform deletes it after each run" }
    answer: b
    explanation: State is both sensitive and authoritative. Teams keep it in a remote backend with encryption, access control and locking, so two people cannot apply at once.
verification:
  method: pending
  details: Every command is run automatically in CI with Terraform 1.15.6 and the hashicorp/local provider, after the previous lesson. The expected output was written from the Terraform documentation and has not yet been confirmed by a test run.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Variables** make one configuration reusable, **validation** rejects bad input before anything changes, **outputs** report results, and the **state** file is Terraform's record of everything it manages.

## Explain it like I'm twelve

A cake recipe with blanks: "a cake for ___ people, flavour ___". The blanks are variables, and the recipe has rules — "people must be between 1 and 50" — checked before you start baking. When you finish, you write down exactly which cakes you made and where they are: that notebook is the state.

Where the analogy breaks: losing the notebook is serious. Without state, Terraform no longer knows which resources it owns.

## What problem it solves

Copying a configuration for every course, team or environment produces many slightly different files that drift apart. Variables keep one definition with different inputs. Validation catches mistakes early. Understanding state explains why teams treat it carefully and store it centrally.

## How it works

```text
 variables.tf ──▶ var.course_code, var.student_count  (typed, validated, defaults)
       │
 main.tf ─────▶ resource "local_file" "summary" { filename = …var.course_code… }
       │
 terraform.tfstate ◀── apply records every attribute of every managed resource
       │
 outputs ──────▶ summary_file = "./cs101.txt"
```

Values can come from defaults, `-var` on the command line, `*.tfvars` files or `TF_VAR_name` environment variables.

## Try it yourself

> **Local lab** — continue in `terraform-lab` from the previous lesson. Every command is run automatically in DevForge's CI with Terraform 1.15.6; see the note at the top for the current verification status. Parts of Terraform's output that vary are shown as `…`.

### 1. Declare variables with validation

```bash run
cat > variables.tf <<'EOF'
variable "course_code" {
  type        = string
  description = "Course code used in the file name and content."
  default     = "CS101"

  validation {
    condition     = can(regex("^[A-Z]{2}[0-9]{3}$", var.course_code))
    error_message = "Course code must look like CS101: two capital letters and three digits."
  }
}

variable "student_count" {
  type        = number
  description = "Number of enrolled students."
  default     = 30

  validation {
    condition     = var.student_count >= 1 && var.student_count <= 500
    error_message = "Student count must be between 1 and 500."
  }
}
EOF
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

resource "local_file" "summary" {
  filename = "${path.module}/${lower(var.course_code)}.txt"
  content  = "${var.course_code} has ${var.student_count} students.\n"
}

output "summary_file" {
  value = local_file.summary.filename
}
EOF
terraform fmt -check
terraform validate -no-color
```

```text output
Success! The configuration is valid.
```

### 2. Apply with the defaults

```bash run
terraform apply -auto-approve -no-color
cat cs101.txt
```

```text output
…
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.

Outputs:

summary_file = "./cs101.txt"
CS101 has 30 students.
```

### 3. Change an input and read the plan

```bash run
terraform plan -no-color -var student_count=45
```

```text output
…
  # local_file.summary must be replaced
…
Plan: 1 to add, 0 to change, 1 to destroy.
…
```

The `local_file` resource cannot edit a file's content in place, so a new value means destroy-then-create. For a text file that is harmless; for a database it could mean losing data. Always read whether a plan updates (`~`) or replaces (`-/+`).

### 4. Let validation stop bad input

```bash run fails
terraform plan -no-color -var course_code=cs-101
```

```text output
…
…Error: Invalid value for variable
…
…Course code must look like CS101: two capital letters and three digits.
…
```

Nothing was planned or changed: the rule stopped it first, with your own message.

### 5. Look at the state

```bash run
terraform state list
terraform output -raw summary_file
echo
grep -o '"content": "[^"]*"' terraform.tfstate
```

```text output
local_file.summary
./cs101.txt
"content": "CS101 has 30 students.\n"
```

`state list` shows what Terraform manages; `output -raw` prints an output without quotes, handy in scripts. The last line proves the point of this section: **the state file contains resource values in plain text.** If a resource had a password, it would be there too. So in team projects:

- keep state in a **remote backend** (for example an object-storage bucket or HCP Terraform) with encryption and access control;
- use **state locking**, so two people cannot apply at the same time;
- never commit `terraform.tfstate`. A typical `.gitignore` for Terraform contains `.terraform/`, `*.tfstate` and `*.tfstate.*` — while `.terraform.lock.hcl` **is** committed.

### 6. Clean up

```bash run
terraform destroy -auto-approve -no-color
```

```text output
…
Destroy complete! Resources: 1 destroyed.
```

## Common mistakes

- **Committing state or `*.tfvars` files containing secrets.** Pass secrets through environment variables or a secret manager, and mark sensitive variables with `sensitive = true` (which hides them in output, but not in state).
- **Ignoring "must be replaced".** Replacement of stateful resources can delete data.
- **Editing the state file by hand.** Use `terraform state` commands, and back up first.
- **One giant configuration for everything.** Split by environment or component so a mistake has a small blast radius.
- **No validation.** Errors then surface halfway through an apply, from a cloud API, with a less helpful message.

## Where this fits in a real system

The same pattern scales to real infrastructure: variables per environment, a remote backend with locking, and CI that posts `terraform plan` on every pull request. Terraform often creates the **Kubernetes** cluster and the managed **PostgreSQL** database, then passes their addresses on as outputs to the deployment pipeline.
