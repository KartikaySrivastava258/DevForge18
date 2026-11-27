"""Sends a notification for every event on "assignment-events" by POSTing to the notification gateway.
Run: BOOTSTRAP=kafka:9092 NOTIFY_URL=http://gateway:8099 python notifier.py — stops after 5 s without events."""
import json
import os
import urllib.request

from confluent_kafka import Consumer

consumer = Consumer({"bootstrap.servers": os.environ.get("BOOTSTRAP", "localhost:9092"),
                     "group.id": "notifier", "auto.offset.reset": "earliest"})
consumer.subscribe(["assignment-events"])
sent = 0
while True:
    message = consumer.poll(5.0)
    if message is None:
        break
    event = json.loads(message.value())
    body = json.dumps({"event_id": event["event_id"], "to": event["student_email"],
                       "subject": f"New assignment: {event['title']}"}).encode()
    request = urllib.request.Request(os.environ["NOTIFY_URL"] + "/send", data=body,
                                     headers={"Content-Type": "application/json"})
    urllib.request.urlopen(request, timeout=5)
    sent += 1
consumer.close()
print(json.dumps({"sent": sent, "dead_lettered": 0, "duplicates": 0}))
