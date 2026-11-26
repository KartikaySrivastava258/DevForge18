---
id: terraform-in-ci-with-plan-review
title: Terraform in CI with plan review
track: terraform
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [terraform-testing-and-policy]
learning_objectives:
  - Use plan's detailed exit codes to tell "no changes", "changes" and "error" apart in a script.
  - Publish a short plan summary for reviewers, and apply exactly the plan that was reviewed.
  - Show why a saved plan is refused once the state has changed, and why that protects you.
  - Write a GitHub Actions workflow that tests and plans on pull requests and applies a saved plan after approval.
resources:
  - title: terraform plan (-detailed-exitcode, -out)
    url: https://developer.hashicorp.com/terraform/cli/commands/plan
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: Exit codes 0, 1 and 2 with -detailed-exitcode; saved plans, and the warning that plan files hold sensitive values in cleartext.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Running Terraform in automation
    url: https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform
    publisher: HashiCorp
    type: tutorial
    level: advanced
    official: true
    why: The plan-review-apply workflow, TF_IN_AUTOMATION, and how saved plans move between steps.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Environment variables (TF_IN_AUTOMATION)
    url: https://developer.hashicorp.com/terraform/cli/config/environment-variables
    publisher: HashiCorp
    type: reference
    level: intermediate
    official: true
    why: TF_IN_AUTOMATION stops Terraform suggesting commands to run next, which would confuse readers of CI logs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: hashicorp/setup-terraform
    url: https://github.com/hashicorp/setup-terraform
    publisher: HashiCorp
    type: source-code
    level: intermediate
    official: true
    why: The action that installs a pinned Terraform version in GitHub Actions (inputs terraform_version and terraform_wrapper).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Workflow commands — job summaries (GITHUB_STEP_SUMMARY)
    url: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
    publisher: GitHub
    type: reference
    level: intermediate
    official: true
    why: Writing Markdown to the file in GITHUB_STEP_SUMMARY shows it on the run's summary page.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: exit-codes
    prompt: In CI, terraform plan -detailed-exitcode exits with 2. What does that mean?
    options:
      - { id: a, text: "The plan failed" }
      - { id: b, text: "The plan succeeded and contains changes — a script must treat 2 as success, and only 1 as an error" }
      - { id: c, text: "Two resources changed" }
    answer: b
    explanation: 0 means no changes, 1 an error, 2 changes. Scripts that treat every non-zero code as failure break on the very runs that matter.
  - id: saved-plan
    prompt: Why apply the saved plan file instead of running terraform apply again after approval?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "A fresh apply makes a new plan, which may differ from the one reviewers approved; the saved plan applies exactly what was reviewed — or is refused if the state changed meanwhile" }
      - { id: c, text: "Fresh applies are not allowed in CI" }
    answer: b
    explanation: The lab shows Terraform refusing a stale saved plan. That is the safety catch — plan again and review again.
  - id: plan-artifact
    prompt: What must you remember about the saved plan file you upload as an artifact?
    options:
      - { id: a, text: "Nothing, it is just a diff" }
      - { id: b, text: "It holds the full configuration and all planned values in cleartext, including sensitive ones; keep its retention short and its access restricted" }
      - { id: c, text: "It must be committed to the repository" }
    answer: b
    explanation: HashiCorp's plan documentation says to treat saved plans as potentially sensitive artifacts. The workflow keeps it for one day.
verification:
  method: executed
  details: Every local command is run by the test suite with Terraform 1.15.6 and the hashicorp/local provider, after the previous lessons, and its output is compared with this lesson. The workflow file is checked by DevForge's workflow checker (structure, pinned actions, permissions, script injection); it is not run on GitHub here, because applying for real needs a remote backend and cloud credentials. Action inputs were checked against each action's action.yml on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

In a team, Terraform runs in CI: every pull request is **tested and planned**, people **review the plan**, and after approval CI **applies exactly that saved plan** — which Terraform refuses if anything changed in between.

