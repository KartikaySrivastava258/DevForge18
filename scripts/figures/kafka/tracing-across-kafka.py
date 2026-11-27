"""Figure for kafka-tracing-with-opentelemetry; run: python3 scripts/figures/kafka/tracing-across-kafka.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 260, "The trace context travels inside the message, in a header.")
f.box(10, 70, 180, 100, "f-box"); f.text(100, 100, "orders service", "f-small f-strong", fit=170); f.text(100, 122, "span: publish", "f-small", fit=170); f.text(100, 142, "(kind PRODUCER)", "f-small", fit=170)
f.box(270, 60, 180, 120, "f-box-warn"); f.text(360, 88, "Kafka message", "f-small f-strong", fit=170); f.text(360, 112, "key, value", "f-small", fit=170); f.text(360, 134, "header:", "f-small", fit=170); f.text(360, 154, "traceparent", "f-small f-mono", fit=170)
f.arrow([(192, 120), (268, 120)]); f.text(230, 108, "inject", "f-small", fit=70)
f.box(530, 70, 180, 100, "f-box"); f.text(620, 100, "email consumer", "f-small f-strong", fit=170); f.text(620, 122, "span: process", "f-small", fit=170); f.text(620, 142, "(kind CONSUMER)", "f-small", fit=170)
f.arrow([(452, 120), (528, 120)]); f.text(490, 108, "extract", "f-small", fit=70)
f.text(360, 225, "same trace ID; the consumer's span has the producer's span as its parent", "f-small", fit=700)
write(ROOT, "kafka", "tracing-across-kafka", f,
      "The orders service creates a publish span of kind PRODUCER and injects its trace context into the Kafka message as a traceparent header, next to the key and value. The email consumer extracts the context from the header and starts a process span of kind CONSUMER. Both spans share one trace ID, and the consumer's span has the producer's span as its parent.",
      "Kafka does not carry trace context by itself; the producer injects it into a header and the consumer extracts it.")
