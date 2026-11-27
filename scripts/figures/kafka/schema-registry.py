"""Figure for kafka-schemas-and-evolution; run: python3 scripts/figures/kafka/schema-registry.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Schemas, IDs and compatibility, from Schemas and evolution.")
f.box(250, 20, 220, 110, "f-box-accent"); f.text(360, 44, "schema registry", "f-small f-strong")
f.text(360, 68, "orders-value", "f-small f-mono"); f.text(360, 88, "v1 → ID 1 · v2 → ID 2", "f-small f-mono", fit=210); f.text(360, 112, "rule: BACKWARD", "f-small f-mono")
f.box(10, 170, 200, 90, "f-box-faint"); f.text(110, 194, "producer", "f-small f-strong"); f.text(110, 218, "look up / register", "f-small", fit=190); f.text(110, 240, "schema, get its ID", "f-small", fit=190)
f.box(260, 170, 200, 90, "f-box-faint"); f.text(360, 194, "record in the topic", "f-small f-strong", fit=190); f.text(360, 220, "00 | 00 00 00 02 | Avro", "f-small f-mono", fit=190); f.text(360, 242, "format · ID · data", "f-small", fit=190)
f.box(510, 170, 200, 90, "f-box-ok"); f.text(610, 194, "consumer", "f-small f-strong"); f.text(610, 218, "fetch writer schema", "f-small", fit=190); f.text(610, 240, "by ID, resolve to own", "f-small", fit=190)
f.arrow([(212, 215), (258, 215)]); f.arrow([(462, 215), (508, 215)])
f.arrow([(110, 168), (110, 75), (248, 75)]); f.arrow([(610, 168), (610, 75), (472, 75)])
f.text(360, 292, "new version checked against the rule before any producer can use it: incompatible → HTTP 409", "f-small f-danger", fit=700)
write(ROOT, "kafka", "schema-registry", f,
      "A schema registry holds subject orders-value with version 1 as ID 1 and version 2 as ID 2, and the rule BACKWARD. A producer looks up or registers its schema and gets its ID. Each record in the topic is a format byte 00, the four-byte schema ID such as 00 00 00 02, then the Avro data. A consumer fetches the writer schema by ID from the registry and resolves it to its own schema. A new version is checked against the rule before any producer can use it; an incompatible one is refused with HTTP 409.",
      "The registry hands out schema IDs and enforces compatibility; each record names the schema it was written with.")
