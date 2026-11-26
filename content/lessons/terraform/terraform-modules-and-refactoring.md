---
id: terraform-modules-and-refactoring
title: Modules, reuse and safe refactoring
track: terraform
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [terraform-variables-outputs-state]
learning_objectives:
  - Write a child module with inputs and outputs, and call it more than once from the root module.
  - Read a plan that would destroy and re-create a resource after a refactor, and explain why.
  - Use a moved block so that moving a resource into a module changes no real infrastructure.
resources:
  - title: Modules overview
    url: https://developer.hashicorp.com/terraform/language/modules
    publisher: HashiCorp
    type: documentation
    level: beginner
    official: true
    why: What modules are, and the root module versus child modules.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Refactoring modules (moved blocks)
    url: https://developer.hashicorp.com/terraform/language/modules/develop/refactoring
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: Why a changed address means destroy-and-create by default, how moved blocks prevent it, and why to keep them.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-destroy
    prompt: You move a resource into a module and change nothing else. Why does the plan want to destroy it and create a new one?
    options:
      - { id: a, text: "The provider is broken" }
      - { id: b, text: "Its address changed (local_file.cs101 became module.cs101.local_file.roster); by default Terraform treats a new address as a new object and the old address as one to remove" }
      - { id: c, text: "Modules always re-create their resources" }
    answer: b
    explanation: Terraform tracks objects by address. The documentation says that by default it interprets the change as an instruction to destroy the existing resource and create a new one — unless a moved block tells it the object only changed address.
  - id: moved-keep
    prompt: After everyone has applied your refactor, can you delete the moved block?
    options:
      - { id: a, text: "Always, right away" }
      - { id: b, text: "For a shared module, keep it — others may still upgrade from the old version; in a private configuration, only once you are sure every copy of the state has been applied" }
      - { id: c, text: "Never write moved blocks in the first place" }
    answer: b
    explanation: HashiCorp strongly recommends keeping historical moved blocks, and says removing them can be safe only once all users of a private module have applied the change.
  - id: reuse
    prompt: What is the main benefit of calling the same module twice instead of copying its resources?
    options:
      - { id: a, text: "Terraform runs faster" }
      - { id: b, text: "One definition, many uses: a fix or improvement in the module reaches every place that calls it, and each call only states what is different" }
      - { id: c, text: "Modules do not need state" }
    answer: b
    explanation: In the lesson, a second course costs four lines; both files come from the same module code.
verification:
  method: executed
  details: Every command is run by the test suite with Terraform 1.15.6 (checksum-verified) and the hashicorp/local provider, after the previous lessons; the output shown was recorded from that run. Facts about modules, moved blocks and plans were checked against HashiCorp's documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **module** is a folder of Terraform code with **inputs** and **outputs** that other code can call — so the same resources can be reused with different values — and when you move existing resources into a module, a **`moved` block** tells Terraform the objects only changed **address**, so nothing real is destroyed.

## Explain it like I'm twelve

A recipe card for "class roster" says: give me a course code and a number of students, and I will make a roster sheet. Instead of writing out the steps again for every course, you hand the card the details — CS101, 30; DB201, 25 — and get a sheet each time.

The recipe card is a **module**, the details you hand it are **inputs**, and the sheets are its **resources**.

Where the analogy breaks: Terraform remembers each sheet by where it came from. If you start making an existing sheet "through the card", you must tell Terraform it is the same sheet — or it will throw the old one away and make a new one.

## What problem it solves

Copy-pasting the same resources for every environment or team means every fix must be made in many places, and they drift apart. Modules give one definition with many uses. But real configurations grow and get reorganised — and in Terraform a reorganisation changes resource addresses, which by default means destroy-and-create. `moved` blocks make refactoring safe.

## How it works

![](media:terraform/module-moved.svg)

- The folder you run Terraform in is the **root module**; modules it calls with `module` blocks are **child modules**. A local module's `source` starts with `./` or `../`, and `terraform init` must run after a module's source is added or changed.
- Inside a module, `variable` blocks are its inputs and `output` blocks its outputs. Resources inside it get addresses such as `module.cs101.local_file.roster`.
- Terraform tracks every real object by its address in the state. If the address in the configuration changes, it plans to destroy the object at the old address and create one at the new address.
- A `moved` block (`from` the old address, `to` the new one) records the move instead: the plan updates the state's address and destroys nothing.

## Try it yourself

> **Local lab** — needs Terraform, as in the previous lessons; the `hashicorp/local` provider writes files on your computer, so nothing in the cloud is involved. Every command is run automatically in DevForge's tests.

