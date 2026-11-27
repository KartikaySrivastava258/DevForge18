"""Figure for jira-kanban-and-flow-metrics; run: python3 scripts/figures/jira/flow-metrics.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 300, "Lead time, cycle time and WIP, from Kanban and flow metrics in depth.")
labels = [("created", 20), ("To Do", 130), ("In Progress", 330), ("In Review", 480), ("Done", 640)]
f.box(20, 60, 150, 50, "f-box-faint"); f.text(95, 90, "To Do (waiting)", "f-small", fit=140)
f.box(180, 60, 230, 50, "f-box-accent"); f.text(295, 90, "In Progress", "f-small")
f.box(420, 60, 180, 50, "f-box-danger"); f.text(510, 90, "In Review (waiting)", "f-small", fit=170)
f.box(610, 60, 100, 50, "f-box-ok"); f.text(660, 90, "Done", "f-small")
f.arrow([(20, 140), (610, 140)]); f.text(315, 160, "lead time = done − created", "f-small", fit=580)
f.arrow([(180, 190), (610, 190)]); f.text(395, 210, "cycle time = done − started", "f-small", fit=420)
f.text(360, 250, "WIP = items between started and done · throughput = items done per week", "f-small", fit=700)
f.text(360, 276, "stable system (Little's Law): average WIP = throughput × average cycle time", "f-small f-strong", fit=700)
write(ROOT, "jira", "flow-metrics", f,
      "A work item moves from To Do, where it waits, to In Progress, to In Review, where it often waits again, to Done. Lead time runs from creation to done; cycle time runs from the start of work to done. Work in progress counts items between started and done; throughput counts items done per week. In a stable system, Little's Law says average WIP equals throughput times average cycle time.",
      "Lead time is what the customer waits; cycle time is what the team controls; WIP drives both.")
