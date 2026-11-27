# Team task tracker

A small command-line task tracker for a study group: `python3 tasks.py add "…"` and `python3 tasks.py list`.
Run the tests with `python3 -m unittest`.

## Backlog

Each item below is one branch and one pull request. Do not commit to main directly.

1. **Mark a task as done.** `python3 tasks.py done 2` marks task 2 as done and prints `Completed task 2.`;
   an unknown id prints an error and exits with status 1. Add tests.
2. **Show only open tasks.** `python3 tasks.py list --open` lists only the tasks that are not done. Add tests.
3. **Review setup.** Add a pull request template with a checklist, and a CODEOWNERS file so that every pull
   request asks the right person for review.
4. **Keep data out of Git.** `tasks.json` is personal data created when you run the program; it must not be
   committed.
