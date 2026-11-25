---
id: terraform-first-configuration
title: Your first configuration — init, plan, apply, destroy
track: terraform
order: 1
level: beginner
estimated_minutes: 35
prerequisites: []
learning_objectives:
  - Explain what Infrastructure as Code is and why declaring the desired state is safer than clicking.
  - Write a configuration with a provider, a resource and an output.
  - Use init, fmt, validate, plan, apply and destroy, and read what each one reports.
  - Explain why a second plan shows "No changes" and why that matters.
resources:
  - title: Install Terraform
    url: https://developer.hashicorp.com/terraform/install
    publisher: HashiCorp
    type: documentation
    level: beginner
    official: true
    why: Official installers and package-manager instructions for Windows, macOS and Linux.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Terraform releases on GitHub
    url: https://github.com/hashicorp/terraform/releases
    publisher: HashiCorp
    type: reference
    level: all
    official: true
    why: Every release with its changelog — check it before choosing or upgrading a version.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: plan-before-apply
    prompt: Why run terraform plan before terraform apply?
    options:
      - { id: a, text: "plan downloads the providers that apply needs" }
      - { id: b, text: "plan shows exactly what Terraform will create, change or destroy, without changing anything, so a person (or a reviewer) can check it first" }
      - { id: c, text: "apply refuses to run without a saved plan" }
    answer: b
    explanation: A plan is a preview. In teams, plans are posted on pull requests so reviewers see the real effect of a change — especially any "destroy" — before it happens.
  - id: no-changes
    prompt: You run terraform plan straight after a successful apply and it says "No changes." What does that tell you?
    options:
      - { id: a, text: "Terraform failed to read the configuration" }
      - { id: b, text: "The real world already matches the configuration, so applying again would do nothing — Terraform is declarative and idempotent" }
      - { id: c, text: "The state file was deleted" }
    answer: b
    explanation: You describe the desired end state, not a list of steps. Running it again converges on the same state instead of creating duplicates — the opposite of re-running a shell script that creates things.
  - id: provider
    prompt: What is a provider?
    options:
      - { id: a, text: "A plugin that teaches Terraform how to manage one kind of system, such as AWS, Kubernetes or local files" }
      - { id: b, text: "The company that sells Terraform" }
      - { id: c, text: "The machine Terraform runs on" }
    answer: a
    explanation: Terraform's core plans and tracks changes; providers translate resources into real API calls. terraform init downloads the providers a configuration needs, at versions allowed by required_providers.
verification:
  method: executed
  details: Every command is run by the test suite with Terraform 1.15.6 (checksum-verified) and the hashicorp/local provider; the documented output was confirmed in CI run 45643638519 on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

**Terraform** lets you describe the infrastructure you want in configuration files; it compares that with what exists, shows you a **plan**, and makes only the changes needed to match.

## Explain it like I'm twelve

Imagine giving a friend a photo of a finished Lego model instead of step-by-step instructions. They look at what is already built, work out which bricks are missing or wrong, tell you their plan ("add three red bricks, remove one blue"), and do it when you say yes. If the model already matches the photo, they do nothing.

Where the analogy breaks: Terraform also writes down exactly what it built (its **state**), so next time it knows which bricks are its own.

## What problem it solves

Infrastructure created by clicking through web consoles cannot be reviewed, repeated or reliably undone, and nobody remembers exactly how the test environment differs from production. With Infrastructure as Code, environments are text files in Git: changes go through pull requests, the plan shows their effect, and the same files create identical copies.

## How it works

```diagram steps=terraform/plan-apply
```


- **Providers** are plugins for each kind of system (here `hashicorp/local`, which manages files, so you need no cloud account).
- **Resources** are the things to manage; **outputs** report values back.
- **State** records what Terraform manages. It is important, and it can contain secrets — the next lesson covers it.
- Terraform is distributed under the Business Source License since version 1.6. **OpenTofu**, a Linux Foundation fork created from Terraform 1.5 in 2023, accepts nearly the same configuration and commands (`tofu` instead of `terraform`).

## Try it yourself

> **Local lab** — creates only a small text file in a lab folder; no cloud account or credentials needed. `terraform init` downloads the provider from the Terraform Registry, so you need internet access. Every command is run automatically in DevForge's CI with Terraform 1.15.6; see the note at the top for the current verification status. Parts of Terraform's output that vary (timings, version notices, provider details) are shown as `…`.

### 1. Install and check Terraform

Follow the official install page linked in the resources (on macOS with Homebrew: `brew tap hashicorp/tap` then `brew install hashicorp/tap/terraform`; Windows and Linux installers are listed there). Then:

```bash run
terraform version
```

```text output
Terraform v1.…
…
```

### 2. Write a configuration

```bash run
mkdir -p terraform-lab
cd terraform-lab
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

resource "local_file" "welcome" {
  filename = "${path.module}/welcome.txt"
  content  = "Hello from Terraform\n"
}

output "file_path" {
  value = local_file.welcome.filename
}
EOF
terraform fmt -check
```

`terraform fmt -check` prints nothing when the file is already in Terraform's standard layout; it lists any file that is not. The `terraform` block pins which Terraform and provider versions may be used — `~> 2.5` means "2.5 or a later 2.x".

### 3. Initialise and validate

```bash run
terraform init -no-color
```

```text output
…
Terraform has been successfully initialized!
…
```

`init` downloaded the `local` provider into `.terraform/` and recorded its exact version and checksums in `.terraform.lock.hcl`. Commit the lock file, so everyone gets the same provider build.

```bash run
terraform validate -no-color
```

```text output
Success! The configuration is valid.
```

### 4. Plan

```bash run
terraform plan -no-color
```

```text output
…
  # local_file.welcome will be created
  + resource "local_file" "welcome" {
…
Plan: 1 to add, 0 to change, 0 to destroy.
…
```

`+` means create. Nothing has changed yet. Read the summary line first: in real infrastructure, an unexpected `destroy` count is the thing to stop for.

### 5. Apply and check the result

```bash run
terraform apply -auto-approve -no-color
cat welcome.txt
```

```text output
…
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.

Outputs:

file_path = "./welcome.txt"
Hello from Terraform
```

`-auto-approve` skips the "Enter a value: yes" prompt, which is convenient in a lab. In real work, review the plan and type `yes` yourself.

### 6. Plan again

```bash run
terraform plan -no-color
```

```text output
…
No changes. Your infrastructure matches the configuration.
…
```

This is what *declarative* means: applying the same configuration again changes nothing.

### 7. Destroy

```bash run
terraform destroy -auto-approve -no-color
test -e welcome.txt || echo "welcome.txt has been removed"
```

```text output
…
Destroy complete! Resources: 1 destroyed.
welcome.txt has been removed
```

Keep the `terraform-lab` folder for the next lesson.

## Common mistakes

- **Applying without reading the plan.** The plan is the safety check; read the `to destroy` count every time.
- **Using `-auto-approve` for real infrastructure.** Keep it for labs and well-reviewed automation.
- **Not pinning provider versions.** A new major provider release can change behaviour; `required_providers` and the lock file keep runs reproducible.
- **Committing `.terraform/`.** It holds downloaded plugins; ignore it. Do commit `.terraform.lock.hcl`.
- **Editing resources by hand after Terraform created them.** Terraform will try to change them back on the next apply, or lose track of them.

## Where this fits in a real system

Terraform usually provisions the foundations everything else runs on — networks, databases, **Kubernetes** clusters and DNS — from a Git repository. **GitHub Actions** or **Jenkins** runs `fmt -check`, `validate` and `plan` on every pull request and posts the plan for review; `apply` runs only after approval.
