---
id: terraform-import-and-drift
title: Importing existing resources and handling drift
track: terraform
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [terraform-modules-and-refactoring]
learning_objectives:
  - Bring a resource that was created by hand under Terraform's management with an import block, using generated configuration as a starting point.
  - Detect drift — a managed resource changed or deleted outside Terraform — with a refresh-only plan, and decide whether to restore it or accept it.
  - Stop managing a resource without destroying it, with a removed block.
resources:
  - title: Import existing resources
    url: https://developer.hashicorp.com/terraform/language/import
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: The import block, and how importing adds an existing resource to state so Terraform can manage it.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Generating configuration
    url: https://developer.hashicorp.com/terraform/language/import/generating-configuration
    publisher: HashiCorp
    type: documentation
    level: intermediate
    official: true
    why: terraform plan -generate-config-out, and that configuration generation is experimental and may change format.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: removed block reference
    url: https://developer.hashicorp.com/terraform/language/block/removed
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: Removes a resource from state without changing the real infrastructure (lifecycle destroy = false).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: terraform plan — refresh-only mode
    url: https://developer.hashicorp.com/terraform/cli/commands/plan
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: Planning modes, including -refresh-only for reconciling Terraform's records with changes made outside the usual workflow.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker_network resource (kreuzwerker/docker provider)
    url: https://github.com/kreuzwerker/terraform-provider-docker/blob/master/docs/resources/network.md
    publisher: kreuzwerker
    type: reference
    level: intermediate
    official: true
    why: The resource used in the lab, and its import by network ID.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: import-why
    prompt: A database server was created by hand in the console years ago. Why import it instead of writing a resource block and running apply?
    options:
      - { id: a, text: "There is no difference" }
      - { id: b, text: "Without importing, Terraform's state does not know the server exists, so apply would try to create a second one (or fail on a name clash)" }
      - { id: c, text: "Import makes the server faster" }
    answer: b
    explanation: Import links the existing object to a resource address in state. From then on, Terraform plans changes against the real server instead of creating a new one.
  - id: generated
    prompt: terraform plan -generate-config-out wrote generated.tf. What should you do with it?
    options:
      - { id: a, text: "Commit it unchanged" }
      - { id: b, text: "Review it like any code: keep the arguments you mean to manage, remove values that are only defaults or were assigned automatically, then check that the plan shows no changes" }
      - { id: c, text: "Delete it; it is only a log" }
    answer: b
    explanation: Generation is experimental and copies every attribute it reads. The lab trims it to the name and label, and the plan still shows no changes.
  - id: drift
    prompt: Someone deleted a Terraform-managed network by hand. What does a normal terraform plan propose, and what does -refresh-only do?
    options:
      - { id: a, text: "Both do nothing" }
      - { id: b, text: "A normal plan proposes creating it again, to match the configuration; -refresh-only only shows what changed outside Terraform and would update the state to match, without changing infrastructure" }
      - { id: c, text: "A normal plan deletes the configuration" }
    answer: b
    explanation: Decide which side is right. If the hand change was a mistake, apply restores the configuration; if it was intended, change the configuration (or use refresh-only, then update the code) so they agree.
verification:
  method: executed
  details: Every command is run by the test suite with Terraform 1.15.6 and the kreuzwerker/docker provider 4.6.0 on a disposable Docker engine, after the previous lessons, and its output is compared with this lesson. Import, removed blocks and refresh-only mode were checked against HashiCorp's documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Real infrastructure is rarely all created by Terraform: **import** brings resources made by hand under management, **drift** is what you call it when reality and Terraform's records disagree, and a **removed** block lets Terraform let go of a resource without deleting it.

## Explain it like I'm twelve

A school library starts keeping a catalogue. Books bought before the catalogue existed are already on the shelves — you add them to the catalogue rather than buying them again (**import**). If a pupil takes a book home without signing it out, the catalogue and the shelf disagree (**drift**): either fetch the book back, or update the catalogue. And when a book is donated to another school, you cross it out of the catalogue without destroying the book (**removed**).

Where the analogy breaks: Terraform only notices drift when it next looks — during a plan.

## What problem it solves

Teams adopt Terraform with infrastructure already running, made in a console or by scripts. Rewriting it from scratch is risky; recreating it causes outages. Import adopts it safely. And even with Terraform in place, people make emergency changes by hand — the next plan must reveal them, so the team decides deliberately which version wins.

## How it works

![](media:terraform/import-drift.svg)

- An `import` block (Terraform 1.5 and later) names a resource address (`to`) and the real object's ID (`id`). The import happens during plan and apply, so it is reviewed like any other change.
- `terraform plan -generate-config-out=generated.tf` writes a starting configuration for imported resources that have none. It is experimental; treat it as a draft.
- Every plan first **refreshes**: it reads the real objects and compares them with state. `-refresh-only` shows only those differences and, if applied, updates state without changing infrastructure.
- A `removed` block with `lifecycle { destroy = false }` drops a resource from state and leaves the real object alone.

## Try it yourself

> **Local lab** — needs Terraform and Docker. It manages a Docker network, so nothing in the cloud is involved; `terraform init` downloads the `kreuzwerker/docker` provider. Every command is run automatically in DevForge's tests, and the last step removes what you create.

### 1. Something created by hand

```bash run
mkdir -p tf-import-lab && cd tf-import-lab
docker network create devforge-legacy-net --label owner=ops > /dev/null
docker network ls --filter name=devforge-legacy-net --format '{{.Name}} (driver {{.Driver}})'
```

