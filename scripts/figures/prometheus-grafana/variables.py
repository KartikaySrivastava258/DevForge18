"""Figure for grafana-dashboards-and-variables; run: python3 scripts/figures/prometheus-grafana/variables.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "How a dashboard variable works, from Grafana dashboards and variables.")
f.box(10, 30, 220, 100, "f-box-accent"); f.text(120, 54, "variable route", "f-small f-strong f-mono"); f.text(120, 78, "label_values(", "f-small f-mono"); f.text(120, 98, "devforge_http_requests", "f-small f-mono", fit=210); f.text(120, 118, "_total, route)", "f-small f-mono")
f.box(270, 30, 200, 100, "f-box"); f.text(370, 54, "Prometheus", "f-small f-strong"); f.text(370, 78, "/api/v1/label/route/", "f-small f-mono", fit=190); f.text(370, 98, "values", "f-small f-mono"); f.text(370, 118, "→ 5 routes", "f-small")
f.box(510, 30, 200, 100, "f-box-ok"); f.text(610, 54, "dropdown", "f-small f-strong"); f.text(610, 78, "/api/search ✓", "f-small f-mono"); f.text(610, 98, "/api/tracks ✓", "f-small f-mono"); f.text(610, 118, "…", "f-small")
f.box(160, 170, 400, 70, "f-box-warn"); f.text(360, 194, "route=~\"$route\"  becomes", "f-small f-mono", fit=390); f.text(360, 216, "route=~\"(/api/tracks|/api/search)\"", "f-small f-mono", fit=390)
f.arrow([(232, 80), (268, 80)]); f.arrow([(472, 80), (508, 80)]); f.arrow([(610, 132), (500, 168)])
f.text(360, 264, "URL: ?var-route=/api/search&var-route=/api/tracks", "f-small f-muted f-mono", fit=640)
write(ROOT, "prometheus-grafana", "variables", f,
      "The variable route uses label_values(devforge_http_requests_total, route). Grafana asks Prometheus at /api/v1/label/route/values and gets 5 routes, which fill a dropdown where /api/search and /api/tracks are selected. Grafana then substitutes the selection into the panel query, so route=~\"$route\" becomes route=~\"(/api/tracks|/api/search)\". The selection is kept in the URL as var-route=/api/search and var-route=/api/tracks.",
      "Values from the data, substituted into every panel, kept in the URL.")
