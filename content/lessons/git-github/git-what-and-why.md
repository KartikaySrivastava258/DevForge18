---
id: git-what-and-why
title: What Git is, and setting it up
track: git-github
order: 1
level: beginner
estimated_minutes: 25
prerequisites: []
learning_objectives:
  - Explain what problem version control solves, using an example from your own work.
  - Name Git's three areas (working tree, staging area, repository) and what moves work between them.
  - Explain the difference between Git and GitHub.
  - Install Git and configure your name, email and default branch name.
resources:
  - title: Pro Git (2nd edition) — Getting Started
    url: https://git-scm.com/book/en/v2
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Chapter 1 explains version control and Git's design in more depth, with diagrams.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Git downloads
    url: https://git-scm.com/downloads
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Official installers and package-manager instructions for Windows, macOS and Linux.
    verification: { status: unverified }
self_check:
  - id: git-vs-github
    prompt: A classmate says "I can't use Git today because GitHub is down." What is the best response?
    options:
      - { id: a, text: "They are right: Git needs GitHub to save commits" }
      - { id: b, text: "Git runs on their own computer, so they can keep committing; they only need GitHub to share work" }
      - { id: c, text: "They should switch to a different Git, such as GitLab" }
    answer: b
    explanation: Git is a program on your machine with the complete history stored locally in the .git folder. GitHub is a hosting service for sharing repositories. Commits, branches and history all work without it; only pushing and pulling to GitHub wait until it is back.
  - id: three-areas
    prompt: You edited three files but only want two of them in your next commit. Which part of Git exists to make that possible?
    options:
      - { id: a, text: "The staging area, where you choose exactly what goes into the next commit" }
      - { id: b, text: "The repository, which records every file automatically" }
      - { id: c, text: "The working tree, which commits whatever is saved on disk" }
    answer: a
    explanation: Edits happen in the working tree, but nothing is committed until you stage it. Staging lets you build each commit deliberately, so one commit can hold one coherent change even when you have edited more.
  - id: email-visibility
    prompt: Why should you think about which email you put in git config before pushing to a public repository?
    options:
      - { id: a, text: "Git sends an email to that address after every commit" }
      - { id: b, text: "The email is stored inside every commit, so anyone who can read the repository can see it" }
      - { id: c, text: "GitHub rejects commits made with personal email addresses" }
    answer: b
    explanation: Each commit permanently records the author name and email. On a public repository that is public information, which is why GitHub offers a private no-reply address you can use instead.
verification:
  method: executed
  details: Every command marked runnable is executed by the test suite with Git 2.43 (and in CI) in an isolated home directory, and its output is compared with the output shown here.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Git** is a version-control system: it records snapshots of a project's files over time, so you can see what changed, when, why and by whom — and return to any earlier state.

## Explain it like I'm twelve

Think of the save points in a video game. When you reach one, the game remembers everything about that moment, and if things go badly later you can go back. Git gives a whole project save points called **commits**. Each one has a short message explaining what changed, like "Add login page".

The analogy breaks in two useful ways. First, Git does not copy every file at every save: files that did not change are stored once and reused, so history stays small. Second, unlike a game, several people can each create their own save points on their own computers, and Git can **merge** their timelines together later.

## What problem it solves

Without version control, projects end up like this:

```text
report_final.docx
report_final_v2.docx
report_final_v2_REAL.docx
report_final_v2_REAL_fixed_by_Asha.docx
```

Nobody is sure which file is current, what changed between versions, or who changed it. When two people edit at once, one person's work silently overwrites the other's. Git replaces this with one folder whose complete history is recorded, explained and recoverable.

## How it works

Git manages work in three areas:

```text
 working tree            staging area              repository (.git)
 (files you edit)        (the next commit,         (every commit,
                          being assembled)          permanently)
      │                         │                         │
      │ ── git add ───────────▶ │                         │
      │                         │ ── git commit ────────▶ │
      │ ◀──────────────── git restore / git switch ────── │
```

