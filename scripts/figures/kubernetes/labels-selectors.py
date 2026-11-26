"""Figure for a lesson; run: python3 scripts/figures/kubernetes/labels-selectors.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Selectors decide membership, from Namespaces, labels and selectors.")
f.box(10, 20, 700, 250, "f-box-faint"); f.text(360, 40, "namespace team-a (quota and names apply here)", "f-small f-strong", fit=600)
f.box(30, 60, 200, 60, "f-box-accent"); f.text(130, 84, "Deployment web", "f-small f-strong f-mono", fit=190); f.text(130, 104, "selector app=web", "f-small f-mono", fit=190)
f.box(490, 60, 200, 60, "f-box-accent"); f.text(590, 84, "Service web", "f-small f-strong f-mono", fit=190); f.text(590, 104, "selector app=web", "f-small f-mono", fit=190)
for i, x in enumerate((90, 270)):
    f.box(x, 160, 160, 56, "f-box-ok"); f.text(x + 80, 182, "Pod", "f-small f-strong"); f.text(x + 80, 202, "app=web", "f-small f-mono")
f.box(470, 160, 200, 56, "f-box-warn"); f.text(570, 182, "relabelled Pod", "f-small f-strong", fit=190); f.text(570, 202, "app=debug: no traffic", "f-small f-mono", fit=190)
f.arrow([(130, 122), (170, 158)]); f.arrow([(130, 122), (350, 158)])
f.arrow([(590, 122), (170, 158)]); f.arrow([(590, 122), (350, 158)])
f.text(360, 246, "the ReplicaSet counts matching Pods and replaces the one that left", "f-small f-muted", fit=640)
write(ROOT, "kubernetes", "labels-selectors", f,
      "Inside namespace team-a, a Deployment named web and a Service named web both use the selector app=web. They both point to the two Pods labelled app=web. A third Pod relabelled app=debug matches neither selector, so it gets no traffic, and the Deployment's ReplicaSet, which counts matching Pods, creates a replacement for it. Quotas and names apply per namespace.",
      "Nothing in Kubernetes lists its Pods; it selects them by label, every time.")
