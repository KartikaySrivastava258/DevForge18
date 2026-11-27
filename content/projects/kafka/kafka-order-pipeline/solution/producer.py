"""Publishes the canteen's order events from orders.jsonl to the Kafka topic "orders".
Run: BOOTSTRAP=kafka:9092 python producer.py"""
import json
import os
import sys

from confluent_kafka import Producer

producer = Producer({
    "bootstrap.servers": os.environ.get("BOOTSTRAP", "localhost:9092"),
    "acks": "all",                 # the event is stored on every in-sync replica before it counts as sent
    "enable.idempotence": True,    # a retry after a timeout cannot write the same event twice or reorder it
})
failed = []

def delivered(error, message):
    if error is not None:
        failed.append(error)

sent = 0
with open("orders.jsonl", encoding="utf-8") as f:
    for line in f:
        event = json.loads(line)
        # The key decides the partition: all events of one order go to the same partition, and Kafka keeps
        # order only within a partition — so "paid" can never be read before "placed".
        producer.produce("orders", key=event["order_id"].encode(), value=json.dumps(event).encode(), on_delivery=delivered)
        producer.poll(0)           # serve delivery callbacks
        sent += 1
# produce() only queues the message in memory; flush() waits until every message is acknowledged.
producer.flush(30)
if failed:
    print(f"{len(failed)} events were not delivered: {failed[0]}", file=sys.stderr)
    sys.exit(1)
print(f"sent {sent}")
