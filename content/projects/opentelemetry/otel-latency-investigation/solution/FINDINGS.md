# Findings: slow class report

## Symptom

GET /report?class=CS-A took 683 ms at the 95th percentile over 40 requests (measured by the check on the
original code), far above the 200 ms target. Every class report is equally slow; the answer itself is correct.

## Evidence

The trace of one report request in Jaeger (service report) shows the server span GET /report with 30 child
client spans, GET /grades/1 to GET /grades/30, one after another, each about 20 ms, each matched by a server
span in the grades service. Almost all of the report's time is inside those 30 sequential calls.

## Cause

The report service fetches grades one student at a time and waits for each answer before asking for the next:
the N+1 request pattern. 30 students × about 20 ms per round trip is about 600 ms, no matter how fast each call
is. The grades service already offers GET /grades?ids=1,2,3 for several students in one call.

## Fix

report.js now asks for all 30 grades in one batch request (GET /grades?ids=…) inside a new span "build report"
with the attribute report.students = 30. The answer is unchanged (average 70.6), the trace shows 1 call instead
of 30, and the 95th percentile dropped from 683 ms to 33 ms over 40 requests.
