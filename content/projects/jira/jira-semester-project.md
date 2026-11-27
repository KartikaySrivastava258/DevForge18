---
id: jira-semester-project
track: jira
title: Manage a semester software project
level: beginner
estimated_hours: 6
prerequisites: [jira-work-items-and-workflows, jira-sprints-boards-and-wip]
related_tracks: []
user_stories:
  - As a student team member, I want the semester's work split into epics and stories so that each of us knows what to pick up next.
  - As a tester on the team, I want every story to have acceptance criteria so that I can say "done" or "not done" without a debate.
  - As a course supervisor, I want the board to show what is really in progress so that I can spot a team that is stuck before the deadline.
acceptance_criteria:
  - export.json holds at least 10 work items from one Jira project.
  - The work is grouped into at least 2 epics, and every story and task has an epic as its parent.
  - There are at least 6 stories; each says "As a …, I want … so that …" and has an "Acceptance criteria" list with at least 2 items.
  - At least one bug has steps to reproduce, the expected and the actual behaviour.
  - At least 5 items have moved between statuses and at least one is Done; every Done item went through In Progress.
  - No more than 3 items are In Progress at once.
rubric:
  - { criterion: "Breaking down the work", excellent: "Epics match real goals of the product; stories are small enough to finish in a few days and each delivers something a user can see or a tester can check.", good: "Sensible epics and stories; a few stories are too large or are really technical tasks.", needs_work: "One epic holding everything, or tickets named after people or days." }
  - { criterion: "Acceptance criteria", excellent: "Every criterion can be answered yes or no by someone who did not write it, including error cases.", good: "Criteria exist and are mostly checkable.", needs_work: "Criteria such as \"works well\" or \"is fast\"." }
  - { criterion: "Bug reports", excellent: "Steps, expected and actual results, environment and evidence; another student could reproduce the bug from the report alone.", good: "Steps, expected and actual are present.", needs_work: "\"It doesn't work\"." }
  - { criterion: "Board hygiene", excellent: "Statuses are updated as work happens, work in progress stays within the limit, and the team can explain one decision the board helped them make.", good: "The board is mostly up to date.", needs_work: "Items jump from To Do to Done at the end, or everything is In Progress." }
hints:
  - Start from the goals of the semester (what a user will be able to do by the end), not from the list of technologies. Each goal is an epic.
  - A story is written from a user's point of view; set-up work such as CI is a task. Both belong to an epic.
  - Write acceptance criteria as a heading "Acceptance criteria" followed by a bulleted list in the description. Each bullet is one check that is either true or false.
  - Move your own work items when you start and finish them — a board updated once a week cannot show where work is stuck.
  - Run the check on the starter's export.json first; every FAIL line is a common mistake you can avoid.
stretch_goals:
  - Run two one-week sprints with a sprint goal each, and write three sentences on what the burndown showed.
  - Add the work item key to your branch names and commit messages (see "Linking work items to branches and commits") and show the development panel in Jira for one story.
  - Compute your team's cycle times from export.json with the script from "Kanban and flow metrics in depth".
starter: starter
solution: solution
check_needs: [python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Four students are building a library-catalogue web app over a semester. Two weeks in, their Jira project is a
pile of tickets called "login", "frontend stuff" and "fix bug": nobody can tell what is finished, what is next or
how far the team is from the deadline. The starter's `export.json` is that board, exported.

Plan the project properly in **your own Jira project** (a free Jira Cloud site is enough for a team of this
size), work from it for a few weeks, and export it. The check reads the export and looks for the habits that
make a board useful: epics that describe goals, stories that say who needs what and why, acceptance criteria
someone else can test, bugs someone else can reproduce, and statuses that match reality.

Jira itself does not run inside DevForge. The check works on the export — the same JSON Jira's REST API
returns — so it judges the structure and the history of your work items, not the screens.

## Getting started

1. Copy the starter files into a folder, and run the check on the inherited board to see the problems:

   ```bash
   bash check.sh path/to/starter-copy
   ```

2. Create a Jira project (Scrum or Kanban). Add epics for the semester's goals, then stories and tasks inside
   them. Write each story's description as "As a …, I want … so that …", then a heading **Acceptance
   criteria** and a bulleted list.
3. Work from the board for at least two weeks: move items to In Progress when you start them and to Done when
   their acceptance criteria are met. Keep work in progress to three items or fewer.
4. Export your project. Create an API token in your Atlassian account settings and run:

   ```bash
   export JIRA_SITE=https://your-team.atlassian.net JIRA_EMAIL=you@college.example
   read -rs JIRA_API_TOKEN && export JIRA_API_TOKEN    # paste the token; it is not shown or saved
   python3 export.py SEM                                # your project's key
   bash check.sh .
   ```

   If your board's statuses have other names, tell the check: `IN_PROGRESS_STATUS="Doing" DONE_STATUS="Finished" bash check.sh .`

Never commit the API token. `export.json` contains your work items' text, so share it only with your team and
supervisor.
