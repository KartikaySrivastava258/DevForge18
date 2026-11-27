# Jira — research notes

Checked 2026-11-27 (UTC). Reuse these in lessons; add to them instead of researching again.

Jira is a hosted service, so its own screens stay `docs-checked`. Lessons 4–5 are executed: they compute flow metrics with Python's standard library from a made-up sample written in the shape of Jira's REST API, so no Jira site (or account) is needed.

## Facts confirmed (source → wording)

- REST API v3, issues (developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/): changelog `histories[]` each with `created` and `items[]` of `field`, `fromString`, `toString`; there is also a bulk-fetch-changelogs endpoint.
- Cumulative flow diagram (support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-cumulative-flow-diagram/): each coloured area is a workflow status; an area "widening vertically over time" generally marks a bottleneck.
- Control chart (…/view-and-understand-the-control-chart/): cycle time (or lead time) per work item for chosen statuses, with average, rolling average and standard deviation; company-managed spaces only.
- Velocity chart (…/view-and-understand-the-velocity-chart/): based on story points, original time, work item count or a numeric custom field; commitment = estimate at sprint start (later changes excluded), completed = estimates completed by sprint end.
- Burndown chart (…/view-and-understand-the-burndown-chart/): remaining work over the sprint, to judge the likelihood of reaching the sprint goal.
- Little's Law: Little, J. D. C. (1961), "A Proof for the Queuing Formula: L = λW", Operations Research 9(3), 383–387, doi:10.1287/opre.9.3.383 — metadata checked via Crossref (the publisher page refuses automated requests). Also: Little (2011), "Little's Law as Viewed on Its 50th Anniversary", Operations Research.

## Observed while building lessons

- In a short, unstable window Little's Law does not balance (WIP ÷ throughput 10.6 days vs measured 7.5): items that start in the window and finish after it are missing from the measured figure. The lesson uses the mismatch to teach the stability condition.
- A resource `type: paper` is not allowed by the content schema; use `reference`.
- When the content build rejects a lesson, the lesson tests silently select nothing for it — always run `npm run content:build` before trusting a "pass".
