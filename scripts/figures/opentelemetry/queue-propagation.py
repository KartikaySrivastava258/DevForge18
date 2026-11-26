"""Figure for otel-context-propagation; run: python3 scripts/figures/opentelemetry/queue-propagation.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Context through a queue, from Propagating context across services and queues.")
f.box(10, 60, 200, 110, "f-box-accent"); f.text(110, 84, "shop", "f-small f-strong f-mono"); f.text(110, 108, "span: orders publish", "f-small f-mono", fit=190); f.text(110, 128, "kind PRODUCER", "f-small"); f.text(110, 150, "inject(context, headers)", "f-small f-mono", fit=190)
f.box(260, 40, 200, 150, "f-box-faint"); f.text(360, 64, "message on the queue", "f-small f-strong", fit=190); f.text(360, 92, "traceparent:", "f-small f-mono"); f.text(360, 112, "00-<trace>-<span>-01", "f-small f-mono", fit=190); f.text(360, 140, "baggage:", "f-small f-mono"); f.text(360, 160, "campus=north", "f-small f-mono")
f.box(510, 60, 200, 110, "f-box-ok"); f.text(610, 84, "fulfilment", "f-small f-strong f-mono"); f.text(610, 108, "extract(headers)", "f-small f-mono"); f.text(610, 128, "span: orders process", "f-small f-mono", fit=190); f.text(610, 150, "same trace, child span", "f-small", fit=190)
f.arrow([(212, 115), (258, 115)]); f.arrow([(462, 115), (508, 115)])
f.text(360, 222, "no inject → the consumer starts a new trace: the request's story breaks in two", "f-small f-danger", fit=680)
write(ROOT, "opentelemetry", "queue-propagation", f,
      "The shop service starts the span orders publish of kind PRODUCER and injects its context into the message headers. The message on the queue carries traceparent 00, trace ID, span ID, 01, and baggage campus=north. The fulfilment service extracts the headers and starts orders process as a child span in the same trace. Without inject, the consumer starts a new trace and the request's story breaks in two.",
      "Inject on the way out, extract on the way in — at every hop, including queues.")
