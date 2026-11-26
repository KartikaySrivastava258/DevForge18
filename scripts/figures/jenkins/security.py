"""Figure for jenkins-securing-jenkins; run: python3 scripts/figures/jenkins/security.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Who may do what, from Securing Jenkins.")
cols = ["read job", "build", "script console"]
rows = [("anonymous", ["no", "no", "no"]), ("viewer", ["yes", "no", "no"]), ("dev", ["yes", "yes", "no"]), ("admin", ["yes", "yes", "yes"])]
f.box(10, 20, 460, 200, "f-box-faint")
for i, c in enumerate(cols):
    f.text(200 + i * 110, 44, c, "f-small f-strong", fit=105)
for r, (name, vals) in enumerate(rows):
    y = 80 + r * 36
    f.text(70, y, name, "f-small f-mono")
    for i, v in enumerate(vals):
        f.text(200 + i * 110, y, v, "f-small " + ("f-ok" if v == "yes" else "f-danger"))
f.box(500, 20, 210, 90, "f-box-ok"); f.text(605, 44, "API token (per script)", "f-small f-strong", fit=200); f.text(605, 66, "no crumb needed", "f-small"); f.text(605, 88, "revocable on its own", "f-small")
f.box(500, 130, 210, 90, "f-box-warn"); f.text(605, 154, "Overall/Administer", "f-small f-strong f-mono", fit=200); f.text(605, 176, "= script console =", "f-small", fit=200); f.text(605, 198, "every secret", "f-small")
f.text(360, 255, "also: 0 executors on the controller, pinned and patched plugins, credentials in Jenkins", "f-small f-muted", fit=700)
write(ROOT, "jenkins", "security", f,
      "A permission matrix: anonymous can read nothing, build nothing and has no script console; viewer can read jobs only; dev can read and build; admin can do everything including the script console. API tokens are created per script, need no CSRF crumb and can be revoked on their own. Overall/Administer means the script console, which means every secret. Also: no executors on the controller, pinned and patched plugins, and credentials stored in Jenkins.",
      "Least privilege per account, tokens for scripts, and the script console reserved for administrators.")
