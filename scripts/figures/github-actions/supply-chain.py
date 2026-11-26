"""Figure for github-actions-supply-chain-hardening; run: python3 scripts/figures/github-actions/supply-chain.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Hardening what a workflow runs and what it releases, from Supply-chain hardening.")
f.box(10, 30, 220, 80, "f-box-danger"); f.text(120, 54, "uses: org/action@v2", "f-small f-strong f-mono", fit=210); f.text(120, 78, "tag can be moved", "f-small"); f.text(120, 98, "to other code", "f-small")
f.box(10, 150, 220, 80, "f-box-ok"); f.text(120, 174, "uses: org/action@<sha>", "f-small f-strong f-mono", fit=210); f.text(120, 198, "# v2.1.0", "f-small f-mono"); f.text(120, 218, "exactly one commit", "f-small")
f.box(270, 90, 190, 90, "f-box-accent"); f.text(365, 114, "Dependabot", "f-small f-strong"); f.text(365, 138, "PRs bump SHA", "f-small"); f.text(365, 158, "and comment together", "f-small", fit=180)
f.box(500, 90, 210, 90, "f-box-warn"); f.text(605, 114, "actions/attest", "f-small f-strong f-mono"); f.text(605, 138, "signed provenance:", "f-small", fit=200); f.text(605, 158, "workflow, repo, commit", "f-small", fit=200)
f.arrow([(232, 190), (268, 150)]); f.arrow([(462, 135), (498, 135)])
f.text(605, 210, "gh attestation verify", "f-small f-mono")
f.text(360, 255, "lockfiles (gh actions-lock) also pin the actions your actions use", "f-small f-muted", fit=640)
write(ROOT, "github-actions", "supply-chain", f,
      "Top left, uses: org/action@v2 relies on a tag that can be moved to other code. Bottom left, uses: org/action@ followed by a commit SHA, with the comment # v2.1.0, names exactly one commit. Dependabot opens pull requests that bump the SHA and the comment together. actions/attest signs provenance stating which workflow, repository and commit built a release, which gh attestation verify checks. Workflow dependency lockfiles, made with gh actions-lock, also pin the actions your actions use.",
      "Pin what you run, update it through review, and prove what you release.")
