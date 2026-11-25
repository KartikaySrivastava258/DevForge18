---
id: git-first-commits
title: Your first repository and commits
track: git-github
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [git-what-and-why]
learning_objectives:
  - Create a repository and record a series of commits with clear messages.
  - Read git status to tell untracked, modified and staged files apart.
  - Use git diff and git log to see what changed and when.
  - Keep files such as secrets out of a repository with .gitignore.
resources:
  - title: Pro Git — Git Basics, Recording Changes to the Repository
    url: https://git-scm.com/book/en/v2
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Chapter 2 covers status, add, commit, diff, log and .gitignore in more detail.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Git reference manual
    url: https://git-scm.com/docs
    publisher: git-scm.com
    type: reference
    level: all
    official: true
    why: Every option of status, add, commit, diff, log and gitignore, from the Git project.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: untracked-vs-staged
    prompt: git status lists README.md under "Untracked files". What does that mean?
    options:
      - { id: a, text: "README.md is already in the last commit but has been edited" }
      - { id: b, text: "Git sees the file in the folder but has never been asked to track it; it will not be committed until you git add it" }
      - { id: c, text: "README.md is listed in .gitignore" }
    answer: b
    explanation: Untracked means the file exists in the working tree but is in no commit and is not staged. Ignored files do not appear at all, and edited tracked files appear as "modified".
  - id: gitignore-tracked
    prompt: You committed config.env last week, then added config.env to .gitignore today. What happens?
    options:
      - { id: a, text: "Git deletes config.env from all earlier commits" }
      - { id: b, text: "Git keeps tracking it: .gitignore only affects files that are not already tracked, and the old commits still contain it" }
      - { id: c, text: "Git stops tracking it and removes it from history automatically" }
    answer: b
    explanation: .gitignore only prevents untracked files from being added. A file that is already tracked stays tracked until you remove it from the index (git rm --cached), and every earlier commit still contains it. If it held a secret, treat that secret as leaked and replace it.
  - id: good-message
    prompt: Which commit message is most useful to a teammate reading the history six months later?
    options:
      - { id: a, text: "changes" }
      - { id: b, text: "Fix login redirect when the session has expired" }
      - { id: c, text: "updated files and fixed stuff" }
    answer: b
    explanation: A good message says what the commit does, in the imperative mood, specifically enough that someone can find it in git log without opening the code.
  - id: diff-before-stage
    prompt: You edited README.md but have not run git add yet. Which command shows exactly which lines you changed?
    options:
      - { id: a, text: "git diff" }
      - { id: b, text: "git log" }
      - { id: c, text: "git commit" }
    answer: a
    explanation: Plain git diff compares the working tree with the staging area, which shows unstaged edits line by line. git log lists commits; it does not show uncommitted work.
verification:
  method: executed
  details: Every command marked runnable is executed by the test suite with Git 2.43 (and in CI), after the setup from the previous lesson, with fixed commit dates so the commit IDs shown here are reproduced exactly.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

Making a commit is a two-step habit: **stage** the changes you want with `git add`, then **record** them with `git commit` and a message that explains them.

## Explain it like I'm twelve

Imagine packing a parcel to post. Your desk is covered in things (the *working tree*). You choose which items go into the box (*staging*). When the box holds exactly what you want, you seal it and write a label saying what is inside (*committing*). Once posted, the parcel is recorded in a logbook forever (*history*).

Where the analogy breaks: posting a parcel removes the items from your desk, but committing does not touch your files at all. Git just records a snapshot of them.

## What problem it solves

Saving a file only keeps its latest state. Committing keeps every meaningful state *with an explanation*, so you can later answer "when did this break?" and "why did we change this?". Staging means a commit can contain one coherent change — fixing a typo and adding a feature become two separate, understandable steps rather than one muddled one.

## How it works

`git status` is your dashboard. It reports each file's state. Step through the diagram to follow one file round the loop:

```diagram steps=git-github/commit-cycle
```

- **Untracked**: in the folder, but Git has never been told to track it.
- **Modified**: tracked, and changed since the last commit, but not staged.
- **Staged**: will be included in the next commit.
- **Committed**: safely recorded; nothing to do.

## Try it yourself

> **Local lab** — run these commands in a terminal, in a folder where you keep projects. On Windows, use **Git Bash** (installed with Git for Windows) so that commands such as `echo "…" > file` behave exactly as shown; in Windows PowerShell 5.1 the `>` redirect saves files in UTF-16, which Git treats as binary. Your commit IDs will differ from the ones shown, because IDs depend on the time and author of each commit.

### 1. Create a repository

```bash run
mkdir student-notes
cd student-notes
git init
```

