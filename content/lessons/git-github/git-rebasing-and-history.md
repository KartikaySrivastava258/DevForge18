---
id: git-rebasing-and-history
title: Rebasing and history editing
track: git-github
order: 7
level: advanced
estimated_minutes: 40
prerequisites: [git-pull-requests-and-review]
learning_objectives:
  - Rebase a branch onto the latest main and explain why its commits get new IDs.
  - Clean up a branch's commits before review with git commit --fixup and an autosquash rebase.
  - Push rewritten history safely with --force-with-lease, and explain when not to rebase at all.
resources:
  - title: Pro Git — Rebasing
    url: https://git-scm.com/book/en/v2/Git-Branching-Rebasing
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: What rebasing does, rebase versus merge, and "the perils of rebasing".
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git rebase — reference manual
    url: https://git-scm.com/docs/git-rebase
    publisher: git-scm.com
    type: documentation
    level: advanced
    official: true
    why: The todo list, fixup and squash, and --autosquash.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git push — reference manual
    url: https://git-scm.com/docs/git-push
    publisher: git-scm.com
    type: documentation
    level: advanced
    official: true
    why: --force-with-lease and what it protects.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: new-ids
    prompt: After git rebase main, your branch's commits have new IDs. Why?
    options:
      - { id: a, text: "Rebase renames commits at random" }
      - { id: b, text: "A commit's ID depends on its parent; rebasing replays each change on a new parent, which makes a new commit" }
      - { id: c, text: "The IDs only look different in git log" }
    answer: b
    explanation: A commit records its parent, so the same change on a different parent is a different commit with a different ID. The old commits still exist until garbage collection — which is how the reflog can bring them back.
  - id: golden-rule
    prompt: When should you NOT rebase?
    options:
      - { id: a, text: "On commits that others already have and may have built on — for example a shared main branch" }
      - { id: b, text: "On a branch only you have pushed and nobody else uses" }
      - { id: c, text: "Never: rebasing is always safe" }
    answer: a
    explanation: Pro Git puts it plainly — do not rebase commits that exist outside your repository and that people may have based work on. Rebasing your own unshared branch before review is fine.
  - id: lease
    prompt: You rebased your pull request branch and must push it. Why use git push --force-with-lease instead of --force?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "It refuses to overwrite the remote branch if it has changed since you last fetched it, so you cannot silently delete a teammate's push" }
      - { id: c, text: "It merges instead of overwriting" }
    answer: b
    explanation: --force-with-lease requires the remote branch to still be where your remote-tracking branch says it is; --force overwrites whatever is there.
verification:
  method: executed
  details: Every command is run by the test suite with Git, after the earlier lessons, and its output is compared with this lesson. The interactive rebase is driven by an autosquash todo list accepted as Git proposes it, so it runs without an editor.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

`git rebase` **replays** your branch's commits on top of another commit — giving a straight history and a chance to tidy commits before review — but because it makes **new** commits, it must never be used on history others already share.

## Explain it like I'm twelve

You wrote two pages of a story starting from chapter 3. Meanwhile, chapter 4 was published. Rebasing is rewriting your two pages so they start after chapter 4 — the same ideas, but fresh copies. If your friends had already photocopied your old pages, their copies no longer fit the new story.

Where the analogy breaks: Git keeps the old pages for a while, and the reflog can find them.

## What problem it solves

Branches drift from `main`, and pull requests fill up with "fix typo" commits. A rebase brings a branch up to date with `main` without a merge commit, and history editing turns a messy branch into a few clear commits that are easy to review — and to revert later.

## How it works

![](media:git-github/rebase.svg)

- `git rebase main` finds where your branch left `main`, sets your changes aside, moves your branch to `main`'s tip, and replays each change as a new commit.
- `git commit --fixup <commit>` makes a commit titled `fixup! <title>`. A later `git rebase -i --autosquash` puts it right after its target and folds it in.
- Rewritten commits differ from what the remote has, so the next push must be forced. `--force-with-lease` only overwrites the remote branch if nobody else has pushed to it since you last fetched.

## Try it yourself

> **Local lab** — a new practice repository with a local bare remote. Every command is run automatically in DevForge's tests.

### 1. A branch that has fallen behind

