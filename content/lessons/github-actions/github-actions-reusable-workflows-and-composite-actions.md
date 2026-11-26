---
id: github-actions-reusable-workflows-and-composite-actions
title: Reusable workflows and composite actions
track: github-actions
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [github-actions-caching-and-artifacts]
learning_objectives:
  - Turn repeated steps into a composite action, passing its inputs safely through environment variables.
  - Turn a repeated job into a reusable workflow with typed inputs and secrets, and call it from other workflows.
  - Choose between a composite action (shared steps) and a reusable workflow (shared jobs).
  - Spot the mistakes DevForge's checker catches — a missing shell, inputs pasted into scripts, wrong or missing inputs in a call.
resources:
  - title: Reuse workflows
    url: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: on workflow_call, inputs and secrets, secrets inherit, nesting, and that reusable workflows must sit directly in .github/workflows.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Create a composite action
    url: https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action
    publisher: GitHub
    type: tutorial
    level: intermediate
    official: true
    why: runs using composite, a shell on every run step, inputs passed through env, and GITHUB_ACTION_PATH.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: which
    prompt: Five repositories each need the same "lint, test, build" job, with their own Node.js version. What fits best?
    options:
      - { id: a, text: "A composite action" }
      - { id: b, text: "A reusable workflow with a node-version input — it shares whole jobs (runner, steps, permissions) and callers pass their version" }
      - { id: c, text: "Copy the job into each repository" }
    answer: b
    explanation: Composite actions bundle steps that run inside the caller's job; reusable workflows bundle jobs. Use the composite action for a few shared steps, the reusable workflow for a shared pipeline.
  - id: injection
    prompt: A composite action's step is run with cat dollar-brace inputs.file close-brace. Why does DevForge's checker reject it?
    options:
      - { id: a, text: "Inputs are not allowed in composite actions" }
      - { id: b, text: "The expression is pasted into the script before the shell runs, so a value containing shell syntax becomes code; pass the input through env and use \"$FILE\"" }
      - { id: c, text: "cat is not available on runners" }
    answer: b
    explanation: The same script-injection rule as for github.event values — the shell must receive data as a variable, never as program text.
  - id: secrets
    prompt: How does a reusable workflow get secrets?
    options:
      - { id: a, text: "It reads the caller's secrets automatically" }
      - { id: b, text: "The caller passes them explicitly under secrets, or all of them with secrets: inherit; the reusable workflow declares the ones it expects" }
      - { id: c, text: "Through inputs" }
    answer: b
    explanation: Explicit passing makes it visible which secrets leave the caller. Never pass secrets as inputs — inputs are not masked as secrets.
verification:
  method: executed
  details: The local commands — writing the composite action and its script, running the script as the action's step would, and writing a reusable workflow and its callers — run in the test suite and their output is compared with this lesson. DevForge's workflow checker validates the action (composite steps, shell, input handling) and the workflows, including that each call to the reusable workflow passes exactly the inputs it declares. Running them on GitHub is checked against GitHub Docs (2026-11-26) but not executed, because it needs github.com.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

When several workflows repeat the same **steps**, put them in a **composite action**; when they repeat the same **jobs**, put them in a **reusable workflow** — one place to fix, review and improve.

## Explain it like I'm twelve

Every class in a school does a fire drill the same way. Instead of each teacher writing their own instructions, the school writes one drill card (**composite action**) that any teacher can follow during their lesson. For bigger things, such as sports day, the school runs the whole event once with its own staff (**reusable workflow**); each class only says which events it enters (**inputs**).

Where the analogy breaks: a reusable workflow's jobs really run separately, on their own runners, as part of the caller's workflow run.

## What problem it solves

Copy-pasted CI drifts: one repository pins an action, another forgets; a security fix lands in three of ten copies. Sharing steps and jobs makes improvements happen everywhere at once — and keeps each repository's own workflow short and readable.

## How it works

![](media:github-actions/reuse.svg)

- A **composite action** is a folder with `action.yml` whose `runs.using` is `composite`. Its steps run inside the calling job. Every `run` step needs a `shell`; inputs (`${{ inputs.x }}`) should reach scripts through `env`.
- A **reusable workflow** is a file in `.github/workflows/` with `on: workflow_call`, declaring `inputs` (typed, required or with defaults), `secrets` and `outputs`. A caller uses it as a **job**: `uses: ./.github/workflows/node-ci.yml` (or `owner/repo/.github/workflows/file.yml@ref`), with `with:` and `secrets:`.
- Reusable workflows can be called with a matrix and can call other reusable workflows.

## Try it yourself

> **Local lab** — needs Git and Bash, as in the earlier lessons. You write the action and the workflows and run the action's script the way its step would; running them on GitHub is optional and needs a repository. Every command is run automatically in DevForge's tests.

### 1. A composite action

