# Library queue simulator

## The problem

During exam weeks the queue at the library issue desk grew long, and the staff wanted to know whether opening
a third desk for two hours a day would make a real difference before moving people around.

## What I built

A Python discrete-event simulation: arrivals follow the hourly counts the library recorded for two weeks, and
each desk serves one student at a time. The program reports the average and 90th-percentile wait for two or
three open desks.

## What I learned

My first model used the daily average arrival rate and showed almost no queue. The real problem was the
45-minute rush after lectures end, so averages hid it. Modelling the hourly pattern — and reporting the
90th percentile, not just the mean — changed the answer.
