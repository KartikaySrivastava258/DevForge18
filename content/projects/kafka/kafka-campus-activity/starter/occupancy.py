"""Counts how many people are in each building from badge swipes on "campus-activity", and publishes each
building's current occupancy to "building-occupancy". Run several copies at once: they share the work.
Run: BOOTSTRAP=kafka:9092 python occupancy.py"""
import json
import os

from confluent_kafka import Consumer, Producer

bootstrap = os.environ.get("BOOTSTRAP", "localhost:9092")
consumer = Consumer({"bootstrap.servers": bootstrap, "group.id": "occupancy", "auto.offset.reset": "earliest"})
producer = Producer({"bootstrap.servers": bootstrap})
consumer.subscribe(["campus-activity"])
inside = {}
processed = 0
while True:
    message = consumer.poll(5.0)
    if message is None:
        break
    swipe = json.loads(message.value())
    inside[swipe["building"]] = inside.get(swipe["building"], 0) + 1
    processed += 1
for building, count in inside.items():
    producer.produce("building-occupancy", value=json.dumps({"building": building, "inside": count}).encode())
producer.flush(10)
consumer.close()
print(json.dumps({"processed": processed}))
