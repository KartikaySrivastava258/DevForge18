---
id: git-protected-branches-signing-secrets
title: Protected branches, signed commits and secret scanning
track: git-github
order: 8
level: advanced
estimated_minutes: 40
prerequisites: [git-pull-requests-and-review]
learning_objectives:
  - Sign commits with an SSH key and verify the signatures, and explain what a signature does and does not prove.
  - Block secrets before they are committed with a pre-commit hook, and explain why GitHub's push protection is still needed.
  - Choose branch protection rules for main and say what each prevents.
resources:
  - title: GitHub Docs — About commit signature verification
    url: https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: GPG, SSH and S/MIME signatures, and when GitHub marks a commit Verified.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: GitHub Docs — About protected branches
    url: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: Every branch protection rule (reviews, status checks, signed commits, linear history, force pushes) and which plans have them.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: GitHub Docs — Push protection
    url: https://docs.github.com/en/code-security/concepts/secret-security/push-protection
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: How push protection blocks pushes that contain secrets.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: AWS IAM — unique ID prefixes
    url: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html
    publisher: Amazon Web Services
    type: documentation
    level: intermediate
    official: true
    why: The list of ID prefixes, including AKIA for access keys, used by the hook's pattern.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git config — gpg.format and gpg.ssh.allowedSignersFile
    url: https://git-scm.com/docs/git-config
    publisher: git-scm.com
    type: documentation
    level: advanced
    official: true
    why: The settings for signing with SSH keys and for trusting signers.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: what-signature-proves
    prompt: A commit is signed with Asha's key and verifies as good. What does that tell you?
    options:
      - { id: a, text: "That the code is correct and safe" }
      - { id: b, text: "That whoever holds Asha's private key created this exact commit, and it was not changed afterwards — not that the change is good" }
      - { id: c, text: "Nothing: anyone can type Asha's name into git config" }
    answer: b
    explanation: The author name in git config can be anything; a signature ties the commit to a key. It proves origin and integrity, not quality — reviews and tests still matter.
  - id: hook-vs-server
    prompt: You have a pre-commit hook that blocks secrets. Why also turn on GitHub's push protection?
    options:
      - { id: a, text: "Hooks are not copied with git clone and can be skipped with --no-verify; a server-side check applies to every push" }
      - { id: b, text: "Hooks only work on Windows" }
      - { id: c, text: "Push protection is faster" }
    answer: a
    explanation: Local hooks help honest people catch mistakes early. Only checks enforced on the server apply to everyone, every time.
  - id: rules
    prompt: Which protected branch rule stops someone from rewriting main's history?
    options:
      - { id: a, text: "Require status checks before merging" }
      - { id: b, text: "Leaving force pushes disabled (the default for a protected branch) — and not allowing deletions" }
      - { id: c, text: "Require conversation resolution" }
    answer: b
    explanation: Rewriting a pushed branch needs a force push. Protected branches do not allow force pushes or deletions unless you turn those options on.
verification:
  method: executed
  details: Signing, verifying, the hook and the commits are run by the test suite with Git and ssh-keygen, after the earlier lessons, and their output is compared with this lesson (key fingerprints are random and shown as …). Branch protection rules and push protection were checked against GitHub's documentation (2026-11-26) but are not executed, because they need a GitHub repository.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Protect `main` in layers: **sign** commits so their origin can be verified, **block secrets** before they leave your machine, and let **branch protection** on the server enforce reviews, checks and no history rewrites for everyone.

## Explain it like I'm twelve

A school's trophy cabinet has three protections: every trophy has a signed certificate (signed commits), the caretaker checks bags at the door so nothing dangerous comes in (secret checks), and only the head teacher's office can open the cabinet, with two teachers watching (protected branches).

Where the analogy breaks: the bag check on your own machine is voluntary — anyone can skip it — which is why the server checks too.

## What problem it solves

Anyone can set `user.name` to anyone, a leaked token in a public repository can be found and abused, and one force push can erase a week of work. Teams that ship software need to know who changed what, keep credentials out of history, and make sure every change to `main` was reviewed and tested.

## How it works

![](media:git-github/protection-layers.svg)

- **Signed commits.** `git commit -S` signs the commit with your private key (GPG, SSH or S/MIME). Anyone with the matching public key can check that the commit is unchanged and was made with that key; GitHub shows such commits as **Verified** when the key is in your account.
- **Secret checks.** A local pre-commit hook can refuse commits containing private keys or tokens. GitHub's **push protection** scans pushes for known secret formats and blocks them before they reach the repository.
- **Protected branches.** Rules on a branch can require a pull request with approvals, passing status checks, signed commits and linear history; force pushes and deletions are not allowed unless you allow them. GitHub's documentation lists which rules each plan supports.

## Try it yourself

> **Local lab** — a new practice repository and a throwaway SSH key used only for this lesson. Every command is run automatically in DevForge's tests. Protecting a branch and push protection are set up on GitHub (step 5).