## Explain it like I'm twelve

Before rearranging the classroom, the class monitor draws the new layout and the teacher signs it. The caretaker then moves the desks *exactly* as on the signed drawing. If someone has already moved desks since the drawing was made, the caretaker stops and asks for a new drawing rather than guessing.

The drawing is the **saved plan**, the signature is the **review**, and stopping is Terraform refusing a **stale plan**.

Where the analogy breaks: Terraform checks for changes itself, using the state's serial number, so nobody has to notice.

## What problem it solves

Applying from laptops means unreviewed changes, different Terraform versions, credentials on personal machines and no record of who changed what. CI gives one controlled place with pinned versions and the only credentials; pull requests give review; and saved plans make sure what was approved is what happens.

## How it works

![](media:terraform/ci-plan-review.svg)

- `terraform plan -detailed-exitcode` exits `0` (no changes), `1` (error) or `2` (changes).
- `-out=tfplan` saves the plan; `terraform show tfplan` prints it for reviewers; `terraform apply tfplan` applies it without asking again.
- A saved plan records the state it was made from. If another operation has changed the state since, apply stops with **"Saved plan is stale"**.
- `TF_IN_AUTOMATION=1` stops Terraform suggesting commands to type next; `-input=false` makes it fail instead of waiting for input that will never come.

## Try it yourself

> **Local lab** — needs Terraform (as in the previous lessons). You run the same commands a CI job would, on your own computer; the last step writes a GitHub Actions workflow that DevForge's tests check but do not run. Every command is run automatically in DevForge's tests.

### 1. A configuration, and plan's three exit codes

```bash run
mkdir -p tf-ci-lab/infra && cd tf-ci-lab/infra
export TF_IN_AUTOMATION=1
cat > main.tf <<'EOF'
terraform {
  required_providers {
    local = { source = "hashicorp/local", version = "~> 2.5" }
  }
}

variable "message" {
  type    = string
  default = "Library opens at 9:00"
}

resource "local_file" "notice" {
  filename        = "${path.root}/out/notice.txt"
  content         = "${var.message}\n"
  file_permission = "0644"
}
EOF
terraform init -no-color -input=false > /dev/null
plan_code() { local code=0; terraform plan -no-color -input=false -detailed-exitcode "$@" > plan.txt 2>&1 || code=$?; echo "$code"; }
echo "plan with changes:   exit $(plan_code)"
echo "undeclared variable: exit $(plan_code -var nonexistent=1)"
```

```text output
plan with changes:   exit 2
undeclared variable: exit 1
```

`2` means "succeeded, with changes" — not an error. A CI script must treat `1` as failure and `2` as "changes to review". (`plan_code` saves the output in `plan.txt` and prints only the exit code; it runs plan in place of `set -e`, so the non-zero codes do not stop the script.)

### 2. What the reviewer sees, and applying exactly that

```bash run
echo "plan for review:     exit $(plan_code -out=tfplan)"
terraform show -no-color tfplan | grep -E '^  # |^Plan:'
terraform apply -no-color -input=false tfplan | tail -n 1
echo "after apply:         exit $(plan_code)"
```

```text output
plan for review:     exit 2
  # local_file.notice will be created
Plan: 1 to add, 0 to change, 0 to destroy.
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
after apply:         exit 0
```

The summary lines are what a pull request comment or job summary shows. `terraform apply tfplan` did not plan again or ask for confirmation: the file *is* the approved change. Afterwards, plan exits `0` — nothing left to do.

### 3. A stale plan is refused

Two pull requests are planned against the same state. The second one is approved and applied first:

```bash run
terraform plan -no-color -input=false -var 'message=Library opens at 8:30' -out=pr-a.tfplan > /dev/null
terraform plan -no-color -input=false -var 'message=Library closed on Friday' -out=pr-b.tfplan > /dev/null
terraform apply -no-color -input=false pr-b.tfplan | tail -n 1
```

