"""Figure for a lesson; run: python3 scripts/figures/kubernetes/storage.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Claims, volumes and a StatefulSet, from Persistent volumes and StatefulSets.")
f.box(10, 30, 170, 70, "f-box"); f.text(95, 56, "Pod writer", "f-small f-strong f-mono"); f.text(95, 80, "replaced: data stays", "f-small", fit=160)
f.box(230, 30, 200, 70, "f-box-accent"); f.text(330, 56, "PVC notes 64Mi", "f-small f-strong f-mono", fit=190); f.text(330, 80, "Pending until used", "f-small", fit=190)
f.box(480, 30, 230, 70, "f-box-ok"); f.text(595, 56, "PV (provisioned)", "f-small f-strong", fit=220); f.text(595, 80, "StorageClass standard", "f-small f-mono", fit=220)
f.arrow([(182, 65), (228, 65)]); f.arrow([(432, 65), (478, 65)])
f.text(595, 118, "reclaim Delete: claim gone, data gone", "f-small f-danger", fit=300)
f.box(10, 150, 700, 110, "f-box-faint"); f.text(360, 172, "StatefulSet db + headless Service db", "f-small f-strong f-mono", fit=600)
for x, i in ((40, 0), (380, 1)):
    f.box(x, 186, 140, 56, "f-box"); f.text(x + 70, 208, f"db-{i}", "f-small f-strong f-mono"); f.text(x + 70, 228, f"db-{i}.db", "f-small f-mono")
    f.box(x + 180, 186, 130, 56, "f-box-ok"); f.text(x + 245, 208, f"data-db-{i}", "f-small f-mono"); f.text(x + 245, 228, "own claim", "f-small")
    f.arrow([(x + 142, 214), (x + 178, 214)])
write(ROOT, "kubernetes", "storage", f,
      "Top: Pod writer uses the claim notes of 64 mebibytes, which stays Pending until a Pod uses it; the StorageClass standard then provisions a PersistentVolume. When the Pod is replaced the data stays; with reclaim policy Delete, deleting the claim deletes the data. Bottom: StatefulSet db with a headless Service db runs Pods db-0 and db-1, reachable as db-0.db and db-1.db, each with its own claim, data-db-0 and data-db-1.",
      "Pods come and go; claims keep the data, and a StatefulSet gives each member its own name and its own claim.")
