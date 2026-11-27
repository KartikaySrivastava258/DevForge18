"""Reference architecture: event-driven services with an outbox; run: python3 scripts/figures/architecture/event-driven-with-outbox.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 340, "Reference architecture: event-driven services with a transactional outbox.")
# Top row: request -> order service -> PostgreSQL (order + outbox) -> relay
f.box(10, 40, 90, 50, "f-box"); f.text(55, 70, "client", "f-small", fit=80)
f.box(130, 25, 140, 80, "f-box-accent"); f.text(200, 55, "Order service", "f-small f-strong", fit=130); f.text(200, 75, "only writer", "f-small", fit=130); f.text(200, 91, "of orders", "f-small", fit=130)
f.arrow([(102, 65), (128, 65)])
f.box(310, 20, 170, 90, "f-box-ok"); f.text(395, 50, "PostgreSQL", "f-small f-strong", fit=160); f.text(395, 70, "order + outbox row", "f-small", fit=160); f.text(395, 86, "in one transaction", "f-small", fit=160)
f.arrow([(272, 65), (308, 65)])
f.box(520, 25, 140, 80, "f-box"); f.text(590, 55, "Outbox relay", "f-small f-strong", fit=130); f.text(590, 75, "publish, then", "f-small", fit=130); f.text(590, 91, "mark published", "f-small", fit=130)
f.arrow([(482, 65), (518, 65)])
# Kafka below the relay
f.box(480, 170, 200, 90, "f-box-accent"); f.text(580, 200, "Kafka topic", "f-small f-strong", fit=190); f.text(580, 220, "key = order ID", "f-small", fit=190); f.text(580, 236, "ordered per partition", "f-small", fit=190)
f.arrow([(590, 107), (590, 168)])
# Consumers, each in its own group
f.box(270, 150, 150, 40, "f-box"); f.text(345, 175, "payment group", "f-small", fit=140)
f.box(270, 205, 150, 40, "f-box"); f.text(345, 230, "shipping group", "f-small", fit=140)
f.box(270, 260, 150, 40, "f-box"); f.text(345, 285, "e-mail group", "f-small", fit=140)
f.arrow([(478, 200), (422, 170)]); f.arrow([(478, 215), (422, 225)]); f.arrow([(478, 230), (422, 280)])
f.text(345, 140, "skip handled event IDs", "f-small f-muted", fit=180)
# Dead-letter topic and optional Redis
f.box(40, 240, 170, 60, "f-box-warn"); f.text(125, 266, "retry / dead-letter", "f-small f-strong", fit=160); f.text(125, 284, "topics, with reason", "f-small", fit=160)
f.arrow([(268, 170), (212, 252)]); f.arrow([(268, 225), (212, 265)]); f.arrow([(268, 280), (212, 280)])
f.box(40, 140, 170, 50, "f-box-faint"); f.text(125, 162, "Redis", "f-small f-strong", fit=160); f.text(125, 178, "optional cache", "f-small", fit=160)
f.arrow([(185, 107), (150, 138)])
f.text(380, 328, "every service, Kafka and PostgreSQL run as containers (Docker Compose locally)", "f-small", fit=600)
write(ROOT, "architecture", "event-driven-with-outbox", f,
      "A client calls the order service, the only writer of orders, which writes the order and an outbox row to PostgreSQL in one transaction. An outbox relay reads the outbox, publishes each event to a Kafka topic keyed by order ID, and marks the rows published afterwards. Three consumer groups - payment, shipping and e-mail - each read the topic, skipping event IDs they have already handled, and send failures to retry and dead-letter topics with a reason. Redis sits beside the order service as an optional cache. Every service, Kafka and PostgreSQL run as containers, with Docker Compose locally.",
      "The order and its event are committed together; a relay publishes the outbox to Kafka, and each consumer handles repeats.")