```text output
Initialized empty Git repository in …/student-notes/.git/
```

`git init` creates the hidden `.git` folder that holds the repository. Your folder path will appear where the `…` is. Ask Git what it sees:

```bash run
git status
```

```text output
On branch main

No commits yet

nothing to commit (create/copy files and use "git add" to track)
```

### 2. Add a file and watch its state change

Create a README and check the status again:

```bash run
echo "# Student notes" > README.md
git status
```

```text output
On branch main

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	README.md

nothing added to commit but untracked files present (use "git add" to track)
```

Git sees the file but is not tracking it. Stage it:

```bash run
git add README.md
git status
```

```text output
On branch main

No commits yet

Changes to be committed:
  (use "git rm --cached <file>..." to unstage)
	new file:   README.md
```

### 3. Make your first commit

```bash run
git commit -m "Add README with project title"
```

```text output
[main (root-commit) 856002e] Add README with project title
 1 file changed, 1 insertion(+)
 create mode 100644 README.md
```

Reading the output: `main` is the branch; `root-commit` means this is the first commit, with no parent; `856002e` is the start of the commit ID; then a summary of what changed. `-m` supplies the message. Without it, Git opens a text editor for you to write one.

### 4. Change the file and inspect the difference

Append a line (`>>` adds to the end; a single `>` would replace the file):

```bash run
echo "Week 1: version control keeps a history of changes." >> README.md
git status --short
```

```text output
 M README.md
```

`--short` gives one line per file: `M` means *modified*. To see exactly what changed:

```bash run
git diff
```

```text output
diff --git a/README.md b/README.md
index 7bf5cac..3c5b926 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Student notes
+Week 1: version control keeps a history of changes.
```

Lines starting with `+` were added, lines with `-` were removed, and unmarked lines are unchanged context. `@@ -1 +1,2 @@` means "line 1 of the old file became lines 1–2 of the new one". Commit the change:

```bash run
git add README.md
git commit -m "Add week 1 summary"
```

```text output
[main 59fcfba] Add week 1 summary
 1 file changed, 1 insertion(+)
```

### 5. Keep secrets out with .gitignore

Projects often have files that must never be committed, such as a `.env` file with passwords or API keys. List them in a file named `.gitignore`:

```bash run
echo "API_KEY=not-a-real-key" > .env
echo ".env" > .gitignore
git status --short
```

```text output
?? .gitignore
```

`??` means untracked. Git reports `.gitignore` but not `.env`: the ignored file is invisible to `git status` and `git add .`. Commit the `.gitignore` so everyone on the project shares it, then view the history:

```bash run
git add .gitignore
git commit -m "Ignore local environment file"
git log --oneline
```

```text output
[main e557bd2] Ignore local environment file
 1 file changed, 1 insertion(+)
 create mode 100644 .gitignore
e557bd2 Ignore local environment file
59fcfba Add week 1 summary
856002e Add README with project title
```

`git log --oneline` lists commits newest first. For the full details of the latest commit:

```bash run
git log -1
```

```text output
commit e557bd2d4e36ee16230c685f41ea32a59c4d1d00
Author: Asha Rao <asha@example.edu>
Date:   Thu Jan 15 10:00:00 2026 +0000

    Ignore local environment file
```

Keep this `student-notes` folder: the next lesson shares it with a teammate.

## Try it in the simulation

The commit graph explorer shows what your commands do to the history. Start a branch here, then try the other scenarios when you reach branches and merging. It is a labelled teaching model: it has no files, so it never shows a conflict.

```simulation git-commit-graph scenario=first-commits
```

## Common mistakes

- **Committing everything with `git add .` without looking.** It stages every changed and untracked file, including ones you did not mean to share. Run `git status` first.
- **Adding a file to `.gitignore` after committing it.** `.gitignore` does not affect files that are already tracked, and earlier commits still contain them. Stop tracking with `git rm --cached <file>`; if it held a secret, replace the secret.
- **Vague messages** such as "update" or "fix". Write what the commit does: "Fix crash when the notes file is empty".
- **Giant commits** mixing unrelated changes. Stage and commit them separately so each can be understood, reviewed and undone on its own.
- **Using `>` when you meant `>>`.** A single `>` replaces a file's contents.

## Where this fits in a real system

Small, well-described commits make every later tool more useful: pull-request reviews on **GitHub** are easier to read, a failing **GitHub Actions** run points to a specific change, and work items in **Jira** can link to the exact commits that implemented them. `.gitignore` is also the first line of defence against leaking credentials that **Terraform**, **Postman** environments or **n8n** workflows would otherwise depend on.
