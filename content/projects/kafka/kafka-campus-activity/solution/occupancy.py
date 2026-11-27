"""Counts how many people are in each building from badge swipes on "campus-activity", and publishes each
building's current occupancy to the compacted topic "building-occupancy". Several copies share the work.
Run: BOOTSTRAP=kafka:9092 python occupancy.py — stops after 5 seconds without new swipes."""
import json
import os

from confluent_kafka import OFFSET_BEGINNING, Consumer, Producer, TopicPartition

bootstrap = os.environ.get("BOOTSTRAP", "localhost:9092")


def restore():
    """Latest occupancy of every building, read from the compacted topic (last value per key wins)."""
    reader = Consumer({"bootstrap.servers": bootstrap, "group.id": f"occupancy-restore-{os.getpid()}",
                       "enable.auto.commit": False})
    partitions = reader.list_topics("building-occupancy", timeout=10).topics["building-occupancy"].partitions
    ends = {p: reader.get_watermark_offsets(TopicPartition("building-occupancy", p), timeout=10)[1] for p in partitions}
    reader.assign([TopicPartition("building-occupancy", p, OFFSET_BEGINNING) for p in partitions if ends[p] > 0])
    state, done = {}, {p for p in partitions if ends[p] == 0}
    while len(done) < len(partitions):
        message = reader.poll(5.0)
        if message is None:
            break
        if message.error():
            continue
        if message.key() and message.value():
            state[message.key().decode()] = json.loads(message.value())["inside"]
        if message.offset() + 1 >= ends[message.partition()]:
            done.add(message.partition())
    reader.close()
    return state


inside = restore()
producer = Producer({"bootstrap.servers": bootstrap, "acks": "all", "enable.idempotence": True})
consumer = Consumer({"bootstrap.servers": bootstrap, "group.id": "occupancy",
                     "auto.offset.reset": "earliest", "enable.auto.commit": False})
consumer.subscribe(["campus-activity"])
processed = 0
try:
    while True:
        message = consumer.poll(5.0)
        if message is None:
            break
        if message.error():
            raise RuntimeError(message.error())
        swipe = json.loads(message.value())
        building = swipe["building"]
        inside[building] = inside.get(building, 0) + (1 if swipe["direction"] == "in" else -1)
        # Keyed by building: compaction keeps the latest value per building.
        producer.produce("building-occupancy", key=building.encode(),
                         value=json.dumps({"building": building, "inside": inside[building]}).encode())
        producer.flush(10)                       # the new value is stored before the swipe counts as processed
        consumer.commit(message=message, asynchronous=False)
        processed += 1
finally:
    consumer.close()
print(json.dumps({"processed": processed}))
