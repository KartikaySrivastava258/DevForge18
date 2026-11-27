"""Reference architecture: a web application with a cache; run: python3 scripts/figures/architecture/web-app-with-cache.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Reference architecture: web application with a cache.")
f.box(10, 100, 110, 60, "f-box"); f.text(65, 135, "users", "f-small", fit=100)
f.box(160, 90, 130, 80, "f-box-accent"); f.text(225, 120, "Nginx", "f-small f-strong", fit=120); f.text(225, 140, "static, TLS,", "f-small", fit=120); f.text(225, 156, "proxy, limits", "f-small", fit=120)
f.arrow([(122, 130), (158, 130)])
f.box(340, 40, 140, 60, "f-box"); f.text(410, 75, "API instance", "f-small", fit=130)
f.box(340, 160, 140, 60, "f-box"); f.text(410, 195, "API instance", "f-small", fit=130)
f.arrow([(292, 115), (338, 75)]); f.arrow([(292, 145), (338, 185)])
f.box(540, 20, 160, 80, "f-box-ok"); f.text(620, 50, "Redis", "f-small f-strong", fit=150); f.text(620, 70, "cache-aside,", "f-small", fit=150); f.text(620, 86, "TTLs, rate limits", "f-small", fit=150)
f.box(540, 160, 160, 80, "f-box-ok"); f.text(620, 190, "PostgreSQL", "f-small f-strong", fit=150); f.text(620, 210, "source of truth,", "f-small", fit=150); f.text(620, 226, "constraints", "f-small", fit=150)
f.arrow([(482, 65), (538, 60)]); f.arrow([(482, 80), (538, 185)]); f.arrow([(482, 180), (538, 80)]); f.arrow([(482, 195), (538, 200)])
f.text(360, 262, "everything packaged as containers (Docker Compose locally)", "f-small", fit=500)
write(ROOT, "architecture", "web-app-with-cache", f,
      "Users reach Nginx, which serves static files, terminates TLS, applies limits and proxies API requests to two API instances. Both instances read through a Redis cache with TTLs and rate limits and read and write PostgreSQL, the source of truth with constraints. Everything is packaged as containers, with Docker Compose locally.",
      "Nginx in front, stateless API instances, Redis for speed and PostgreSQL for truth.")