```bash run
mkdir rebase-practice && cd rebase-practice
git init -q --bare origin.git
git init -q -b main work && cd work
git remote add origin ../origin.git
printf 'Monday: Lecture\n' > timetable.md && git add timetable.md && git commit -q -m "Add timetable"
git push -q -u origin main
git switch -q -c rooms
printf 'Monday: Room 101\n' > rooms.md && git add rooms.md && git commit -q -m "Add rooms"
printf 'Tuesday: Rom 204\n' >> rooms.md && git commit -q -am "Add Tuesday room"
git switch -q main
printf 'Friday: Quiz\n' > notices.md && git add notices.md && git commit -q -m "Add notices"
git log --oneline --graph --all
```

```text output
* 824a2d1 Add notices
| * ab2470c Add Tuesday room
| * ed003c3 Add rooms
|/
* d875f71 Add timetable
```

### 2. Rebase the branch onto main, and push it for review

```bash run
git switch -q rooms
before=$(git rev-parse --short HEAD)
git rebase -q main
git log --oneline --graph --all
echo "Add Tuesday room was $before, is now $(git rev-parse --short HEAD)"
git push -q -u origin rooms
```

```text output
* 06899aa Add Tuesday room
* c41b70c Add rooms
* 824a2d1 Add notices
* d875f71 Add timetable
Add Tuesday room was ab2470c, is now 06899aa
```

A straight line: the branch now starts after "Add notices", as if you had begun your work today. The commits have **new IDs** — the same changes, on a new parent. Rebasing was fine here because nobody else had the branch yet; then you pushed it.

### 3. A teammate adds to your branch

```bash run
git clone -q ../origin.git ../teammate && cd ../teammate
git switch -q rooms
printf 'Wednesday: Room 310\n' >> rooms.md
git commit -q -am "Add Wednesday room" && git push -q
cd ../work
```

You did not fetch, so your copy does not know about this commit.

### 4. Fix a typo the tidy way

There is a typo — "Rom 204". Instead of a commit called "fix typo", mark the fix as belonging to the commit that introduced it, then let an autosquash rebase fold it in:

```bash run
sed -i.bak 's/Rom 204/Room 204/' rooms.md && rm rooms.md.bak
git commit -q -a --fixup HEAD
git log --oneline main..rooms
GIT_SEQUENCE_EDITOR=true git rebase -q -i --autosquash main
git log --oneline main..rooms
cat rooms.md
```

```text output
5048102 fixup! Add Tuesday room
06899aa Add Tuesday room
c41b70c Add rooms
a6cc846 Add Tuesday room
c41b70c Add rooms
Monday: Room 101
Tuesday: Room 204
```

- `--fixup HEAD` titled the new commit `fixup! Add Tuesday room`.
- `git rebase -i --autosquash` prepared a todo list that folds the fixup into its target. `GIT_SEQUENCE_EDITOR=true` accepts that list as it is; run without it, Git opens the list in your editor so you can also reorder, reword or squash commits yourself.
- Your branch now has two clean commits. But you **rewrote commits you had already pushed**.

### 5. Push rewritten history — carefully

```bash run
git push -q 2> /dev/null || echo "normal push: rejected"
git push --force-with-lease 2> push.log && echo "pushed" || grep -o 'stale info' push.log
git fetch -q
git log --oneline -n 1 origin/rooms
```

```text output
normal push: rejected
stale info
560150f Add Wednesday room
```

- A normal push is rejected: the remote branch has commits that are not in yours.
- `--force-with-lease` is refused too (*stale info*): the remote branch is no longer where your copy, `origin/rooms`, said it was. A plain `--force` would have overwritten it — **deleting the teammate's commit without a warning**.
- After `git fetch`, you can see what you would have destroyed. The fix is to bring that commit into your branch — for example `git rebase origin/rooms`, resolving the conflict on `rooms.md` — and only then push; or, better, agree with your teammate not to rewrite a branch you both work on.

## Common mistakes

- **Rebasing shared branches.** Rebasing `main`, or a branch others work on, gives everyone diverged histories. Rebase only your own unshared work; on shared branches, merge or revert.
- **`--force` instead of `--force-with-lease`.** Plain force overwrites whatever is on the remote.
- **Giving up in the middle of a conflict.** A rebase stops at each conflicting commit; fix it, `git add`, `git rebase --continue` — or `git rebase --abort` to return to where you started.
- **Thinking a rebase destroyed work.** The old commits are still reachable through `git reflog` for a while.

## Where this fits in a real system

GitHub's **Rebase and merge** button and many teams' "rebase before review" rule use exactly this; protected branches on **GitHub** usually forbid force pushes to `main` entirely, and **GitHub Actions** re-runs the checks on every rewritten push.