```text output
devforge-legacy-net (driver bridge)
```

Imagine a colleague made this network by hand months ago, and applications depend on it. Deleting and recreating it would break them.

### 2. Import it, with generated configuration as a draft

```bash run
cat > main.tf <<EOF
terraform {
  required_providers {
    docker = { source = "kreuzwerker/docker", version = "4.6.0" }
  }
}

provider "docker" {}

import {
  to = docker_network.legacy
  id = "$(docker network inspect -f '{{.Id}}' devforge-legacy-net)"
}
EOF
terraform init -no-color -input=false > init.log 2>&1 || { cat init.log; exit 1; }
terraform plan -no-color -input=false -generate-config-out=generated.tf > plan.log 2>&1 || { cat plan.log; exit 1; }
grep -E '^Plan:|^Warning: Config generation' plan.log
grep -E '^ *(name|driver|subnet) *=|label|value' generated.tf
```

```text output
Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.
Warning: Config generation is experimental
  driver       = "bridge"
  name         = "devforge-legacy-net"
    subnet      = "…"
  labels {
    label = "owner"
    value = "ops"
```

- The `import` block uses the network's real ID, read with `docker network inspect` (the heredoc is unquoted, so the shell fills it in).
- Terraform read the network and wrote **every** attribute it found into `generated.tf` — including the subnet Docker happened to assign (shown as `…`, because it differs between machines).

### 3. Review the draft, then apply

Keep only what you mean to manage, and confirm that the plan still shows no changes:

```bash run
cat > generated.tf <<'EOF'
# Adopted from a network made by hand; reviewed and trimmed from Terraform's generated draft.
resource "docker_network" "legacy" {
  name = "devforge-legacy-net"
  labels {
    label = "owner"
    value = "ops"
  }
}
EOF
terraform plan -no-color -input=false | grep '^Plan:'
terraform apply -no-color -auto-approve -input=false | tail -n 1
terraform state list
```

```text output
Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.
Apply complete! Resources: 1 imported, 0 added, 0 changed, 0 destroyed.
docker_network.legacy
```

`1 imported, 0 added` — the existing network is now in state, and nothing was recreated. The `import` block has done its job; it can stay (importing an object that is already in state does nothing) or be deleted.

```bash run
terraform plan -no-color -input=false | tail -n 1
```

```text output
…no changes are needed.
```

### 4. Drift: a change made outside Terraform

Someone removes the network by hand during an incident:

```bash run
docker network rm devforge-legacy-net > /dev/null
terraform plan -no-color -input=false -refresh-only | grep -E 'changed outside of Terraform|has been deleted'
terraform plan -no-color -input=false | grep -E 'will be created|^Plan:'
```

```text output
Note: Objects have changed outside of Terraform
  # docker_network.legacy has been deleted
  # docker_network.legacy will be created
Plan: 1 to add, 0 to change, 0 to destroy.
```

- `-refresh-only` reports the difference between state and reality and proposes only to update state.
- A normal plan proposes making reality match the configuration again. Which one is right is a team decision: was the hand change a mistake, or should the code change too?

Here it was a mistake, so restore it:

```bash run
terraform apply -no-color -auto-approve -input=false | tail -n 1
docker network inspect -f '{{.Name}} (label owner={{index .Labels "owner"}})' devforge-legacy-net
```

```text output
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
devforge-legacy-net (label owner=ops)
```

### 5. Let go without destroying

Another team takes over the network. Remove it from this configuration, but keep it running:

```bash run
rm generated.tf
cat >> main.tf <<'EOF'

removed {
  from = docker_network.legacy
  lifecycle {
    destroy = false
  }
}
EOF
sed -i '/^import {/,/^}/d' main.tf
terraform plan -no-color -input=false | grep -E 'no longer be managed|^Plan:'
terraform apply -no-color -auto-approve -input=false | tail -n 1
echo "resources in state: $(terraform state list | wc -l | tr -d ' ')"
docker network ls --filter name=devforge-legacy-net --format '{{.Name}} still exists'
```

```text output
 # docker_network.legacy will no longer be managed by Terraform, but will not be destroyed
Plan: 0 to add, 0 to change, 0 to destroy.
Warning: Some objects will no longer be managed by Terraform
Apply complete! Resources: 0 added, 0 changed, 0 destroyed.
resources in state: 0
devforge-legacy-net still exists
```

Simply deleting the resource block would have planned to **destroy** the network. The `removed` block makes the intention explicit and reviewable.

### 6. Clean up

```bash run
docker network rm devforge-legacy-net
```

```text output
devforge-legacy-net
```

## Common mistakes

- **Writing a resource block for something that exists, and applying.** Terraform tries to create a second one. Import first.
- **Committing generated configuration unreviewed.** It contains defaults and machine-assigned values; trim it and confirm a clean plan.
- **"Fixing" drift by habit.** Applying always restores the configuration — which may undo a deliberate emergency fix. Find out why it drifted.
- **Deleting a resource block to stop managing something.** That plans a destroy. Use a `removed` block with `destroy = false`.
- **Only noticing drift at the next change.** Run scheduled plans (for example nightly in CI) and alert when they are not empty.

## Where this fits in a real system

Teams adopting Terraform import existing cloud networks, databases and DNS records one group at a time. A **GitHub Actions** or **Jenkins** job runs `terraform plan` on a schedule and alerts when drift appears, and **Prometheus** can alert on the result. The same adopt-then-manage idea applies to **Kubernetes** objects created by hand with `kubectl` before a cluster's configuration moved into code.
