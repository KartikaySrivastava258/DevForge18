"""Reference architecture: metrics, logs and traces; run: python3 scripts/figures/architecture/observability-stack.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 340, "Reference architecture: metrics, logs and traces for a service.")
# Instrumented services
f.box(10, 50, 130, 60, "f-box"); f.text(75, 76, "service A", "f-small f-strong", fit=120); f.text(75, 94, "OTel SDK", "f-small", fit=120)
f.box(10, 190, 130, 60, "f-box"); f.text(75, 216, "service B", "f-small f-strong", fit=120); f.text(75, 234, "OTel SDK", "f-small", fit=120)
f.arrow([(50, 112), (50, 188)]); f.text(100, 155, "traceparent", "f-small f-muted", fit=80)
# Collector
f.box(190, 110, 140, 100, "f-box-accent"); f.text(260, 140, "OTel Collector", "f-small f-strong", fit=130); f.text(260, 160, "batch, sample,", "f-small", fit=130); f.text(260, 176, "one pipeline", "f-small", fit=130); f.text(260, 192, "per signal", "f-small", fit=130)
f.arrow([(142, 80), (188, 135)]); f.arrow([(142, 220), (188, 185)])
f.text(165, 160, "OTLP", "f-small f-muted", fit=40)
# Back ends
f.box(390, 20, 140, 60, "f-box-ok"); f.text(460, 46, "Jaeger", "f-small f-strong", fit=130); f.text(460, 64, "traces", "f-small", fit=130)
f.box(390, 130, 140, 60, "f-box-faint"); f.text(460, 156, "log store", "f-small f-strong", fit=130); f.text(460, 174, "logs + trace IDs", "f-small", fit=130)
f.box(390, 240, 140, 60, "f-box-ok"); f.text(460, 266, "Prometheus", "f-small f-strong", fit=130); f.text(460, 284, "scrape, SLO rules", "f-small", fit=130)
f.arrow([(332, 130), (388, 50)]); f.arrow([(332, 160), (388, 160)]); f.arrow([(332, 190), (388, 265)])
# Grafana and Alertmanager
f.box(600, 90, 140, 80, "f-box"); f.text(670, 120, "Grafana", "f-small f-strong", fit=130); f.text(670, 140, "dashboards query", "f-small", fit=130); f.text(670, 156, "all three", "f-small", fit=130)
f.arrow([(598, 110), (532, 55)]); f.arrow([(598, 130), (532, 160)]); f.arrow([(598, 160), (532, 255)])
f.box(600, 240, 140, 60, "f-box-warn"); f.text(670, 266, "Alertmanager", "f-small f-strong", fit=130); f.text(670, 284, "route, page on-call", "f-small", fit=130)
f.arrow([(532, 280), (598, 280)]); f.text(565, 272, "burn rate", "f-small f-muted", fit=60)
f.text(380, 328, "all components run as containers (Docker Compose locally)", "f-small", fit=500)
write(ROOT, "architecture", "observability-stack", f,
      "Two services instrumented with the OpenTelemetry SDK pass trace context to each other in a traceparent header and send their spans, metrics and logs over OTLP to one OpenTelemetry Collector, which batches and samples them and runs one pipeline per signal. The Collector exports traces to Jaeger, logs (which carry trace IDs) to a log store, and metrics to Prometheus, which scrapes them and evaluates SLO rules. Prometheus sends burn-rate alerts to Alertmanager, which routes them and pages the on-call person. Grafana dashboards query Jaeger, the log store and Prometheus. All components run as containers, with Docker Compose locally.",
      "One Collector receives every signal; metrics raise the alert, logs and traces explain it.")