```bash run
mkdir -p reuse-lab/.github/actions/check-title && cd reuse-lab
cat > .github/actions/check-title/check.sh <<'EOF'
#!/usr/bin/env bash
# Usage: check.sh FILE — passes if FILE starts with a Markdown title ("# ").
set -euo pipefail
file="$1"
[ -f "$file" ] || { echo "FAIL: $file is missing"; exit 1; }
case "$(head -n 1 "$file")" in
  "# "*) echo "PASS: $file has a title" ;;
  *) echo "FAIL: $file must start with a title line"; exit 1 ;;
esac
EOF
chmod +x .github/actions/check-title/check.sh
cat > .github/actions/check-title/action.yml <<'EOF'
name: Check a Markdown title
description: Fails unless the given Markdown file starts with a "# " title.
inputs:
  file:
    description: The Markdown file to check
    default: README.md
runs:
  using: composite
  steps:
    - name: Check the title
      shell: bash
      env:
        FILE: ${{ inputs.file }}   # data reaches the script as a variable, never as code
      run: '"$GITHUB_ACTION_PATH/check.sh" "$FILE"'
EOF
ls .github/actions/check-title
```

```text output
action.yml
check.sh
```

The step runs the script that sits next to `action.yml` (`$GITHUB_ACTION_PATH`), with the input in `$FILE`. Run it the way that step would:

```bash run
echo "# Course notes" > README.md
echo "no title here" > CHANGES.md
GITHUB_ACTION_PATH=.github/actions/check-title FILE=README.md bash -c '"$GITHUB_ACTION_PATH/check.sh" "$FILE"'
GITHUB_ACTION_PATH=.github/actions/check-title FILE=CHANGES.md bash -c '"$GITHUB_ACTION_PATH/check.sh" "$FILE"' || echo "exit code: $?"
```

```text output
PASS: README.md has a title
FAIL: CHANGES.md must start with a title line
exit code: 1
```

### 2. A reusable workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/node-ci.yml <<'EOF'
name: Node.js CI (reusable)

on:
  workflow_call:
    inputs:
      node-version:
        description: Node.js version to test with
        type: string
        required: true
      check-docs:
        description: Also check that README.md has a title
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test
      - name: Check the README title
        if: inputs.check-docs
        uses: ./.github/actions/check-title
EOF
echo "node-ci.yml declares: $(grep -E '^      [a-z-]+:$' .github/workflows/node-ci.yml | tr -d ' :' | tr '\n' ' ')"
```

```text output
node-ci.yml declares: node-version check-docs
```

The job uses the composite action from step 1 like any other action. `inputs.node-version` is typed and required; `check-docs` has a default.

### 3. Callers

```bash run
cat > .github/workflows/ci.yml <<'EOF'
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  node:
    strategy:
      matrix:
        version: ["20", "22"]
    uses: ./.github/workflows/node-ci.yml
    with:
      node-version: ${{ matrix.version }}
      check-docs: ${{ matrix.version == '22' }}
EOF
cat > .github/workflows/nightly.yml <<'EOF'
name: Nightly

on:
  schedule:
    - cron: "0 2 * * *"

permissions:
  contents: read

jobs:
  node:
    uses: ./.github/workflows/node-ci.yml
    with:
      node-version: "22"
EOF
wc -l .github/workflows/*.yml | sort -n | sed 's/^ *//'
```

```text output
14 .github/workflows/nightly.yml
19 .github/workflows/ci.yml
31 .github/workflows/node-ci.yml
64 total
```

Two short callers reuse one 31-line pipeline: `ci.yml` runs it for two Node.js versions (a matrix of reusable-workflow calls), `nightly.yml` once, relying on the default for `check-docs`. A change to `node-ci.yml` — say, pinning `setup-node` — reaches both.

DevForge's tests run its workflow checker on these files: `check.sh`'s action must give its `run` step a `shell` and pass the input through `env`, and every call must provide `node-version` and pass no undeclared input. Writing `nodeversion:` in a caller, or `run: cat ${{ inputs.file }}` in the action, makes the check fail.

## Common mistakes

- **Pasting `${{ inputs.x }}` into `run`.** It becomes part of the script; pass it through `env`.
- **Forgetting `shell` in composite steps.** It is required there (unlike in workflows).
- **Reusable workflows in subfolders.** They must be directly in `.github/workflows/`.
- **Passing secrets as inputs.** Use the `secrets` section (or `secrets: inherit`) so values stay masked.
- **Calling a shared workflow by branch (`@main`) across repositories.** Pin it to a tag or commit SHA, as you would an action.

## Where this fits in a real system

Platform teams publish reusable workflows ("build, scan, push an image"; "Terraform plan with policy checks") that every service repository calls, often from a central repository and pinned by SHA. The image pipeline of the previous lesson and the **Terraform** plan-review workflow are typical candidates; **Jenkins** solves the same problem with shared libraries.
