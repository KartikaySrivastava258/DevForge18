# Canteen pre-order app — reference

The product repository after release 1.1.0 (invented example data). The history, replayed by `prepare.sh`:

1. Import the app.
2. Three bug fixes, each in its own commit that starts with the work item key (CAFE-1, CAFE-2, CAFE-3), each
   with a test that failed before the fix.
3. Release notes and the Jira export, then the annotated tag `v1.1.0`.

`export.json` shows the triage workflow: every bug that was worked on passed through Triage first, carries a
severity label and a priority, and the three fixed bugs have fix version 1.1.0. Two bugs remain: one triaged
for 1.2.0, one not yet triaged.
