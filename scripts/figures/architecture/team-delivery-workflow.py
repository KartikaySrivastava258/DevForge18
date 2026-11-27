"""Reference architecture: team delivery workflow; run: python3 scripts/figures/architecture/team-delivery-workflow.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 315, "Reference architecture: team delivery workflow from work item to release.")
# Top row: work item -> branch and commits -> pull request -> protected main
f.box(10, 35, 140, 75, "f-box-accent"); f.text(80, 62, "Jira work item", "f-small f-strong", fit=130); f.text(80, 80, "DEV-12, criteria,", "f-small", fit=130); f.text(80, 96, "WIP-limited board", "f-small", fit=130)
f.box(190, 35, 150, 75, "f-box"); f.text(265, 62, "branch + commits", "f-small f-strong", fit=140); f.text(265, 80, "DEV-12-reset-link,", "f-small", fit=140); f.text(265, 96, "key in every message", "f-small", fit=140)
f.arrow([(152, 72), (188, 72)])
f.box(380, 35, 160, 75, "f-box-accent"); f.text(460, 62, "pull request", "f-small f-strong", fit=150); f.text(460, 80, "small, reviewed,", "f-small", fit=150); f.text(460, 96, "key in the title", "f-small", fit=150)
f.arrow([(342, 72), (378, 72)])
f.box(580, 35, 170, 75, "f-box-ok"); f.text(665, 62, "protected main", "f-small f-strong", fit=160); f.text(665, 80, "merge only with review", "f-small", fit=160); f.text(665, 96, "and green checks", "f-small", fit=160)
f.arrow([(542, 72), (578, 72)])
# Jira links the code back to the work item
f.arrow([(460, 33), (460, 15), (80, 15), (80, 33)])
f.text(270, 29, "Jira links branch, commits and pull request by key", "f-small f-muted", fit=330)
# Bottom row: metrics, collection, CI, release
f.box(10, 160, 140, 80, "f-box-faint"); f.text(80, 188, "flow metrics", "f-small f-strong", fit=130); f.text(80, 206, "cycle time, WIP,", "f-small", fit=130); f.text(80, 222, "throughput", "f-small", fit=130)
f.arrow([(80, 112), (80, 158)])
f.box(190, 165, 150, 70, "f-box"); f.text(265, 192, "Postman collection", "f-small f-strong", fit=140); f.text(265, 210, "API tests + docs", "f-small", fit=140)
f.box(380, 155, 160, 90, "f-box-warn"); f.text(460, 182, "CI on the PR", "f-small f-strong", fit=150); f.text(460, 200, "unit tests, Newman", "f-small", fit=150); f.text(460, 216, "on a fresh API,", "f-small", fit=150); f.text(460, 232, "key check", "f-small", fit=150)
f.arrow([(342, 200), (378, 200)])
f.arrow([(440, 112), (440, 153)]); f.arrow([(480, 153), (480, 112)])
f.text(515, 136, "status", "f-small f-muted", fit=50)
f.box(580, 155, 170, 90, "f-box"); f.text(665, 182, "version tag", "f-small f-strong", fit=160); f.text(665, 200, "release workflow:", "f-small", fit=160); f.text(665, 216, "tests again, notes", "f-small", fit=160); f.text(665, 232, "grouped by work item", "f-small", fit=160)
f.arrow([(665, 112), (665, 153)])
f.text(380, 290, "the key ties board, code and release notes together; the Jira fix version matches the tag", "f-small", fit=640)
write(ROOT, "architecture", "team-delivery-workflow", f,
      "A Jira work item, such as DEV-12 with acceptance criteria on a WIP-limited board, leads to a branch named after the key with the key in every commit message, then to a small reviewed pull request with the key in its title, and finally to a protected main branch that accepts a merge only with a review and green checks. Jira links the branch, commits and pull request back to the work item by its key. The pull request triggers CI, which runs the unit tests, runs the Postman collection of API tests with Newman against a freshly started API, checks the keys, and reports its status back. On main, a version tag starts a release workflow that runs the tests again and writes release notes grouped by work item. Flow metrics - cycle time, work in progress and throughput - come from the work items' status history. The Jira fix version matches the tag.",
      "One key travels from the work item to the release notes; required checks guard main.")
