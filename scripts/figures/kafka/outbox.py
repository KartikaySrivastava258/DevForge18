"""Figure for kafka-outbox-pattern; run: python3 scripts/figures/kafka/outbox.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "The transactional outbox, from The outbox pattern and event-driven design.")
f.box(10, 30, 160, 70, "f-box-accent"); f.text(90, 58, "order service", "f-small f-strong"); f.text(90, 80, "place order o3", "f-small")
f.box(210, 20, 260, 160, "f-box-faint"); f.text(340, 42, "PostgreSQL — one transaction", "f-small f-strong", fit=250)
f.box(225, 55, 230, 45, "f-box-ok"); f.text(340, 83, "INSERT INTO orders (o3)", "f-small f-mono", fit=220)
f.box(225, 115, 230, 50, "f-box-ok"); f.text(340, 136, "INSERT INTO outbox", "f-small f-mono", fit=220); f.text(340, 155, "(event_id, o3, payload)", "f-small f-mono", fit=220)
f.arrow([(172, 65), (208, 65)])
f.box(510, 110, 200, 70, "f-box-faint"); f.text(610, 136, "relay", "f-small f-strong"); f.text(610, 158, "publish, then mark", "f-small", fit=190)
f.arrow([(457, 140), (508, 145)])
f.box(510, 220, 200, 50, "f-box-accent"); f.text(610, 250, "Kafka: order-events", "f-small f-mono", fit=190)
f.arrow([(610, 182), (610, 218)])
f.box(210, 220, 260, 50, "f-box-faint"); f.text(340, 241, "shipping: skip event IDs", "f-small", fit=250); f.text(340, 260, "already handled", "f-small", fit=250)
f.arrow([(508, 245), (472, 245)])
f.text(360, 300, "dual write (commit, then publish) can lose events; the outbox cannot — it can only repeat them", "f-small f-danger", fit=700)
write(ROOT, "kafka", "outbox", f,
      "The order service places order o3. In one PostgreSQL transaction it inserts the order into the orders table and an outbox row with the event ID, o3 and the payload. A relay reads outbox rows, publishes them to the Kafka topic order-events and then marks them as published. The shipping service consumes the topic and skips event IDs it has already handled. A dual write, committing and then publishing, can lose events; the outbox cannot, it can only repeat them.",
      "Order and event are committed together; the relay publishes at least once and consumers deduplicate by event ID.")
