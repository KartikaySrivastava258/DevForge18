---
id: git-remotes-push-pull
title: Sharing work with remotes, push and pull
track: git-github
order: 3
level: beginner
estimated_minutes: 30
prerequisites: [git-first-commits]
learning_objectives:
  - Explain what a remote is and what origin means.
  - Publish commits with git push and set an upstream branch.
  - Explain the difference between git fetch and git pull, and read "behind by 1 commit".
  - Connect a local repository to GitHub and authenticate without a password.
resources:
  - title: Pro Git — Working with Remotes
    url: https://git-scm.com/book/en/v2
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Chapter 2 explains remotes, fetching, pulling and pushing step by step.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: GitHub Docs
    url: https://docs.github.com/
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: Official guides to creating repositories and authenticating with GitHub over HTTPS or SSH.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: fetch-vs-pull
    prompt: What is the difference between git fetch and git pull?
    options:
      - { id: a, text: "They are identical; pull is just the newer name" }
      - { id: b, text: "fetch downloads new commits and updates origin/main but leaves your branch and files alone; pull fetches and then integrates the changes into your branch" }
      - { id: c, text: "fetch uploads your commits; pull downloads other people's" }
    answer: b
    explanation: git fetch only updates your copy of the remote's state (origin/main), so you can inspect before changing anything. git pull is a fetch followed by integrating those commits into your current branch — here, a fast-forward.
  - id: behind
    prompt: After git fetch, git status says "Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded." What happened?
    options:
      - { id: a, text: "You made a commit that has not been pushed yet" }
      - { id: b, text: "Someone pushed a commit you do not have locally yet, and you have no conflicting local commits, so Git can simply move your branch forward" }
      - { id: c, text: "Your working tree has unsaved edits" }
    answer: b
    explanation: Behind means the remote has commits you lack. "Can be fast-forwarded" means your branch has no commits of its own since then, so git pull just moves it forward to include them — no merge needed.
  - id: origin
    prompt: What is origin?
    options:
      - { id: a, text: "A special server that every Git repository must use" }
      - { id: b, text: "The conventional short name for the remote you cloned from or first connected to; you could name it anything" }
      - { id: c, text: "The first commit in the repository" }
    answer: b
    explanation: origin is just a name for a remote URL. git clone creates it automatically, and by convention people use it for their main remote. git remote -v lists every remote and its URL.
  - id: github-password
    prompt: You push to a GitHub repository over HTTPS and Git asks for a password. What should you use?
    options:
      - { id: a, text: "Your GitHub account password" }
      - { id: b, text: "A credential helper sign-in, a personal access token, or switch to SSH keys — GitHub does not accept account passwords for Git operations" }
      - { id: c, text: "Nothing; pushing never needs authentication" }
    answer: b
    explanation: GitHub removed password authentication for Git operations. Git for Windows' bundled credential manager can sign you in through the browser; otherwise use a personal access token or SSH keys.
verification:
  method: executed
  details: Every command marked runnable is executed by the test suite with Git 2.43 (and in CI), continuing from the previous lesson's repository, with fixed commit dates so the commit IDs shown here are reproduced exactly.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **remote** is another copy of your repository, usually on a server such as GitHub; `git push` sends your commits to it and `git pull` brings other people's commits back.

## Explain it like I'm twelve

Imagine a class notebook kept in the library. Everyone has a photocopy at home where they write freely. When you finish a page, you go to the library and add it to the shared notebook (*push*). Before you start work, you check what classmates added and copy it into yours (*pull*).

The analogy breaks in a helpful way: Git never lets you silently overwrite a classmate's page. If someone has added pages you have not seen, Git refuses your push until you have pulled theirs first.

## What problem it solves

So far your history lives on one computer. If the laptop is lost, so is the work, and nobody else can contribute. A remote gives the team one shared copy to synchronise with, and acts as an off-site backup. Because every clone still holds the full history, the team can keep working even when the server is unavailable.

## How it works

![](media:git-github/remotes.svg)


- **origin** is the conventional name for your main remote.
- **origin/main** is your *local record* of where the remote's `main` branch was the last time you talked to it. It only changes when you fetch, pull or push.
- **git fetch** downloads new commits and updates `origin/main`; your own branch and files stay unchanged.
- **git pull** runs a fetch, then integrates the new commits into your branch.
- **git push** uploads your commits and moves the remote's branch forward — but only if that does not discard commits you have not seen.

## Try it yourself

> **Local lab, no account needed** — continue in the `student-notes` folder from the previous lesson. Instead of GitHub, you will use a *bare repository* in a neighbouring folder as the remote. A bare repository has history but no working files, which is exactly what a server stores. Everything here also works with GitHub; the last section shows the one change needed. On Windows, use Git Bash.

