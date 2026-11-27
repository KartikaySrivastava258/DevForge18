# Campus API health dashboard

The campus API (timetable, results and library search) exposes Prometheus metrics. `app.py` is a stand-in
that serves the same metrics on port 8000 with simulated traffic, so you can build the monitoring on your own
machine:

- `http_requests_total{route, code}` — a counter of requests served.
- `http_request_duration_seconds_bucket{route, le}` (with `_sum` and `_count`) — a histogram of how long requests took.

Build the first dashboard the team will open when someone says "the API is slow":

1. `prometheus.yml`: scrape the API as job `campus-api` at `app:8000` (the name it has on the Docker network)
   at least every 15 seconds.
2. `dashboard.json` (a Grafana dashboard): a uid, a title, and at least four panels — whether the API is up,
   requests per second by route, the error ratio (5xx ÷ all requests) and the 95th percentile latency in
   seconds. Every query must return data.

The starter files are a first attempt that does not work yet.
