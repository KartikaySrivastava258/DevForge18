"""Figure for prometheus-slos-and-error-budgets; run: python3 scripts/figures/prometheus-grafana/error-budget.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "From SLO to burn-rate alerts, from SLIs, SLOs and error budgets.")
f.box(10, 30, 210, 90, "f-box"); f.text(115, 54, "SLO 99.9% / 30 days", "f-small f-strong", fit=200); f.text(115, 78, "error budget 0.1%", "f-small"); f.text(115, 100, "≈ 43 minutes of outage", "f-small", fit=200)
f.box(260, 30, 200, 90, "f-box-accent"); f.text(360, 54, "burn rate", "f-small f-strong"); f.text(360, 78, "error ratio ÷ 0.001", "f-small f-mono", fit=190); f.text(360, 100, "1 = budget lasts 30 days", "f-small", fit=190)
f.box(500, 20, 210, 64, "f-box-danger"); f.text(605, 44, "page: 1h and 5m > 14.4", "f-small f-strong", fit=200); f.text(605, 66, "outage: burn 20", "f-small")
f.box(500, 100, 210, 64, "f-box-warn"); f.text(605, 124, "page: 6h and 30m > 6", "f-small f-strong", fit=200); f.text(605, 146, "slow leak: burn 8", "f-small")
f.box(500, 180, 210, 64, "f-box-ok"); f.text(605, 204, "no alert", "f-small f-strong"); f.text(605, 226, "healthy: burn 0.5", "f-small")
f.arrow([(222, 75), (258, 75)]); f.arrow([(462, 60), (498, 52)]); f.arrow([(462, 90), (498, 130)]); f.arrow([(462, 105), (498, 205)])
f.text(235, 200, "proved by promtool test rules", "f-small f-muted", fit=400)
write(ROOT, "prometheus-grafana", "error-budget", f,
      "An SLO of 99.9% over 30 days gives an error budget of 0.1%, about 43 minutes of full outage. The burn rate is the error ratio divided by 0.001; a burn rate of 1 makes the budget last exactly 30 days. An outage with burn rate 20 trips the page alert for 1 hour and 5 minutes above 14.4. A slow leak with burn rate 8 trips the page alert for 6 hours and 30 minutes above 6. A healthy service at burn rate 0.5 raises no alert. Each scenario is proved by promtool test rules.",
      "Alert on how fast the budget is burning, with a long and a short window.")
