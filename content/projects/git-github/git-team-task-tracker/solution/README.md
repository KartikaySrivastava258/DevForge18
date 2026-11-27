# Team task tracker

A small command-line task tracker for a study group. Run the tests with `python3 -m unittest`.

```bash
python3 tasks.py add "Write the report outline"   # Added task 1.
python3 tasks.py add "Book a meeting room"        # Added task 2.
python3 tasks.py done 1                           # Completed task 1.
python3 tasks.py list                             # every task, [x] when done
python3 tasks.py list --open                      # only the tasks still to do
```

Tasks are stored in `tasks.json` in the current folder (or the file named by `TASKS_FILE`). That file is
personal data and is ignored by Git.

## How we work

Every change goes through a branch and a pull request; main only changes by merging a reviewed pull request
with a merge commit, so `git log --first-parent main` reads as a list of merged pull requests. The pull request
template lists what a reviewer checks, and CODEOWNERS requests the review automatically.

## Backlog

1. ~~Mark a task as done~~ — merged from `feature/done-command`.
2. ~~Show only open tasks~~ — merged from `feature/list-open`.
3. ~~Review setup~~ — merged from `chore/review-setup`.
4. ~~Keep data out of Git~~ — merged with item 3.
