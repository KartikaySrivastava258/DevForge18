"""Send one sample of each signal from the "orders-api" service to a Collector, over OTLP/HTTP with JSON
encoding — the same data the check sends. Standard library only.

    python3 send_sample.py http://127.0.0.1:4318

Sends: a trace with a request span (GET /orders, with a user.email attribute that must be removed) and a
health-check span (GET /healthz, which must be dropped); the counter orders.created; and an ERROR log record that
belongs to the request span and also carries user.email.
"""
import json
import sys
import time
import urllib.request

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN_ID = "00f067aa0ba902b7"
HEALTH_TRACE_ID = "7d3a1e5c9b2f4a6e8c0d1f3b5a7e9c11"


def attr(key, value):
    kind = "intValue" if isinstance(value, int) else "stringValue"
    return {"key": key, "value": {kind: str(value) if kind == "intValue" else value}}


def post(endpoint, path, body):
    request = urllib.request.Request(endpoint.rstrip("/") + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        print(path, response.status)


def main(endpoint):
    now = time.time_ns()
    resource = {"attributes": [attr("service.name", "orders-api")]}
    post(endpoint, "/v1/traces", {"resourceSpans": [{"resource": resource, "scopeSpans": [{"scope": {"name": "sample"}, "spans": [
        {"traceId": TRACE_ID, "spanId": SPAN_ID, "name": "GET /orders", "kind": 2,
         "startTimeUnixNano": str(now - 120_000_000), "endTimeUnixNano": str(now),
         "attributes": [attr("http.route", "/orders"), attr("user.email", "asha@college.example"), attr("orders.count", 3)]},
        {"traceId": HEALTH_TRACE_ID, "spanId": "1111111111111111", "name": "GET /healthz", "kind": 2,
         "startTimeUnixNano": str(now - 1_000_000), "endTimeUnixNano": str(now)},
    ]}]}]})
    post(endpoint, "/v1/metrics", {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"scope": {"name": "sample"}, "metrics": [
        {"name": "orders.created", "unit": "1", "sum": {"aggregationTemporality": 2, "isMonotonic": True, "dataPoints": [
            {"asInt": "3", "startTimeUnixNano": str(now - 60_000_000_000), "timeUnixNano": str(now)}]}},
    ]}]}]})
    post(endpoint, "/v1/logs", {"resourceLogs": [{"resource": resource, "scopeLogs": [{"scope": {"name": "sample"}, "logRecords": [
        {"timeUnixNano": str(now), "severityNumber": 17, "severityText": "ERROR",
         "body": {"stringValue": "payment failed for order 1013"}, "traceId": TRACE_ID, "spanId": SPAN_ID,
         "attributes": [attr("order.id", 1013), attr("user.email", "asha@college.example")]},
    ]}]}]})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4318")
