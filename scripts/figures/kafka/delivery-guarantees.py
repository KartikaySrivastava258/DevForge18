"""Figure for kafka-delivery-guarantees-and-idempotence; run: python3 scripts/figures/kafka/delivery-guarantees.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "When progress is saved decides the guarantee, from Delivery guarantees and idempotent producers.")
rows = [("at-most-once", "commit offset", "do the work", "crash → work lost", "f-box-danger"),
        ("at-least-once", "do the work", "commit offset", "crash → work repeated", "f-box-faint"),
        ("exactly-once", "begin transaction", "output + offset, commit", "crash → abort, redo once", "f-box-ok")]
for i, (name, first, second, crash, cls) in enumerate(rows):
    y = 20 + i * 90
    f.text(70, y + 40, name, "f-small f-strong", fit=130)
    f.box(140, y + 10, 160, 50, "f-box-faint"); f.text(220, y + 40, first, "f-small", fit=150)
    f.arrow([(302, y + 35), (338, y + 35)])
    f.box(340, y + 10, 160, 50, "f-box-faint"); f.text(420, y + 40, second, "f-small", fit=150)
    f.box(530, y + 10, 180, 50, cls); f.text(620, y + 40, crash, "f-small", fit=170)
write(ROOT, "kafka", "delivery-guarantees", f,
      "Three rows. At-most-once: commit the offset, then do the work; a crash loses the work. At-least-once: do the work, then commit the offset; a crash repeats the work. Exactly-once within Kafka: begin a transaction, then write the output and the offset and commit together; a crash aborts the transaction and the work is redone once.",
      "Commit before the work loses it on a crash, after the work repeats it; a transaction does both or neither.")