### 1. Start with one resource

```bash run
mkdir -p terraform-modules && cd terraform-modules
cat > main.tf <<'EOF'
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "local_file" "cs101" {
  filename = "${path.root}/rosters/cs101.txt"
  content  = "CS101: 30 students\n"
}
EOF
terraform init -no-color > /dev/null
terraform apply -auto-approve -no-color | tail -n 1
```

```text output
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

One roster file, managed at the address `local_file.cs101`.

### 2. Turn it into a module

```bash run
mkdir -p modules/course
cat > modules/course/main.tf <<'EOF'
variable "code" {
  type = string
}

variable "students" {
  type = number
}

resource "local_file" "roster" {
  filename = "${path.root}/rosters/${lower(var.code)}.txt"
  content  = "${var.code}: ${var.students} students\n"
}

output "file" {
  value = local_file.roster.filename
}
EOF
cat > main.tf <<'EOF'
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

module "cs101" {
  source   = "./modules/course"
  code     = "CS101"
  students = 30
}
EOF
terraform init -no-color > /dev/null
terraform plan -no-color | grep -E '^  # |^Plan:'
```

```text output
  # local_file.cs101 will be destroyed
  # (because local_file.cs101 is not in configuration)
  # module.cs101.local_file.roster will be created
Plan: 1 to add, 0 to change, 1 to destroy.
```

- The module takes two inputs, `code` and `students`, and writes the same file as before. The file name uses `path.root` (the root module's folder): HashiCorp advises against `path.module` for things a module writes.
- The real file would be identical — yet the plan wants to **destroy** it and **create** it again, because its address changed from `local_file.cs101` to `module.cs101.local_file.roster`. For a file that is harmless; for a database it could lose data. Do not apply this.

### 3. Tell Terraform it moved

```bash run
cat >> main.tf <<'EOF'

moved {
  from = local_file.cs101
  to   = module.cs101.local_file.roster
}
EOF
terraform plan -no-color | grep -E '^  # |^Plan:'
terraform apply -auto-approve -no-color | tail -n 1
terraform state list
```

```text output
  # local_file.cs101 has moved to module.cs101.local_file.roster
Plan: 0 to add, 0 to change, 0 to destroy.
Apply complete! Resources: 0 added, 0 changed, 0 destroyed.
module.cs101.local_file.roster
```

- With the `moved` block, the plan only records the new address: nothing is added, changed or destroyed.
- `terraform state list` shows the object under its new address. Keep the `moved` block in the code — HashiCorp recommends keeping historical moves so every copy of the state can follow them.

### 4. Reuse the module

```bash run
cat >> main.tf <<'EOF'

module "db201" {
  source   = "./modules/course"
  code     = "DB201"
  students = 25
}

output "rosters" {
  value = [module.cs101.file, module.db201.file]
}
EOF
terraform init -no-color > /dev/null
terraform apply -auto-approve -no-color | tail -n 8
cat rosters/*.txt
```

```text output
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.

Outputs:

rosters = [
  "./rosters/cs101.txt",
  "./rosters/db201.txt",
]
CS101: 30 students
DB201: 25 students
```

A second course is four lines: the module does the rest — one file added, nothing else touched. Both files come from the same module code, so a change to the module — say, a new line in the roster — would reach both.

### 5. Clean up

```bash run
terraform destroy -auto-approve -no-color | tail -n 1
```

```text output
Destroy complete! Resources: 2 destroyed.
```

## Try it in the simulation

Edit the configuration, change things "by hand" in the real world, and watch the plan: every line shows its symbol (`+`, `-`, `~`, `-/+`) and why. Rename a resource and keep the real server. It is a labelled teaching model with an invented resource type, not Terraform itself.

```simulation terraform-plan-diff scenario=rename
```

## Common mistakes

- **Renaming resources or moving them into modules without `moved` blocks.** Always read the plan: a `-` and `+` pair where you expected nothing means objects would be destroyed.
- **Deleting `moved` blocks right after applying.** Other copies of the state (colleagues, CI, other environments) still need them.
- **Modules that are just one resource with every argument passed through.** A module should hide detail behind a few meaningful inputs.
- **Forgetting `terraform init` after adding a module** — Terraform cannot plan with a module it has not installed.
- **Hard-coding values inside modules** that callers need to change; make them inputs with sensible defaults.

## Where this fits in a real system

Teams keep shared modules — a network, a database, a **Kubernetes** cluster — and call them once per environment. Plans run in **GitHub Actions** or **Jenkins** on every pull request so reviewers can see any `-` before it happens, and a refactor ships with its `moved` blocks in the same commit.
