"""Figure for jira-reports-and-anti-patterns; run: python3 scripts/figures/jira/reports-anti-patterns.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "What each report measures and what distorts it, from Reports, cycle time and anti-patterns.")
rows = [("velocity chart", "estimates committed, done", "point inflation: same output, more points"),
        ("burndown chart", "remaining estimate per day", "bulk closing → flat line, then a cliff"),
        ("control chart", "time between chosen statuses", "skipped statuses, reopened items"),
        ("work-item age", "days in progress so far", "(the early warning the others lack)")]
f.text(110, 26, "report", "f-small f-strong"); f.text(320, 26, "measures", "f-small f-strong"); f.text(570, 26, "distorted by", "f-small f-strong")
for i, (a, b, c) in enumerate(rows):
    y = 40 + i * 64
    f.box(10, y, 200, 52, "f-box-accent" if i < 3 else "f-box-ok"); f.text(110, y + 31, a, "f-small f-strong", fit=190)
    f.box(220, y, 200, 52, "f-box-faint"); f.text(320, y + 31, b, "f-small", fit=190)
    f.box(430, y, 280, 52, "f-box-danger" if i < 3 else "f-box-faint"); f.text(570, y + 31, c, "f-small", fit=270)
write(ROOT, "jira", "reports-anti-patterns", f,
      "Four rows. The velocity chart measures estimates committed and done; it is distorted by point inflation: the same output, more points. The burndown chart measures remaining estimate per day; bulk closing makes it a flat line, then a cliff. The control chart measures time between chosen statuses; it is distorted by skipped statuses and reopened items. Work-item age measures days in progress so far for unfinished items; it is the early warning the others lack.",
      "Know what each report measures — estimates, remaining estimate, time between statuses — and what habits distort it.")
