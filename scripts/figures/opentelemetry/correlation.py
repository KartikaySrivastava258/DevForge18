"""Figure for otel-correlating-signals; run: python3 scripts/figures/opentelemetry/correlation.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 260, "Following an incident across signals, from From alert to root cause.")
f.box(10, 40, 210, 140, "f-box-accent"); f.text(115, 64, "1. metric (that)", "f-small f-strong", fit=200)
f.text(115, 96, "checkout_requests_total", "f-small f-mono", fit=200); f.text(115, 116, "{job=\"shop\",", "f-small f-mono"); f.text(115, 136, "outcome=\"error\"} 1", "f-small f-mono", fit=200); f.text(115, 164, "narrows service + time", "f-small", fit=200)
f.box(255, 40, 210, 140, "f-box-faint"); f.text(360, 64, "2. log (what)", "f-small f-strong")
f.text(360, 96, "ERROR checkout failed", "f-small f-mono", fit=200); f.text(360, 116, "for order 1013", "f-small f-mono"); f.text(360, 140, "Trace ID: 8b28…317a", "f-small f-mono", fit=200); f.text(360, 164, "names the request", "f-small", fit=200)
f.box(500, 40, 210, 140, "f-box-ok"); f.text(605, 64, "3. trace (where)", "f-small f-strong", fit=200)
f.text(605, 96, "POST /checkout  ✗", "f-small f-mono", fit=200); f.text(605, 116, "└ charge card  ✗", "f-small f-mono", fit=200); f.text(605, 140, "exception: timed out", "f-small f-mono", fit=200); f.text(605, 164, "shows the failing span", "f-small", fit=200)
f.arrow([(222, 110), (253, 110)]); f.arrow([(467, 110), (498, 110)])
f.text(360, 214, "joined by service.name (= job label), time, and the trace ID on each log record", "f-small", fit=700)
f.text(360, 238, "exemplars would link 1 → 3 directly; the JavaScript SDK 3.1.1 does not record them", "f-small", fit=700)
write(ROOT, "opentelemetry", "correlation", f,
      "Three steps from left to right. First, the metric checkout_requests_total with job shop and outcome error equal to 1 says that something failed and narrows the service and time. Second, an ERROR log record, checkout failed for order 1013, carries a Trace ID and names the request. Third, the trace shows POST /checkout and its child charge card both failed, with the exception timed out on charge card, showing the failing span. The signals are joined by service.name, which is the job label, by time, and by the trace ID on each log record. Exemplars would link the metric directly to the trace, but the JavaScript SDK 3.1.1 does not record them.",
      "Metric says that, log says what, trace says where — joined by service name, time and trace ID.")
