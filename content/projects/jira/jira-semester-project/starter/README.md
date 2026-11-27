# Semester project board

Your team of four is building a library-catalogue web app this semester. Someone created a Jira project two
weeks ago and everyone has been "just adding tickets". `export.json` is what the board looks like now — run the
check on it to see what is wrong:

```bash
bash check.sh starter-folder
```

Then rebuild the plan in your own Jira project (a free Jira Cloud site is enough), work on it for a few weeks,
and export it with `export.py` (instructions at the top of that file). Your `export.json` replaces this one.

What a reviewer will look for:

- The semester's work grouped into epics, with every story and task inside one.
- Stories that say who wants what and why, each with acceptance criteria a tester can check with yes or no.
- Bug reports someone else could reproduce.
- A board that reflects reality: items move through In Progress to Done, and only a few are in progress at once.
