---
id: otel-latency-investigation
track: opentelemetry
title: Latency investigation challenge
level: advanced
estimated_hours: 6
prerequisites: [otel-traces-spans-and-context, otel-context-propagation, otel-correlating-signals]
related_tracks: [prometheus-grafana]
user_stories:
  - As a teacher, I want the class report to open in a fraction of a second so that I can check every class before the first lecture.
  - As an on-call developer, I want to find the cause of a slow request from its trace so that I fix the real problem instead of guessing.
  - As a future investigator, I want the trace to name the important work and its size so that a similar problem is obvious at a glance.
acceptance_criteria:
  - grades.js (another team's service) is unchanged, and the report's answer stays the same (30 students, average 70.6).
  - The 95th percentile of GET /report?class=CS-A over 40 requests is under 200 ms.
  - A report's trace shows at most 2 calls to the grades service (instead of one per student).
  - A span named "build report" records the attribute report.students.
  - FINDINGS.md explains the symptom, the evidence from the trace, the cause and the fix, each with numbers.
rubric:
  - { criterion: "Investigation", excellent: "The write-up starts from measured symptoms, shows the trace evidence (span count, durations, a trace ID), names the pattern and rules out other explanations.", good: "Cause found from the trace and explained.", needs_work: "The fix was guessed; the trace was never consulted." }
  - { criterion: "Fix", excellent: "Uses the existing batch endpoint, keeps the answer identical, handles an empty class, and considers the size limit of a batch request.", good: "Latency target met with the same answer.", needs_work: "Parallel requests that hide the N+1 problem, or a cache that returns stale grades." }
  - { criterion: "Instrumentation for the future", excellent: "The new span and attributes (class, number of students) make the next investigation start from the trace; no personal data in attributes.", good: "The required span and attribute are present.", needs_work: "No new instrumentation." }
  - { criterion: "Communication", excellent: "FINDINGS.md is short, precise and could be pasted into an incident review: before and after numbers, cause in one sentence, follow-ups.", good: "All four sections with numbers.", needs_work: "Vague text without measurements." }
hints:
  - Run the lab with docker compose, request one report, and open its trace in Jaeger. Count the spans under GET /report and look at how they line up in time.
  - Sequential calls add up — 30 calls of 20 ms are 600 ms however fast each one is. Read the top of grades.js for what else the service offers.
  - Running the 30 calls in parallel would also be faster, but it sends 30 times the load to the other team's service. Prefer the batch endpoint.
  - tracer.startActiveSpan("build report", async (span) => { …; span.end(); }) — set report.students on it, and end it in finally.
  - Measure before and after the same way (for example 40 requests, sorted durations, the 38th value is the 95th percentile) and put both numbers in FINDINGS.md.
stretch_goals:
  - Add a histogram metric for report latency (see "Metrics and logs with OpenTelemetry") and show the change on a graph.
  - Add a second slow path (for example an unindexed lookup) and see whether a colleague can find it from the trace alone.
  - Propose an SLO for the report endpoint and an alert that would have caught the problem (see the Prometheus track).
starter: starter
solution: solution
check_needs: [docker, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Teachers open the class report — `GET /report?class=CS-A` on the `report` service — for every class every
morning, and it takes well over half a second. Both services are already traced with OpenTelemetry, so the
evidence is there: find the cause **from the traces**, fix it in the report service (the grades service belongs
to another team and must not change), add instrumentation that would make the next investigation faster, and
write a short findings report.

This is the everyday use of tracing: not collecting spans for their own sake, but answering "where did the time
go?" with evidence, and proving the fix with the same measurement.

## Getting started

1. Copy the starter folder, install the dependencies and start the lab:

   ```bash
   npm install
   docker compose up -d
   curl -s "http://localhost:8080/report?class=CS-A"
   ```

2. Open Jaeger at http://localhost:16686, choose the service `report`, and open a trace of `GET /report`.
3. Measure before you change anything, for example:

   ```bash
   for i in $(seq 40); do curl -s -o /dev/null -w '%{time_total}\n' "http://localhost:8080/report?class=CS-A"; done | sort -n | sed -n 38p
   ```

4. Fix `report.js`, restart (`docker compose restart report`), measure again, and fill in `FINDINGS.md`.
5. `docker compose down`, then run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
