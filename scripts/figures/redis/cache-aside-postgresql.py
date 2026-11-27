"""Figure for redis-cache-aside-with-postgresql; run: python3 scripts/figures/redis/cache-aside-postgresql.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "Reads go to Redis first; writes go to PostgreSQL and then remove the cached copy.")
f.box(20, 110, 130, 70, "f-box"); f.text(85, 140, "application", "f-small f-strong", fit=120); f.text(85, 160, "(app.py)", "f-small f-mono", fit=120)
f.box(300, 20, 160, 80, "f-box-ok"); f.text(380, 50, "Redis", "f-small f-strong", fit=150); f.text(380, 70, "course:CS101", "f-small f-mono", fit=150); f.text(380, 88, "TTL 60 s", "f-small", fit=150)
f.box(300, 190, 160, 80, "f-box-ok"); f.text(380, 220, "PostgreSQL", "f-small f-strong", fit=150); f.text(380, 240, "courses table", "f-small", fit=150); f.text(380, 258, "(source of truth)", "f-small", fit=150)
f.arrow([(152, 125), (298, 60)]); f.text(215, 78, "1. read: GET", "f-small", fit=140)
f.arrow([(152, 150), (298, 215)]); f.text(200, 205, "2. on a miss: SELECT", "f-small", fit=160)
f.arrow([(380, 188), (380, 102)]); f.text(470, 150, "3. SET with TTL", "f-small", fit=140)
f.box(520, 110, 190, 80, "f-box-warn"); f.text(615, 138, "write path", "f-small f-strong", fit=180); f.text(615, 158, "UPDATE in a transaction,", "f-small", fit=180); f.text(615, 176, "then DEL the key", "f-small", fit=180)
write(ROOT, "redis", "cache-aside-postgresql", f,
      "The application first reads the key course:CS101 from Redis (step 1). On a miss it selects the row from the courses table in PostgreSQL, the source of truth (step 2), and stores a copy in Redis with a 60-second TTL (step 3). A separate write path updates PostgreSQL in a transaction and then deletes the cached key.",
      "Cache-aside: Redis holds copies; PostgreSQL holds the truth; every write removes the copy it makes stale.")
