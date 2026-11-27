"""Reads new order events and prints each order's latest status as JSON (only orders seen in this run).
Run: BOOTSTRAP=kafka:9092 python consumer.py — it stops after 5 seconds without new events."""
import json
import os

from confluent_kafka import Consumer

consumer = Consumer({
    "bootstrap.servers": os.environ.get("BOOTSTRAP", "localhost:9092"),
    "group.id": "order-status",
    "auto.offset.reset": "earliest",   # a new group starts from the oldest event, not from "now"
    "enable.auto.commit": False,       # commit only after the events are processed
})
consumer.subscribe(["orders"])
latest = {}
try:
    while True:
        message = consumer.poll(5.0)
        if message is None:            # nothing new for 5 seconds: done
            break
        if message.error():
            raise RuntimeError(message.error())
        event = json.loads(message.value())
        latest[event["order_id"]] = event["status"]   # events of one order arrive in order (same partition)
        consumer.commit(message=message, asynchronous=False)
finally:
    consumer.close()
print(json.dumps(latest, sort_keys=True))
