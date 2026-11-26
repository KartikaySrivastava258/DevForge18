"""Figure for kubernetes-rbac-and-network-policies; run: python3 scripts/figures/kubernetes/rbac-netpol.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Two layers of least privilege, from RBAC and network policies.")
f.text(180, 24, "RBAC: what an identity may do via the API", "f-small f-strong", fit=340)
f.box(10, 40, 160, 60, "f-box"); f.text(90, 64, "ServiceAccount", "f-small f-strong"); f.text(90, 84, "reporter", "f-small f-mono")
f.box(200, 40, 150, 60, "f-box-accent"); f.text(275, 64, "RoleBinding", "f-small f-strong"); f.text(275, 84, "in rbac-lab", "f-small")
f.box(10, 130, 340, 60, "f-box-faint"); f.text(180, 152, "Role pod-reader: get, list, watch pods", "f-small f-mono", fit=330); f.text(180, 174, "delete pods, read Secrets: Forbidden", "f-small f-danger", fit=330)
f.arrow([(172, 70), (198, 70)]); f.arrow([(275, 102), (275, 128)])
f.text(545, 24, "NetworkPolicy: who may connect", "f-small f-strong", fit=330)
f.box(400, 40, 130, 56, "f-box-ok"); f.text(465, 62, "frontend", "f-small f-strong f-mono"); f.text(465, 82, "allowed", "f-small f-ok")
f.box(400, 200, 130, 56, "f-box-danger"); f.text(465, 222, "intruder", "f-small f-strong f-mono"); f.text(465, 242, "blocked", "f-small f-danger")
f.box(580, 110, 130, 76, "f-box-accent"); f.text(645, 134, "web", "f-small f-strong f-mono"); f.text(645, 154, "isolated:", "f-small"); f.text(645, 172, "frontend only", "f-small f-mono", fit=124)
f.arrow([(532, 72), (578, 130)])
f.text(560, 214, "✕", "f-small f-danger")
f.text(180, 226, "default: no rights until granted", "f-small f-muted", fit=330)
f.text(545, 272, "default: every Pod may connect until a policy selects it", "f-small f-muted", fit=360)
write(ROOT, "kubernetes", "rbac-netpol", f,
      "Left, RBAC: the ServiceAccount reporter is bound by a RoleBinding in namespace rbac-lab to the Role pod-reader, which allows get, list and watch on pods; deleting pods or reading Secrets is Forbidden. By default an identity has no rights until granted. Right, NetworkPolicy: the web Pod is isolated and accepts connections only from Pods labelled app=frontend, so frontend is allowed and intruder is blocked. By default every Pod may connect until a policy selects it.",
      "RBAC limits what an identity may do through the API; NetworkPolicies limit which Pods may connect.")
