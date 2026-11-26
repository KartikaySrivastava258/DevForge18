"""Figure for otel-metrics-and-logs; run: python3 scripts/figures/opentelemetry/three-signals.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "Three signals through one Collector, from Metrics and logs with OpenTelemetry.")
f.box(10, 30, 210, 230, "f-box-accent"); f.text(115, 54, "checkout (Node SDK)", "f-small f-strong", fit=200)
f.box(25, 70, 180, 50, "f-box-faint"); f.text(115, 91, "Tracer → spans", "f-small f-mono", fit=170); f.text(115, 110, "trace + span IDs", "f-small", fit=170)
f.box(25, 130, 180, 50, "f-box-faint"); f.text(115, 151, "Meter → counter,", "f-small f-mono", fit=170); f.text(115, 170, "histogram (aggregated)", "f-small", fit=170)
f.box(25, 190, 180, 55, "f-box-faint"); f.text(115, 211, "Logger → records", "f-small f-mono", fit=170); f.text(115, 231, "stamped with active span", "f-small", fit=170)
f.box(270, 30, 210, 230, "f-box-faint"); f.text(375, 54, "Collector", "f-small f-strong")
f.text(375, 98, "pipeline: traces", "f-small f-mono", fit=200); f.text(375, 158, "pipeline: metrics", "f-small f-mono", fit=200); f.text(375, 218, "pipeline: logs", "f-small f-mono", fit=200)
f.box(530, 70, 180, 50, "f-box-ok"); f.text(620, 99, "Jaeger", "f-small f-strong")
f.box(530, 130, 180, 50, "f-box-ok"); f.text(620, 159, "Prometheus / Grafana", "f-small f-strong", fit=170)
f.box(530, 190, 180, 55, "f-box-ok"); f.text(620, 222, "log store", "f-small f-strong")
for y in (95, 155, 217):
    f.arrow([(207, y), (268, y)]); f.arrow([(482, y), (528, y)])
f.text(360, 286, "OTLP/HTTP from the SDK · the trace ID in each log record links it to its trace", "f-small", fit=700)
write(ROOT, "opentelemetry", "three-signals", f,
      "The checkout service runs the OpenTelemetry Node SDK with three parts: a Tracer that produces spans with trace and span IDs, a Meter that produces a counter and a histogram as aggregated values, and a Logger whose records are stamped with the active span. All three are sent over OTLP/HTTP to one Collector, which has a separate pipeline for traces, metrics and logs. Traces go on to Jaeger, metrics to Prometheus and Grafana, and logs to a log store. The trace ID in each log record links it to its trace.",
      "One SDK and one Collector for all three signals; the trace ID ties a log line to its trace.")
