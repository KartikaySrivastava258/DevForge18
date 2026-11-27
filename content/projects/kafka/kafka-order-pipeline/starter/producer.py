"""Publishes the canteen's order events from orders.jsonl to the Kafka topic "orders".
Run: BOOTSTRAP=kafka:9092 python producer.py"""
import json
import os

from confluent_kafka import Producer

producer = Producer({"bootstrap.servers": os.environ.get("BOOTSTRAP", "localhost:9092")})

sent = 0
with open("orders.jsonl", encoding="utf-8") as f:
    for line in f:
        event = json.loads(line)
        producer.produce("orders", value=json.dumps(event).encode())
        sent += 1
print(f"sent {sent}")
