"""Figure for kafka-producers-acks-and-retries; run: python3 scripts/figures/kafka/producer-acks.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "How a producer write is acknowledged, from Producers, acknowledgements and retries.")
f.box(10, 50, 170, 150, "f-box-accent"); f.text(95, 74, "producer", "f-small f-strong")
f.text(95, 100, "send() → batch", "f-small f-mono", fit=160); f.text(95, 120, "linger.ms = 5", "f-small f-mono", fit=160); f.text(95, 146, "producer ID +", "f-small", fit=160); f.text(95, 164, "sequence number", "f-small", fit=160); f.text(95, 186, "retry until 120 s", "f-small", fit=160)
f.box(250, 50, 180, 150, "f-box-faint"); f.text(340, 74, "leader (broker 1)", "f-small f-strong", fit=170)
f.text(340, 104, "append to log", "f-small", fit=170); f.text(340, 126, "drop duplicate", "f-small", fit=170); f.text(340, 144, "sequence numbers", "f-small", fit=170)
f.box(520, 30, 190, 70, "f-box-faint"); f.text(615, 58, "follower (broker 2)", "f-small f-strong", fit=180); f.text(615, 80, "copies the batch", "f-small", fit=180)
f.box(520, 150, 190, 70, "f-box-faint"); f.text(615, 178, "follower (broker 3)", "f-small f-strong", fit=180); f.text(615, 200, "copies the batch", "f-small", fit=180)
f.arrow([(182, 110), (248, 110)]); f.arrow([(432, 100), (518, 70)]); f.arrow([(432, 150), (518, 180)])
f.arrow([(248, 150), (182, 150)])
f.text(215, 140, "offset", "f-small")
f.text(360, 250, "acks=0: no reply (offset -1) · acks=1: leader has it · acks=all: every in-sync replica has it", "f-small", fit=700)
f.text(360, 276, "a timeout means “unknown”: the broker may still write the batch", "f-small f-danger", fit=700)
write(ROOT, "kafka", "producer-acks", f,
      "The producer adds records to a batch with linger.ms 5, tags it with a producer ID and sequence number, and retries for up to 120 seconds. The leader on broker 1 appends the batch to its log and drops batches whose sequence numbers it has already seen. Followers on brokers 2 and 3 copy the batch. The leader returns the offset to the producer. With acks=0 there is no reply and the offset is -1; with acks=1 the leader has the record; with acks=all every in-sync replica has it. A timeout means unknown: the broker may still write the batch.",
      "acks decides who must have a copy before the producer hears back; idempotence makes retries safe.")
