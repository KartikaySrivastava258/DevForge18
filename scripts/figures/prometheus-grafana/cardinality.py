"""Figure for prometheus-cardinality-and-long-term-storage; run: python3 scripts/figures/prometheus-grafana/cardinality.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Series, relabelling and long-term storage, from Cardinality and long-term storage.")
f.box(10, 30, 200, 110, "f-box-danger"); f.text(110, 54, "shop_cart_items", "f-small f-strong f-mono"); f.text(110, 78, "{user_id=\"u1\"} …", "f-small f-mono"); f.text(110, 98, "{user_id=\"u500\"}", "f-small f-mono"); f.text(110, 122, "= 500 series", "f-small f-strong")
f.box(10, 160, 200, 70, "f-box-ok"); f.text(110, 184, "shop_carts_open 429", "f-small f-mono", fit=190); f.text(110, 206, "= 1 series", "f-small f-strong")
f.box(260, 60, 210, 140, "f-box-accent"); f.text(365, 84, "Prometheus", "f-small f-strong"); f.text(365, 108, "metric_relabel_configs:", "f-small f-mono", fit=200); f.text(365, 128, "drop shop_cart_items", "f-small f-mono", fit=200); f.text(365, 152, "scraped 501, kept 1", "f-small"); f.text(365, 176, "retention 2d", "f-small f-mono")
f.box(520, 60, 190, 140, "f-box"); f.text(615, 84, "long-term store", "f-small f-strong"); f.text(615, 108, "remote_write", "f-small f-mono"); f.text(615, 132, "retention 400d", "f-small f-mono"); f.text(615, 160, "Thanos, Mimir,", "f-small f-muted"); f.text(615, 180, "VictoriaMetrics …", "f-small f-muted")
f.arrow([(212, 90), (258, 110)]); f.arrow([(212, 195), (258, 160)]); f.arrow([(472, 130), (518, 130)])
f.text(360, 262, "fix labels in the code; relabel to protect Prometheus meanwhile", "f-small f-muted", fit=640)
write(ROOT, "prometheus-grafana", "cardinality", f,
      "The metric shop_cart_items with a user_id label from u1 to u500 is 500 series; the aggregated shop_carts_open 429 is 1 series. Prometheus drops shop_cart_items with metric_relabel_configs, so of 501 scraped samples it keeps 1, and keeps local data for 2 days. It sends samples with remote_write to a long-term store with 400 days of retention, such as Thanos, Mimir or VictoriaMetrics. Fix labels in the code; relabel to protect Prometheus meanwhile.",
      "Every label value is a series: keep labels bounded, and keep history in a long-term store.")
