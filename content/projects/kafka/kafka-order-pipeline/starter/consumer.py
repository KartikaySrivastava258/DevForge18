"""Reads the order events and prints each order's latest status as JSON.
Run: BOOTSTRAP=kafka:9092 python consumer.py"""
import json
import os

from confluent_kafka import Consumer

consumer = Consumer({"bootstrap.servers": os.environ.get("BOOTSTRAP", "localhost:9092"), "group.id": "order-status"})
consumer.subscribe(["orders"])
latest = {}
message = consumer.poll(5.0)
if message is not None and not message.error():
    event = json.loads(message.value())
    latest[event["order_id"]] = event["status"]
consumer.close()
print(json.dumps(latest, sort_keys=True))