1. **Working tree** — the ordinary files in your project folder. You edit them with any editor.
2. **Staging area** (also called the *index*) — where you place the changes you want in the next commit, using `git add`. This lets you commit some edits and leave others for later.
3. **Repository** — the hidden `.git` folder, which stores every commit. `git commit` turns the staged changes into a new commit.

Each **commit** records a snapshot of the staged files, the author's name and email, a timestamp, a message, and a link to the previous commit. Git identifies each commit by a **hash** — a long hexadecimal ID calculated from its contents, such as `3f2c1a9…`. Because the ID depends on the content, history cannot be quietly altered without the IDs changing.

Git is **distributed**: every copy of a repository (a *clone*) contains the complete history. You can commit, compare versions and browse history with no network connection.

### Git is not GitHub

| | Git | GitHub |
|---|---|---|
| What it is | A program on your computer | A website and service that hosts Git repositories |
| Made by | The open-source Git project | GitHub (a company owned by Microsoft) |
| Works offline | Yes | No |
| Adds | Commits, branches, merges, history | Pull requests, code review, issues, permissions, automation |

GitLab and Bitbucket are other hosting services for Git repositories. Learning Git first means your skills transfer to all of them.

## Try it yourself

> **Local lab** — these steps install Git on your own computer and change only Git's settings for your user account. Every command shown is run automatically in DevForge's tests, and the output is compared with what you see here.

### 1. Install Git

- **Windows:** download *Git for Windows* from the official downloads page linked in the resources below and run the installer; the default options are fine. It also installs **Git Bash**, a terminal in which the commands in these lessons work exactly as shown.
- **macOS:** run `git --version` in Terminal. If Git is missing, macOS offers to install the Xcode Command Line Tools, which include it. If you use Homebrew, `brew install git` installs a more recent version.
- **Linux:** use your distribution's package manager, for example `sudo apt install git` (Ubuntu, Debian) or `sudo dnf install git` (Fedora).

Check that it worked:

```bash run
git --version
```

You should see a line such as `git version 2.43.0`. Any recent version is fine for these lessons.

### 2. Tell Git who you are

Every commit records an author, so set your name and email once per computer:

```bash run
git config --global user.name "Asha Rao"
git config --global user.email "asha@example.edu"
```

Use your own name and email. `--global` stores the setting for your user account, so it applies to every repository you create.

### 3. Choose the default branch name

New repositories start with one branch. Many projects, including GitHub's defaults, now call it `main`:

```bash run
git config --global init.defaultBranch main
```

### 4. Check your settings

```bash run
git config --global --list
```

```text output
user.name=Asha Rao
user.email=asha@example.edu
init.defaultbranch=main
```

Notice that Git prints the setting names in lower case (`init.defaultbranch`); setting names are not case-sensitive.

> **Privacy:** your email is stored in every commit you make and becomes visible to anyone who can read the repository. If your work will be public, GitHub can give you a private *no-reply* address to use instead; find it in your GitHub email settings.

To undo a setting later, use `git config --global --unset user.email` (for example). Removing Git itself is done with your system's normal uninstall method.

## Common mistakes

- **Treating Git and GitHub as the same thing.** You can use Git fully without GitHub; GitHub is one place to share Git repositories.
- **Committing secrets.** Passwords, API keys and `.env` files must never be committed. Deleting a secret in a later commit does not remove it from history — anyone with the repository can still read the old commit. If it happens, treat the secret as leaked and replace it.
- **Skipping identity setup.** Without it, Git may refuse to commit or may guess an identity from your computer's account name.
- **Putting huge generated files under version control,** such as `node_modules/`, build output or datasets. Git is designed for source files; you will learn to exclude the rest with `.gitignore` in the next lesson.

## Where this fits in a real system

A repository is the starting point of almost every engineering workflow. Pushing a commit to GitHub can start a **GitHub Actions** or **Jenkins** pipeline that tests and builds the code. Infrastructure definitions for **Terraform**, configuration for **Kubernetes** and **Docker** build files all live in repositories, so they are reviewed and versioned just like application code. Work items in **Jira** can be linked to the commits that implement them.
