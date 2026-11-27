"""Figure for n8n-self-hosting-securely; run: python3 scripts/figures/n8n/self-hosting.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "A self-hosted n8n and what protects it, from Self-hosting n8n securely.")
f.box(10, 110, 140, 80, "f-box-faint"); f.text(80, 140, "users &", "f-small f-strong"); f.text(80, 160, "webhooks", "f-small f-strong")
f.box(190, 100, 150, 100, "f-box-accent"); f.text(265, 128, "reverse proxy", "f-small f-strong"); f.text(265, 150, "TLS · auth", "f-small"); f.text(265, 172, "(Nginx)", "f-small")
f.box(380, 80, 170, 140, "f-box-accent"); f.text(465, 104, "n8n", "f-small f-strong")
f.text(465, 128, "NODES_EXCLUDE", "f-small f-mono"); f.text(465, 148, "(Execute Command off)", "f-small", fit=160); f.text(465, 172, "n8n audit", "f-small f-mono"); f.text(465, 194, "task runners isolated", "f-small", fit=160)
f.box(590, 30, 120, 110, "f-box-ok"); f.text(650, 56, "volume /", "f-small f-strong"); f.text(650, 76, "PostgreSQL", "f-small f-strong"); f.text(650, 100, "credentials", "f-small"); f.text(650, 118, "encrypted", "f-small")
f.box(590, 170, 120, 110, "f-box-danger"); f.text(650, 196, "encryption", "f-small f-strong"); f.text(650, 216, "key", "f-small f-strong"); f.text(650, 240, "secret store +", "f-small", fit=110); f.text(650, 258, "separate backup", "f-small", fit=110)
f.arrow([(152, 150), (188, 150)]); f.arrow([(342, 150), (378, 150)]); f.arrow([(552, 120), (588, 90)]); f.arrow([(552, 180), (588, 220)])
f.text(360, 306, "lose the key and every stored credential is unreadable — back it up apart from the database", "f-small f-danger", fit=700)
write(ROOT, "n8n", "self-hosting", f,
      "Users and webhooks reach n8n through a reverse proxy such as Nginx, which provides TLS and authentication. n8n excludes risky nodes with NODES_EXCLUDE, so Execute Command is off, runs n8n audit regularly and isolates its task runners. Its data lives on a volume or in PostgreSQL, with credentials encrypted. The encryption key belongs in a secret store with a separate backup: lose the key and every stored credential is unreadable.",
      "TLS and authentication in front, fewer capabilities inside, encrypted data on durable storage, and the key kept safe.")
