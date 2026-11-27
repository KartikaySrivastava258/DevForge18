"""Architecture of Capstone B (course registration platform); run: python3 scripts/figures/capstones/capstone-b-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 400, "Capstone B architecture: one Docker Compose project, one public entry point.")
f.box(10, 10, 740, 300, "f-box-faint"); f.text(110, 32, "Docker Compose project", "f-small f-strong", fit=180)
f.box(20, 140, 110, 60, "f-box"); f.text(75, 168, "browser", "f-small", fit=100); f.text(75, 186, "(students)", "f-small", fit=100)
f.box(170, 130, 130, 80, "f-box-accent"); f.text(235, 160, "Nginx", "f-small f-strong", fit=120)
f.text(235, 178, "static files", "f-small", fit=120); f.text(235, 194, "/api → API", "f-small f-mono", fit=120)
f.arrow([(132, 170), (168, 170)])
f.box(350, 70, 140, 60, "f-box"); f.text(420, 98, "API instance 1", "f-small", fit=130); f.text(420, 116, "(stateless)", "f-small", fit=130)
f.box(350, 210, 140, 60, "f-box"); f.text(420, 238, "API instance 2", "f-small", fit=130); f.text(420, 256, "(stateless)", "f-small", fit=130)
f.arrow([(302, 160), (348, 105)]); f.arrow([(302, 180), (348, 235)])
f.box(560, 60, 170, 70, "f-box-ok"); f.text(645, 90, "Redis", "f-small f-strong", fit=160); f.text(645, 110, "cache, rate limits", "f-small", fit=160)
f.box(560, 200, 170, 80, "f-box-ok"); f.text(645, 230, "PostgreSQL", "f-small f-strong", fit=160)
f.text(645, 250, "constraints, migrations", "f-small", fit=160); f.text(645, 266, "named volume", "f-small", fit=160)
f.arrow([(492, 98), (558, 95)]); f.arrow([(492, 110), (558, 225)]); f.arrow([(492, 238), (558, 115)]); f.arrow([(492, 245), (558, 240)])
f.box(20, 330, 220, 56, "f-box"); f.text(130, 354, "GitHub: branches,", "f-small", fit=210); f.text(130, 372, "pull requests, CI", "f-small", fit=210)
f.box(270, 330, 220, 56, "f-box"); f.text(380, 354, "Postman collection", "f-small", fit=210); f.text(380, 372, "run by Newman in CI", "f-small", fit=210)
f.box(520, 330, 220, 56, "f-box"); f.text(630, 354, "health checks,", "f-small", fit=210); f.text(630, 372, "non-root containers", "f-small", fit=210)
write(ROOT, "capstones", "capstone-b-architecture", f,
      "A browser talks only to Nginx, which serves the static frontend and forwards /api requests to two stateless API instances. Both instances read and write PostgreSQL (constraints, migrations, data on a named volume) and use Redis for caching and rate limits. Everything runs as one Docker Compose project. Below it: the GitHub repository with branches, pull requests and CI; a Postman collection run by Newman in CI; and health checks with non-root containers.",
      "One public entry point, stateless API instances, PostgreSQL as the source of truth and Redis as a disposable cache.")
