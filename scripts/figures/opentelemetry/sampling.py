"""Figure for otel-sampling-and-cost; run: python3 scripts/figures/opentelemetry/sampling.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Where sampling decisions are made, from Sampling traces without losing the story.")
f.box(10, 40, 160, 120, "f-box-accent"); f.text(90, 64, "edge service", "f-small f-strong"); f.text(90, 90, "parentbased_", "f-small f-mono"); f.text(90, 108, "traceidratio 0.25", "f-small f-mono", fit=150); f.text(90, 140, "decides: 01 or 00", "f-small", fit=150)
f.box(210, 40, 160, 120, "f-box-faint"); f.text(290, 64, "next service", "f-small f-strong"); f.text(290, 90, "parentbased_…", "f-small f-mono"); f.text(290, 120, "follows the flag", "f-small", fit=150); f.text(290, 140, "in traceparent", "f-small", fit=150)
f.arrow([(172, 100), (208, 100)])
f.text(190, 186, "head sampling: decided early, cheap, whole traces", "f-small", fit=360)
f.box(410, 40, 140, 120, "f-box-faint"); f.text(480, 64, "Collector", "f-small f-strong"); f.text(480, 92, "probabilistic_", "f-small f-mono"); f.text(480, 110, "sampler (hash", "f-small f-mono"); f.text(480, 128, "of trace ID)", "f-small f-mono")
f.arrow([(372, 100), (408, 100)])
f.box(580, 40, 130, 120, "f-box-ok"); f.text(645, 64, "Jaeger", "f-small f-strong"); f.text(645, 100, "kept traces", "f-small")
f.arrow([(552, 100), (578, 100)])
f.box(210, 220, 500, 80, "f-box-faint"); f.text(460, 244, "tail sampling (contrib Collector): wait for the whole trace,", "f-small", fit=480); f.text(460, 264, "then keep all errors + slow ones + a few of the rest", "f-small", fit=480); f.text(460, 286, "costs memory; one trace must reach one Collector instance", "f-small f-danger", fit=480)
write(ROOT, "opentelemetry", "sampling", f,
      "The edge service uses parentbased traceidratio 0.25 and decides whether a new trace is sampled, flag 01, or not, flag 00. The next service uses a parentbased sampler and follows the flag it receives in traceparent. This is head sampling: decided at the start, cheap, and it keeps whole traces. A Collector can also sample with the probabilistic sampler, which hashes the trace ID, before sending the kept traces to Jaeger. Below, tail sampling in the contrib Collector waits for the whole trace, then keeps all errors, slow traces and a few of the rest; it costs memory, and every span of a trace must reach the same Collector instance.",
      "Head sampling decides early and is followed downstream; tail sampling decides after the trace is complete.")
