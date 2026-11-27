---
id: jira-hackathon-backlog
track: jira
title: Plan a hackathon product backlog
level: intermediate
estimated_hours: 5
prerequisites: [jira-work-items-and-workflows, jira-sprints-boards-and-wip, jira-reports-and-anti-patterns]
related_tracks: []
user_stories:
  - As a hackathon team member, I want a backlog split into must-have and later work so that we demo something finished instead of five half-built features.
  - As a team lead, I want the must-have work estimated and compared with our capacity so that we notice an impossible plan on Friday night, not on Sunday morning.
  - As a judge, I want the team's sprint goal in one sentence so that I can tell whether the demo delivered it.
acceptance_criteria:
  - The backlog has at least 2 epics, each with at least 2 stories.
  - Every story says "As a …, I want … so that …" and has an "Acceptance criteria" list with at least 2 items.
  - Every story is labelled exactly one of mvp or later; there are at least 5 mvp stories and at least 1 later.
  - Every mvp story is estimated with 1, 2, 3, 5 or 8 story points.
  - plan.md states a one-sentence sprint goal and the team's capacity in points, and the mvp total fits that capacity.
  - plan.md's "## MVP" section lists exactly the mvp story keys.
rubric:
  - { criterion: "Scope", excellent: "The MVP is the smallest set of stories that delivers the sprint goal end to end; nice-to-haves are clearly later, and big stories were split so that a useful part ships first.", good: "A sensible MVP that fits the capacity.", needs_work: "Everything is MVP, or the MVP cannot show the goal working." }
  - { criterion: "Estimates and capacity", excellent: "Capacity is based on evidence (past hackathons, hours available minus overhead), estimates are relative and consistent, and some slack is kept for the demo.", good: "Estimates and a capacity are given and compared.", needs_work: "Capacity is the sum of the estimates, or estimates are hours in disguise." }
  - { criterion: "Stories", excellent: "Each story is a thin vertical slice a user can try, with criteria that cover the failure cases.", good: "Clear stories with checkable criteria.", needs_work: "Technical layers as stories (\"build the database\"), or vague criteria." }
  - { criterion: "Sprint goal", excellent: "One sentence a judge can verify in the demo, naming the user and the outcome.", good: "A clear goal.", needs_work: "A list of features instead of a goal." }
hints:
  - Write the sprint goal first. Every story that is not needed to show the goal in the demo is a candidate for later.
  - An 8-point story is the biggest that fits; if something is bigger, ask what part of it a user could use on its own and make that the first story.
  - Story points are relative — compare each story with one you already estimated. Capacity comes from what similar teams finished before, not from the estimates.
  - The story-point field is a custom field. export.py asks Jira for every field's display name, so the check can find it whatever its id on your site.
stretch_goals:
  - Run the hackathon (or a two-day practice) from the board and compare the points finished with your capacity.
  - Add a definition of done to plan.md and check every MVP story against it before the demo.
  - Read the velocity report after two sprints (see "Reports, cycle time and anti-patterns") and say what it can and cannot tell you.
starter: starter
solution: solution
check_needs: [python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A team of four has 30 hours at a campus hackathon to build a helper for the college food drive. At the
kick-off they typed their brainstorm straight into Jira: a 20-point "map" story, a login story covering four
providers, a leaderboard labelled both must-have and later, and no plan. The starter is that export and an
empty `plan.md`.

Turn the brainstorm into a backlog the team can deliver. Decide what the demo must show (the sprint goal), what
is truly needed for it (the MVP), what waits, and whether the MVP fits the time you have. This is the planning
skill that matters most in short projects: cutting scope deliberately instead of running out of time.

The check reads your Jira export and `plan.md`. It cannot judge whether your goal is a good one — the rubric
does that — but it catches the mechanical problems: unlabelled stories, missing criteria, oversized estimates
and an MVP bigger than your capacity.

## Getting started

1. Copy the starter into a folder and run `bash check.sh .` on it to see the inherited problems.
2. In your own Jira project, create the epics and stories, label each story `mvp` or `later`, and fill in the
   story-point field for the MVP stories.
3. Write `plan.md`: a line `Sprint goal: …`, a line `Capacity: N points` with a short reasoning below it, and a
   `## MVP` section listing the MVP keys.
4. Export and check (see the top of `export.py` for creating the API token; never commit it):

   ```bash
   python3 export.py HACK
   bash check.sh .
   ```

   If your story-point field has another name, set it: `STORY_POINTS_FIELD="Estimate" bash check.sh .`
