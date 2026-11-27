# Canteen pre-order app

Students pre-order lunch from the college canteen with this app; `cart.py` adds up an order. Three bugs were
reported this week, and the team wants to ship a bug-fix release, 1.1.0. Right now there is no workflow: bugs
are filed without a severity, work starts before anyone has looked at them, commits do not say which bug they
fix, and nobody can say what is in a release.

Your job:

1. In your Jira project, add a **Triage** status between To Do and In Progress, and triage the bugs: a severity
   label (`severity-critical`, `severity-major` or `severity-minor`), a priority and, if they will be fixed now,
   the fix version 1.1.0.
2. Reproduce and fix the bugs in `cart.py`, each with a test, each in its own commit whose message starts with the
   work item key (for example `CAFE-1 Apply a discount code only once`).
3. Write `RELEASE_NOTES.md` (starting with `# Release 1.1.0`) listing exactly what is in the release, export the
   board with `export.py`, commit, and tag the release with an annotated tag `v1.1.0`.

Run `python3 -m unittest` for the tests and `bash check.sh .` for the workflow.
