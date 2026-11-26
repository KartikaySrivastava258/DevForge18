"""Figure for prometheus-metric-types-done-right; run: python3 scripts/figures/prometheus-grafana/metric-types.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Three metric types, from Counters, gauges and histograms done right.")
f.box(10, 30, 220, 110, "f-box-accent"); f.text(120, 54, "counter", "f-small f-strong"); f.text(120, 78, "shop_requests_total 7", "f-small f-mono", fit=210); f.text(120, 100, "only goes up; reset = restart", "f-small", fit=210); f.text(120, 122, "use rate(), increase()", "f-small f-mono", fit=210)
f.box(250, 30, 220, 110, "f-box-ok"); f.text(360, 54, "gauge", "f-small f-strong"); f.text(360, 78, "shop_requests_in_flight 0", "f-small f-mono", fit=210); f.text(360, 100, "goes up and down", "f-small"); f.text(360, 122, "read it, or max_over_time", "f-small", fit=210)
f.box(490, 30, 220, 110, "f-box-warn"); f.text(600, 54, "histogram", "f-small f-strong"); f.text(600, 78, "_bucket{le}, _sum, _count", "f-small f-mono", fit=210); f.text(600, 100, "cumulative buckets", "f-small"); f.text(600, 122, "histogram_quantile()", "f-small f-mono")
labels = ["≤0.05", "≤0.1", "≤0.25", "≤0.5", "≤1", "+Inf"]
vals = [2, 5, 5, 6, 7, 7]
for i, (l, v) in enumerate(zip(labels, vals)):
    x = 30 + i * 110
    f.box(x, 230 - v * 10, 70, v * 10, "f-box-faint")
    f.text(x + 35, 222 - v * 10, str(v), "f-small f-mono")
    f.text(x + 35, 250, l, "f-small f-mono")
f.text(360, 272, "7 requests, cumulative: median 0.075 s, p90 0.65 s, average 0.21 s", "f-small f-muted", fit=700)
write(ROOT, "prometheus-grafana", "metric-types", f,
      "Three metric types. A counter such as shop_requests_total 7 only goes up, a reset means a restart, and it is used with rate and increase. A gauge such as shop_requests_in_flight 0 goes up and down and is read directly or with max_over_time. A histogram has _bucket series with an le label, plus _sum and _count; its buckets are cumulative and quantiles come from histogram_quantile. Below, the lab's cumulative bucket counts for 7 requests: 2 at or under 0.05 seconds, 5 at or under 0.1, 5 at or under 0.25, 6 at or under 0.5, 7 at or under 1 and 7 in +Inf, giving a median of 0.075 seconds, a 90th percentile of 0.65 seconds and an average of 0.21 seconds.",
      "Counters accumulate, gauges move, histograms keep the shape of a distribution.")
