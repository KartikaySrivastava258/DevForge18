---
id: git-portfolio-repository
track: git-github
title: Personal developer portfolio repository
level: beginner
estimated_hours: 4
prerequisites: [git-first-commits, git-undoing-work-safely]
related_tracks: []
user_stories:
  - As a student looking for an internship, I want one repository that describes who I am and what I have built so that a recruiter can judge my work from a single link.
  - As a portfolio owner, I want a history of small, clearly described commits so that I (and anyone reviewing it) can see how the portfolio grew and undo a bad change.
  - As a portfolio owner, I want local secrets and log files kept out of Git so that nothing private is published when I push.
acceptance_criteria:
  - The folder is a Git repository whose current branch is main.
  - main has at least 5 commits, and every commit subject is 3 to 72 characters long, has at least three words and is not a placeholder such as "update", "wip" or "fix".
  - README.md is committed, has the sections "## About", "## Projects" and "## Contact", and contains no "TODO" placeholder.
  - At least two project write-ups are committed as Markdown files in projects/, each with a "## What I learned" section.
  - A committed .gitignore makes Git ignore .env files and *.log files.
  - No .env or *.log file appears in any commit, on any branch.
  - A LICENSE file is committed.
  - The working tree is clean — every change is committed or ignored.
rubric:
  - { criterion: "Commit history", excellent: "Each commit is one logical change with a subject that says what it does in the imperative (\"Add the weather app write-up\"); a reviewer can follow the story from git log --oneline alone.", good: "Commits are reasonably sized and described; a few mix unrelated changes.", needs_work: "One or two large commits, or subjects such as \"update\" that say nothing." }
  - { criterion: "Content of the README and write-ups", excellent: "Specific and honest: each project says what problem it solved, what the author did, the tools used and a concrete lesson learned; contact details are public-safe.", good: "All sections are present and accurate but some are generic.", needs_work: "Placeholders, copied text or claims that the projects do not support." }
  - { criterion: "Keeping private data out", excellent: ".gitignore is in the first or second commit, covers .env and logs, and git log --all shows nothing private was ever committed.", good: "Nothing private is committed, but .gitignore was added late.", needs_work: "A secret or log was committed, even if deleted in a later commit — it is still in history." }
  - { criterion: "Licence choice", excellent: "A standard licence chosen deliberately, with a sentence in the README saying what others may do with the code.", good: "A standard licence file is present.", needs_work: "No licence, so others have no right to reuse anything." }
hints:
  - Start with git init -b main, then commit the .gitignore before anything else. Run git status after every step — it tells you exactly what Git will and will not include.
  - Commit one thing at a time — the README skeleton, then each project write-up, then the licence. git add <file> followed by git commit -m "Add …" keeps each commit focused.
  - If you committed something by mistake and have not pushed yet, git reset --soft HEAD~1 undoes the commit but keeps your changes staged, so you can fix it and commit again (see "Undoing work safely").
  - To see every file that was ever committed on any branch, run git log --all --name-only --format= | sort -u.
stretch_goals:
  - Push the repository to GitHub, turn on GitHub Pages for the README, and add the link to your CV.
  - Add a third write-up for a project that failed, explaining what you would do differently.
  - Sign your commits (see "Protected branches, signed commits and secrets") and check that GitHub shows them as Verified.
starter: starter
solution: solution
check_needs: [git]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A portfolio repository is often the first thing a reviewer opens when you apply for an internship or a
research position. It shows two things at once: **what you have built** (the README and the write-ups) and
**how you work** (the commit history). A history of commits called "update" says as much about you as the
projects do.

In this project you build that repository locally with Git. The starter gives you a README skeleton, one
example write-up to replace, and a `.env` file of the kind a website's contact form needs — which must never
be committed. You decide the content; the acceptance criteria only fix the structure and the hygiene.

Write about real work, even small coursework. Do not invent projects, grades or employers: a reviewer who
asks one question about an invented project will notice, and the write-ups are worth more when they are
honest about what went wrong.

## Getting started

1. Make a new empty folder (for example `~/portfolio`) and copy the starter files into it.
2. Create the repository and the ignore rules first, so the `.env` file is never staged:

   ```bash
   cd ~/portfolio
   git init -b main
   git status            # .env and README.md are both "untracked" for now
   ```

   Write `.gitignore` (one pattern per line), run `git status` again and check that `.env` has disappeared from
   the list. Commit the `.gitignore` on its own.
3. Fill in the README one section at a time, replacing every `TODO`, and commit after each meaningful step.
4. Replace `projects/example-project.md` with two write-ups of your own (use `git mv` to rename it, so Git
   records a rename rather than a delete and an add).
5. Choose a licence (MIT is a common short one for code; <https://choosealicense.com> compares them) and commit
   it as `LICENSE`.
6. Run the check script from the folder above your project:

   ```bash
   bash check.sh ~/portfolio
   ```

   Each criterion prints `PASS` or `FAIL` with a reason. Fix the failures and run it again.

The check reads only your local repository; it does not need a GitHub account. Pushing to GitHub is a stretch
goal.
