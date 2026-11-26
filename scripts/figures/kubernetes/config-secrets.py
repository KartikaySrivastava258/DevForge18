"""Figure for a lesson; run: python3 scripts/figures/kubernetes/config-secrets.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "How a Pod receives configuration, from ConfigMaps and Secrets.")
f.box(10, 30, 210, 90, "f-box-accent"); f.text(115, 54, "ConfigMap library-config", "f-small f-strong f-mono", fit=200); f.text(115, 78, "GREETING", "f-small f-mono"); f.text(115, 100, "settings.ini (a whole file)", "f-small", fit=200)
f.box(10, 150, 210, 90, "f-box-warn"); f.text(115, 174, "Secret db-credentials", "f-small f-strong f-mono", fit=200); f.text(115, 198, "password (base64)", "f-small f-mono", fit=200); f.text(115, 220, "unencrypted in etcd by default", "f-small f-danger", fit=200)
f.box(300, 50, 400, 170, "f-box"); f.text(500, 74, "Pod library-app", "f-small f-strong f-mono")
f.box(320, 90, 170, 110, "f-box-faint"); f.text(405, 112, "environment", "f-small f-strong"); f.text(405, 136, "GREETING", "f-small f-mono", fit=160); f.text(405, 154, "DB_PASSWORD", "f-small f-mono", fit=160); f.text(405, 176, "set at start:", "f-small", fit=160); f.text(405, 194, "new Pod to update", "f-small f-warn", fit=160)
f.box(510, 90, 170, 110, "f-box-faint"); f.text(595, 112, "mounted files", "f-small f-strong"); f.text(595, 136, "/etc/library", "f-small f-mono", fit=160); f.text(595, 154, "/etc/secrets", "f-small f-mono", fit=160); f.text(595, 176, "refreshed by kubelet", "f-small", fit=160); f.text(595, 194, "after a delay", "f-small f-ok", fit=160)
f.arrow([(222, 75), (318, 120)]); f.arrow([(222, 195), (318, 160)]); f.arrow([(222, 90), (508, 110)])
write(ROOT, "kubernetes", "config-secrets", f,
      "A ConfigMap named library-config holds GREETING and a whole file, settings.ini. A Secret named db-credentials holds a base64-encoded password and is stored unencrypted in etcd by default. Pod library-app receives GREETING and DB_PASSWORD as environment variables, which are set when the container starts, so a new Pod is needed to see changes. It also mounts files at /etc/library and /etc/secrets, which the kubelet refreshes after a delay.",
      "Environment variables are fixed at start; mounted files follow changes; Secrets are only as safe as access to them.")
