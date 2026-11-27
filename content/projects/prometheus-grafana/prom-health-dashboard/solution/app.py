"""The campus API's metrics, as a stand-in you can run locally: a tiny HTTP server that serves /metrics in
Prometheus' text format and simulates traffic on each scrape (about 2% errors, latencies of 20-900 ms).
Run: python3 app.py   (listens on port 8000). Standard library only."""
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

ROUTES = ["/timetable", "/results", "/library/search"]
BUCKETS = [0.05, 0.1, 0.25, 0.5, 1.0]
rng = random.Random(42)
requests = {(r, c): 0 for r in ROUTES for c in ("200", "500")}
buckets = {(r, b): 0 for r in ROUTES for b in BUCKETS + ["+Inf"]}
sums = {r: 0.0 for r in ROUTES}

def simulate(n=50):
    for _ in range(n):
        route = rng.choice(ROUTES)
        code = "500" if rng.random() < 0.02 else "200"
        seconds = rng.choice([0.02, 0.04, 0.08, 0.12, 0.2, 0.3, 0.45, 0.9])
        requests[(route, code)] += 1
        sums[route] += seconds
        for b in BUCKETS:
            if seconds <= b:
                buckets[(route, b)] += 1
        buckets[(route, "+Inf")] += 1

def render():
    out = ["# HELP http_requests_total Requests served.", "# TYPE http_requests_total counter"]
    out += [f'http_requests_total{{route="{r}",code="{c}"}} {v}' for (r, c), v in requests.items()]
    out += ["# HELP http_request_duration_seconds Time to serve a request.", "# TYPE http_request_duration_seconds histogram"]
    for r in ROUTES:
        out += [f'http_request_duration_seconds_bucket{{route="{r}",le="{b}"}} {buckets[(r, b)]}' for b in BUCKETS + ["+Inf"]]
        out += [f'http_request_duration_seconds_sum{{route="{r}"}} {sums[r]:.3f}', f'http_request_duration_seconds_count{{route="{r}"}} {buckets[(r, "+Inf")]}']
    return "\n".join(out) + "\n"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/metrics":
            self.send_error(404)
            return
        simulate()
        body = render().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass

if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
