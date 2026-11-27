"""Figure for kafka-offsets-retention-and-replay; run: python3 scripts/figures/kafka/retention-and-compaction.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Segments, retention, compaction and replay, from Offsets, retention and replay in depth.")
f.text(360, 26, "cleanup.policy=delete (retention)", "f-small f-strong", fit=400)
f.box(10, 40, 160, 60, "f-box-danger"); f.text(90, 64, "segment 0–99", "f-small f-mono"); f.text(90, 86, "newest record > 7 d old", "f-small", fit=150)
f.box(185, 40, 160, 60, "f-box-faint"); f.text(265, 64, "segment 100–199", "f-small f-mono", fit=150); f.text(265, 86, "closed, kept", "f-small")
f.box(360, 40, 160, 60, "f-box-accent"); f.text(440, 64, "active segment", "f-small f-strong", fit=150); f.text(440, 86, "200 → (appends)", "f-small f-mono", fit=150)
f.text(620, 64, "deleted whole;", "f-small"); f.text(620, 84, "log start → 100", "f-small f-mono")
f.text(360, 140, "cleanup.policy=compact", "f-small f-strong", fit=400)
f.box(10, 155, 330, 60, "f-box-faint"); f.text(175, 179, "0 tea:10 · 1 coffee:20 · 2 tea:12", "f-small f-mono", fit=320); f.text(175, 201, "3 samosa:15 · 4 coffee:22 · 5 tea:14", "f-small f-mono", fit=320)
f.arrow([(342, 185), (378, 185)])
f.box(380, 155, 330, 60, "f-box-ok"); f.text(545, 179, "3 samosa:15 · 4 coffee:22 · 5 tea:14", "f-small f-mono", fit=320); f.text(545, 201, "latest per key; offsets keep gaps", "f-small", fit=320)
f.text(360, 252, "replay: committed offset is just a number per partition", "f-small f-strong", fit=600)
f.text(360, 276, "--to-offset · --shift-by · --to-datetime · --dry-run first · group must be idle", "f-small f-mono", fit=700)
f.text(360, 304, "an offset below the log start falls back to auto.offset.reset", "f-small f-danger", fit=600)
write(ROOT, "kafka", "retention-and-compaction", f,
      "Top: with cleanup.policy delete, a partition is made of segments. Segment 0 to 99, whose newest record is more than 7 days old, is deleted whole, so the log start moves to 100; segment 100 to 199 is closed and kept; the active segment from 200 receives appends and is never deleted. Middle: with cleanup.policy compact, the records tea 10, coffee 20, tea 12, samosa 15, coffee 22 and tea 14 at offsets 0 to 5 become samosa 15 at 3, coffee 22 at 4 and tea 14 at 5: the latest value per key, with gaps in the offsets. Bottom: replay changes the committed offset, a number per partition, with to-offset, shift-by or to-datetime, after a dry run, while the group is idle. An offset below the log start falls back to auto.offset.reset.",
      "Retention deletes whole old segments; compaction keeps the latest value per key; replay moves a group's offset.")