### 1. Create a remote and connect to it

```bash run
cd ..
git init --bare class-remote.git
```

```text output
Initialized empty Git repository in …/class-remote.git/
```

Now go back into your project and register the remote under the name `origin`:

```bash run
cd student-notes
git remote add origin ../class-remote.git
git remote -v
```

```text output
origin	../class-remote.git (fetch)
origin	../class-remote.git (push)
```

### 2. Push your commits

```bash run
git push -u origin main
```

```text output
To ../class-remote.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

`-u` (short for `--set-upstream`) links your local `main` to `origin/main`, so from now on a plain `git push` or `git pull` knows where to go.

### 3. A teammate clones and contributes

Pretend to be your teammate Ravi on his own computer. He clones the shared repository:

```bash run
cd ..
git clone class-remote.git ravi-copy
```

```text output
Cloning into 'ravi-copy'...
done.
```

Ravi sets his identity *for this repository only* — no `--global`, so your own settings stay unchanged — then commits and pushes:

```bash run
cd ravi-copy
git config user.name "Ravi Kumar"
git config user.email "ravi@example.edu"
echo "Week 2: branches let work happen in parallel." >> README.md
git commit -am "Add week 2 summary"
```

```text output
[main 2a82dac] Add week 2 summary
 1 file changed, 1 insertion(+)
```

`-a` stages every *tracked* file that changed before committing — a shortcut that never includes untracked files. Now Ravi pushes; no `-u` is needed because `git clone` already linked his `main` to `origin/main`:

```bash run
git push
```

```text output
To …/class-remote.git
   e557bd2..2a82dac  main -> main
```

### 4. Fetch, then pull, Ravi's work

Back in your own copy, fetch and check the status:

```bash run
cd ../student-notes
git fetch
git status
```

```text output
From ../class-remote
   e557bd2..2a82dac  main       -> origin/main
On branch main
Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded.
  (use "git pull" to update your local branch)

nothing to commit, working tree clean
```

Your files have not changed yet: fetch only updated `origin/main`. Now integrate the commit:

```bash run
git pull
git log --oneline
```

```text output
Updating e557bd2..2a82dac
Fast-forward
 README.md | 1 +
 1 file changed, 1 insertion(+)
2a82dac Add week 2 summary
e557bd2 Ignore local environment file
59fcfba Add week 1 summary
856002e Add README with project title
```

*Fast-forward* means your branch simply moved forward to Ravi's commit, because you had made no new commits of your own. Check who wrote it:

```bash run
git log -1 --format="%h %an: %s"
```

```text output
2a82dac Ravi Kumar: Add week 2 summary
```

Keep `student-notes` and `class-remote.git`: the GitHub Actions lessons continue from them. You can delete `ravi-copy`.

### 5. Doing the same with GitHub

1. Sign in to GitHub and create a new, **empty** repository (no README, licence or `.gitignore`), for example `student-notes`.
2. Point `origin` at it instead of the local folder, then push:

   ```bash
   git remote set-url origin https://github.com/YOUR-USERNAME/student-notes.git
   git push -u origin main
   ```

3. When Git asks you to authenticate, **do not use your GitHub password** — GitHub does not accept account passwords for Git operations. Git for Windows includes a credential manager that signs you in through your browser. Elsewhere, use a personal access token, or set up SSH keys and use the `git@github.com:…` form of the URL. GitHub Docs explain each option.

## Common mistakes

- **Pushing before pulling** when teammates have pushed. Git rejects the push to protect their commits; pull first, resolve any conflicts, then push.
- **Assuming `git fetch` changed your files.** It only updates `origin/main`; use `git pull` (or merge) to bring the changes into your branch.
- **Typing a GitHub password at the prompt.** It will fail; use a credential manager, token or SSH key.
- **Creating the GitHub repository with a README** and then pushing an existing project. The two histories have no common commit and the push is rejected. Create it empty, or clone it first and add your files.
- **Committing directly on `main` in a team.** It works here, but teams normally work on branches and merge through pull requests — the subject of the next lessons.

## Where this fits in a real system

Pushing to GitHub is what sets the rest of the engineering workflow in motion. A push can trigger a **GitHub Actions** or **Jenkins** pipeline that runs tests and builds a **Docker** image; a pull request opens a code review; and protected branches make sure `main` only changes through reviewed, passing work. Infrastructure repositories work the same way, so a reviewed push can apply **Terraform** changes or roll out a new version to **Kubernetes**.
