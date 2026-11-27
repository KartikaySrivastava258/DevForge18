"""Architecture of Capstone A (e-commerce platform); run: python3 scripts/figures/capstones/capstone-a-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 420, "Capstone A architecture: synchronous orders, asynchronous fulfilment.")
f.box(10, 10, 740, 300, "f-box-faint"); f.text(120, 32, "Kubernetes cluster (kind)", "f-small f-strong", fit=200)
f.box(20, 130, 100, 60, "f-box"); f.text(70, 165, "shoppers", "f-small", fit=90)
f.box(150, 120, 110, 80, "f-box-accent"); f.text(205, 150, "Nginx", "f-small f-strong", fit=100); f.text(205, 170, "ingress, limits", "f-small", fit=100)
f.arrow([(122, 160), (148, 160)])
f.box(300, 50, 130, 60, "f-box"); f.text(365, 77, "catalogue", "f-small f-strong", fit=120); f.text(365, 95, "service", "f-small", fit=120)
f.box(300, 170, 130, 60, "f-box"); f.text(365, 197, "orders", "f-small f-strong", fit=120); f.text(365, 215, "service + outbox", "f-small", fit=120)
f.arrow([(262, 145), (298, 85)]); f.arrow([(262, 175), (298, 195)])
f.box(470, 40, 120, 60, "f-box-ok"); f.text(530, 67, "Redis", "f-small f-strong", fit=110); f.text(530, 85, "cache, holds", "f-small", fit=110)
f.box(470, 160, 120, 70, "f-box-ok"); f.text(530, 190, "PostgreSQL", "f-small f-strong", fit=110); f.text(530, 210, "orders, outbox", "f-small", fit=110)
f.arrow([(432, 75), (468, 70)]); f.arrow([(432, 200), (468, 197)])
f.box(620, 160, 120, 70, "f-box-warn"); f.text(680, 190, "Kafka", "f-small f-strong", fit=110); f.text(680, 210, "order events", "f-small", fit=110)
f.arrow([(592, 195), (618, 195)])
f.box(470, 250, 270, 50, "f-box"); f.text(605, 272, "payment, shipping, email consumers", "f-small", fit=260); f.text(605, 290, "(consumer groups, dead-letter topic)", "f-small", fit=260)
f.arrow([(680, 232), (680, 248)])
f.box(20, 340, 340, 66, "f-box"); f.text(190, 366, "OpenTelemetry: one trace per order,", "f-small", fit=330); f.text(190, 386, "across HTTP and Kafka hops", "f-small", fit=330)
f.box(400, 340, 340, 66, "f-box"); f.text(570, 366, "Prometheus + Grafana: latency, errors,", "f-small", fit=330); f.text(570, 386, "consumer lag, SLO burn-rate alerts", "f-small", fit=330)
write(ROOT, "capstones", "capstone-a-architecture", f,
      "Inside a Kubernetes cluster, shoppers reach Nginx, which routes to a catalogue service and an orders service. The catalogue service uses Redis for caching and stock holds. The orders service writes orders and an outbox table in one PostgreSQL transaction; a relay publishes order events to Kafka, where payment, shipping and email consumers process them in consumer groups with a dead-letter topic. Below the cluster: OpenTelemetry traces each order across HTTP and Kafka hops, and Prometheus with Grafana watches latency, errors, consumer lag and SLO burn rates.",
      "Orders are accepted synchronously and fulfilled asynchronously; the outbox ties the two together without losing events.")