```text output
Apply complete! Resources: 1 added, 0 changed, 1 destroyed.
```

```bash run fails
terraform apply -no-color -input=false pr-a.tfplan
```

```text output

Error: Saved plan is stale

The given plan file can no longer be applied because the state was changed by
another operation after the plan was created.
```

```bash run
cat out/notice.txt
```

```text output
Library closed on Friday
```

Plan A was made from a state that no longer exists. Applying it anyway could undo B's change without anyone having reviewed that. Terraform refuses; the pipeline must plan again, and people review again.

### 4. The workflow

```bash run
cd ..
mkdir -p .github/workflows
cat > .github/workflows/terraform.yml <<'EOF'
name: Terraform

on:
  pull_request:
    paths: ["infra/**"]
  push:
    branches: [main]
    paths: ["infra/**"]

permissions:
  contents: read

# Never run two applies at once; queue them instead of cancelling one half-way.
concurrency:
  group: terraform-production
  cancel-in-progress: false

env:
  TF_IN_AUTOMATION: "1"

jobs:
  plan:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v7
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: "1.15.6"
          terraform_wrapper: false
      - run: terraform fmt -check -recursive
      - run: terraform init -input=false
      - run: terraform validate -no-color
      - run: terraform test -no-color
      - name: Plan, and summarise it for reviewers
        run: |
          code=0
          terraform plan -input=false -no-color -lock-timeout=5m -detailed-exitcode -out=tfplan > plan.txt || code=$?
          if [ "$code" -eq 1 ]; then cat plan.txt; exit 1; fi
          {
            echo "### Terraform plan"
            echo '```'
            grep -E '^  # |^Plan:|^No changes' plan.txt || true
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"
      # The saved plan holds every planned value in cleartext: keep it briefly, and only for main.
      - uses: actions/upload-artifact@v7
        if: github.event_name == 'push'
        with:
          name: tfplan
          path: infra/tfplan
          retention-days: 1

  apply:
    if: github.event_name == 'push'
    needs: plan
    runs-on: ubuntu-24.04
    # Required reviewers on this environment approve the plan before this job starts.
    environment: production
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v7
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: "1.15.6"
          terraform_wrapper: false
      - run: terraform init -input=false
      - uses: actions/download-artifact@v8
        with:
          name: tfplan
          path: infra
      - run: terraform apply -input=false -no-color tfplan
EOF
sed -n '/^jobs:/,$p' .github/workflows/terraform.yml | grep -E '^  [a-z]+:'
```

```text output
  plan:
  apply:
```

- **Pull requests**: format, validate, test and plan; the summary appears on the run page for reviewers. Nothing is applied.
- **Merges to `main`**: plan again from `main`, upload the saved plan, wait for approval on the `production` environment, then apply *that file*. If something changed meanwhile, the apply fails as in step 3, safely.
- Not shown, but required for real use: a **remote backend** with locking (lesson 4), and cloud credentials from the environment — preferably short-lived OIDC tokens rather than stored keys.

## Common mistakes

- **Treating exit code 2 as failure** — or every non-zero code as success.
- **`terraform apply -auto-approve` after approval.** It plans again; what runs may not be what was reviewed. Apply the saved plan.
- **Local state in CI.** The runner is thrown away after the job, and the state with it. Use a remote backend.
- **Plan files kept for weeks, or shared widely.** They contain secrets in cleartext.
- **Parallel applies.** Use a concurrency group and the backend's lock; never cancel an apply half-way.
- **Long-lived cloud keys in repository secrets.** Prefer OIDC federation, scoped to the workflow and environment.

## Where this fits in a real system

This is **GitHub Actions** environments and required reviewers (from the GitHub Actions track) applied to infrastructure; **Jenkins** pipelines follow the same plan → approve → apply-saved-plan shape with an input step. The policy checks from the previous lesson run between plan and approval, and the same pattern — review a diff, apply exactly it — is how teams change **Kubernetes** manifests through GitOps.
