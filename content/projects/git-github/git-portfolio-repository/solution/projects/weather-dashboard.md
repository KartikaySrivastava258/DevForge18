# Campus weather dashboard

## The problem

Students planning outdoor events kept asking in the class group whether it would rain that evening. The
forecast sites show a whole city; we wanted the next 12 hours for the campus only, on one screen.

## What I built

A static web page (HTML, CSS and plain JavaScript) that calls a public weather forecast API for the campus
coordinates and draws an hourly bar chart of rain probability. I wrote the data fetching and the chart; my
teammate designed the layout.

## What I learned

The API returns times in UTC. Our first version showed rain three hours too early for anyone checking from a
phone in local time. I now convert times at the edge of the program and keep UTC everywhere else, and I test
with a time zone that is not my own.
