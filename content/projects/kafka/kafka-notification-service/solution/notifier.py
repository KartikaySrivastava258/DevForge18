"""Sends a notification for every event on "assignment-events" by POSTing to the notification gateway —
once per event_id, with retries, and with a dead-letter topic for events that cannot be processed.
Run: BOOTSTRAP=kafka:9092 NOTIFY_URL=http://gateway:8099 python notifier.py — stops after 5 s without events."""
import json
import os
import time
import urllib.error
import urllib.request

from confluent_kafka import OFFSET_BEGINNING, Consumer, Producer, TopicPartition

BOOTSTRAP = os.environ.get("BOOTSTRAP", "localhost:9092")
NOTIFY_URL = os.environ.get("NOTIFY_URL", "http://localhost:8099")
REQUIRED = ("event_id", "student_email", "title")
ATTEMPTS = 3


def already_sent():
    """event_ids recorded in the compacted topic assignment-events.sent, read to its current end."""
    reader = Consumer({"bootstrap.servers": BOOTSTRAP, "group.id": f"notifier-restore-{os.getpid()}", "enable.auto.commit": False})
    topic = "assignment-events.sent"
    partitions = reader.list_topics(topic, timeout=10).topics[topic].partitions
    ends = {p: reader.get_watermark_offsets(TopicPartition(topic, p), timeout=10)[1] for p in partitions}
    reader.assign([TopicPartition(topic, p, OFFSET_BEGINNING) for p in partitions if ends[p] > 0])
    ids, done = set(), {p for p in partitions if ends[p] == 0}
    while len(done) < len(partitions):
        message = reader.poll(5.0)
        if message is None:
            break
        if not message.error():
            ids.add(message.key().decode())
            if message.offset() + 1 >= ends[message.partition()]:
                done.add(message.partition())
    reader.close()
    return ids


def send(event):
    """POST to the gateway; retry 5xx and network errors, up to ATTEMPTS in total. Returns None or an error."""
    body = json.dumps({"event_id": event["event_id"], "to": event["student_email"],
                       "subject": f"New assignment: {event['title']}"}).encode()
    error = None
    for attempt in range(ATTEMPTS):
        if attempt:
            time.sleep(0.2 * 2 ** (attempt - 1))       # 0.2 s, then 0.4 s
        request = urllib.request.Request(NOTIFY_URL + "/send", data=body, headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(request, timeout=5).close()
            return None
        except urllib.error.HTTPError as e:
            error = f"gateway answered {e.code}"
            if e.code < 500:                           # a 4xx will not get better by retrying
                break
        except OSError as e:
            error = f"gateway unreachable: {e}"
    return f"{error} after {attempt + 1} attempt(s)"


sent_ids = already_sent()
producer = Producer({"bootstrap.servers": BOOTSTRAP, "acks": "all", "enable.idempotence": True})
consumer = Consumer({"bootstrap.servers": BOOTSTRAP, "group.id": "notifier",
                     "auto.offset.reset": "earliest", "enable.auto.commit": False})
consumer.subscribe(["assignment-events"])
counts = {"sent": 0, "dead_lettered": 0, "duplicates": 0}


def dead_letter(message, reason):
    producer.produce("assignment-events.dlq", key=message.key(), value=message.value(),
                     headers=[("error", reason.encode())])
    counts["dead_lettered"] += 1


try:
    while True:
        message = consumer.poll(5.0)
        if message is None:
            break
        if message.error():
            raise RuntimeError(message.error())
        try:
            event = json.loads(message.value())
            missing = [f for f in REQUIRED if not isinstance(event, dict) or not event.get(f)]
        except ValueError:
            event, missing = None, None
        if event is None:
            dead_letter(message, "value is not valid JSON")
        elif missing:
            dead_letter(message, f"missing field(s): {', '.join(missing)}")
        elif event["event_id"] in sent_ids:
            counts["duplicates"] += 1
        else:
            error = send(event)
            if error:
                dead_letter(message, error)
            else:
                # Record the send before committing the offset: after a crash between the two, the event is
                # read again and recognised as a duplicate instead of emailed twice.
                producer.produce("assignment-events.sent", key=event["event_id"].encode(), value=b"sent")
                sent_ids.add(event["event_id"])
                counts["sent"] += 1
        producer.flush(10)                             # DLQ and "sent" records are stored before the commit
        consumer.commit(message=message, asynchronous=False)
finally:
    consumer.close()
print(json.dumps(counts))