### 1. A signing key, just for this lesson

```bash run
mkdir signing-practice && cd signing-practice
git init -q -b main
ssh-keygen -q -t ed25519 -N '' -C "$(git config user.email)" -f lesson-signing-key
git config gpg.format ssh
git config user.signingkey "$PWD/lesson-signing-key.pub"
printf '%s %s\n' "$(git config user.email)" "$(cat lesson-signing-key.pub)" > allowed_signers
git config gpg.ssh.allowedSignersFile "$PWD/allowed_signers"
ls
```

```text output
allowed_signers
lesson-signing-key
lesson-signing-key.pub
```

- `ssh-keygen` made a key pair: `lesson-signing-key` is **private** (never share or commit it), `.pub` is public. `-N ''` means no passphrase — acceptable only for a throwaway practice key.
- `gpg.format ssh` tells Git to sign with SSH; `user.signingkey` names the key.
- `allowed_signers` lists which public key belongs to which email, so Git can *verify* signatures.

These settings are for this repository only (no `--global`).

### 2. A signed commit and an unsigned one

```bash run
printf 'notes\n' > notes.md
git add notes.md && git commit -q -S -m "Add notes (signed)"
printf 'more\n' >> notes.md
git commit -q -am "Add more (not signed)"
git log --format='%G? %s'
git verify-commit HEAD~1 2>&1 | sed 's/SHA256:.*/SHA256:…/'
```

```text output
N Add more (not signed)
G Add notes (signed)
Good "git" signature for asha@example.edu with ED25519 key SHA256:…
```

`%G?` shows the signature status: **G** good, **N** none. (Signed commits get a different ID on every run, because the signature is part of the commit — so this listing leaves the IDs out.) `git verify-commit` checked the signature against `allowed_signers`. On GitHub, upload the public key as a *signing key* in your settings, and signed commits show **Verified**. To sign every commit, set `commit.gpgsign true`.

### 3. A hook that keeps secrets out

The private key is sitting in the repository folder. One careless `git add -A` would commit it:

```bash run
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
# Refuse commits whose staged changes contain a private key or a likely access key.
if git diff --cached -U0 | grep -qE 'BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}'; then
  echo "pre-commit: this commit contains something that looks like a secret; remove it and try again" >&2
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
git add -A
git commit -q -m "Add everything" || echo "commit refused"
git reset -q
printf 'lesson-signing-key\n' > .gitignore
git add .gitignore && git commit -q -m "Ignore the private key"
git status --short
```

```text output
pre-commit: this commit contains something that looks like a secret; remove it and try again
commit refused
?? allowed_signers
?? lesson-signing-key.pub
```

- The hook saw `BEGIN OPENSSH PRIVATE KEY` in the staged changes and refused the commit. `git reset` unstaged everything again.
- `.gitignore` now keeps the private key out of `git add -A`. The public key and `allowed_signers` are safe to share.
- `AKIA` is the prefix AWS's documentation lists for access key IDs, so the hook also looks for `AKIA` followed by 16 capital letters or digits. Real secret scanners know hundreds of such formats.

### 4. Why the server must check too

```bash run
printf 'token = AKIAABCDEFGHIJKLMNOP\n' > config.ini
git add config.ini
git commit -q --no-verify -m "Add config" && echo "committed anyway, with --no-verify"
git log --oneline -n 1 --format=%s
```

```text output
committed anyway, with --no-verify
Add config
```

`--no-verify` skipped the hook, and the fake key is now in history. Hooks also do not travel with `git clone`. That is why GitHub's push protection, which runs on the server for every push, matters — and why a secret that was pushed must be revoked, not just deleted (see the lab *Diagnose an accidental commit and recover safely*).

### 5. On GitHub: protect main (optional)

In a repository you administer: **Settings → Branches → Add branch protection rule** (or a ruleset) for `main`, and turn on **Require a pull request before merging** with at least one approval, **Require status checks to pass** (choose your CI job), and **Require signed commits**. Leave **Allow force pushes** and **Allow deletions** off. Under **Settings → Code security**, enable **secret scanning** and **push protection**. GitHub's documentation lists which of these are available for public and private repositories on each plan.

## Common mistakes

- **Committing the private key.** The private half must never leave your machine; only the `.pub` file is shared.
- **Treating "Verified" as "safe".** A signature proves who made the commit, not that the change is good.
- **Relying on hooks alone.** They are optional and local; enforce the rule on the server.
- **Allowing administrators to bypass protection by default.** Then the most powerful accounts are the least protected; keep bypasses rare and deliberate.

## Where this fits in a real system

Required status checks are usually **GitHub Actions** jobs; deployments (**Jenkins**, **GitHub Actions** environments) can require that only signed, reviewed commits on `main` are released; and leaked-credential response — revoke, rotate, investigate — is part of every team's security runbook.
