"""Figure for kafka-replication-and-fault-tolerance; run: python3 scripts/figures/kafka/replication.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Leaders, followers and the ISR, from Replication and fault tolerance.")
for i, (x, name, rows) in enumerate([(10, "kafka-1", ["p0 leader", "p1 follower", "p2 follower"]),
                                      (250, "kafka-2", ["p0 follower", "p1 leader", "p2 follower"]),
                                      (490, "kafka-3", ["p0 follower", "p1 follower", "p2 leader"])]):
    f.box(x, 30, 220, 130, "f-box-danger" if name == "kafka-3" else "f-box-faint")
    f.text(x + 110, 54, name + (" (stopped)" if name == "kafka-3" else ""), "f-small f-strong f-mono", fit=210)
    for j, r in enumerate(rows):
        f.text(x + 110, 84 + 24 * j, r, "f-small f-mono", fit=210)
f.text(360, 190, "after kafka-3 stops: p2 leader → kafka-1 (next in-sync replica); ISR = 1,2", "f-small", fit=700)
f.box(10, 210, 700, 100, "f-box-accent")
f.text(360, 234, "acks=all + min.insync.replicas=2: acknowledged once 2 in-sync copies have it", "f-small", fit=680)
f.text(360, 258, "2 brokers up → writes succeed, nothing acknowledged has only one copy", "f-small", fit=680)
f.text(360, 282, "min.insync.replicas=3 with 2 up → NotEnoughReplicas (acks=1 still accepted: unsafe)", "f-small f-danger", fit=680)
write(ROOT, "kafka", "replication", f,
      "Three brokers each hold a copy of partitions p0, p1 and p2. kafka-1 leads p0, kafka-2 leads p1 and kafka-3 leads p2; the other copies are followers. When kafka-3 stops, p2's leadership moves to kafka-1, the next in-sync replica, and the in-sync replica set becomes brokers 1 and 2. Below: with acks=all and min.insync.replicas=2, a write is acknowledged once two in-sync copies have it, so with two brokers up writes succeed and nothing acknowledged has only one copy. With min.insync.replicas=3 and two brokers up, acks=all writes fail with NotEnoughReplicas, while acks=1 writes are still accepted, which is unsafe.",
      "Each partition has a leader and followers; acks=all with min.insync.replicas decides when a write is safe.")
