"""Figure for github-actions-reusable-workflows-and-composite-actions; run: python3 scripts/figures/github-actions/reuse.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Shared jobs and shared steps, from Reusable workflows and composite actions.")
f.box(10, 30, 170, 64, "f-box"); f.text(95, 56, "ci.yml", "f-small f-strong f-mono"); f.text(95, 78, "matrix: 20, 22", "f-small f-mono")
f.box(10, 150, 170, 64, "f-box"); f.text(95, 176, "nightly.yml", "f-small f-strong f-mono"); f.text(95, 198, "node-version: 22", "f-small f-mono", fit=160)
f.box(250, 70, 220, 120, "f-box-accent"); f.text(360, 94, "node-ci.yml", "f-small f-strong f-mono"); f.text(360, 116, "on: workflow_call", "f-small f-mono", fit=210); f.text(360, 138, "inputs: node-version,", "f-small f-mono", fit=210); f.text(360, 158, "check-docs (default)", "f-small f-mono", fit=210); f.text(360, 178, "a shared job", "f-small f-muted")
f.box(530, 80, 180, 100, "f-box-ok"); f.text(620, 104, "check-title", "f-small f-strong f-mono"); f.text(620, 126, "composite action", "f-small"); f.text(620, 148, "shared steps,", "f-small"); f.text(620, 166, "input via env", "f-small")
f.arrow([(182, 62), (248, 110)]); f.arrow([(182, 182), (248, 150)]); f.arrow([(472, 130), (528, 130)])
f.text(360, 240, "workflows call jobs (uses: at job level); jobs call actions (uses: in a step)", "f-small f-muted", fit=660)
write(ROOT, "github-actions", "reuse", f,
      "Two caller workflows, ci.yml with a matrix of Node.js 20 and 22 and nightly.yml with node-version 22, both call the reusable workflow node-ci.yml, which has on: workflow_call, the inputs node-version and check-docs with a default, and contains a shared job. That job uses the composite action check-title, which bundles shared steps and receives its input through env. Workflows call jobs with uses at job level; jobs call actions with uses in a step.",
      "Reusable workflows share jobs; composite actions share steps.")
