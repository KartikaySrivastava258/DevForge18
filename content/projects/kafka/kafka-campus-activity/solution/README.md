# Live campus activity

Every badge swipe at a building door is an event on the topic `campus-activity`:
`{"building": "library", "student": "s0042", "direction": "in", "at": "…"}` (direction `in` or `out`). The
security office wants each building's live occupancy, and the stream is too busy for one program.

1. `topics.sh` (run with `kafka-topics.sh` on the PATH and `BOOTSTRAP` set) creates:
   - `campus-activity` with **6 partitions**, so up to six consumers can share the work;
   - `building-occupancy`, a **compacted** topic (`cleanup.policy=compact`): Kafka keeps at least the latest
     value for each key, so a dashboard that starts later can still read every building's current number.
2. `occupancy.py` runs in the consumer group `occupancy`. Several copies run at the same time and share the
   partitions. For every swipe it processes, it updates that building's occupancy (in: +1, out: −1) and publishes
   `{"building": …, "inside": …}` to `building-occupancy` **with the building as the key**. It stops after 5
   seconds without new swipes, and prints `{"processed": <number of swipes it processed>}`.
3. The swipes are produced with the building as the key, so all swipes of one building are in one partition and
   one copy of `occupancy.py` sees all of them, in order.
4. Nothing is processed twice: a copy started again later processes only new swipes.
5. Occupancy survives restarts: on start, `occupancy.py` reads the latest value of every building from
   `building-occupancy` and continues counting from there.
