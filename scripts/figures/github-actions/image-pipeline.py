"""Figure for github-actions-building-and-pushing-images; run: python3 scripts/figures/github-actions/image-pipeline.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "From commit to deployable digest, from Building and pushing container images.")
f.box(10, 90, 130, 70, "f-box"); f.text(75, 116, "commit + tag", "f-small f-strong"); f.text(75, 138, "v1.2.0", "f-small f-mono")
f.box(180, 70, 170, 110, "f-box-accent"); f.text(265, 96, "build once", "f-small f-strong"); f.text(265, 120, "labels: source,", "f-small", fit=160); f.text(265, 140, "revision, version", "f-small", fit=160); f.text(265, 162, "PRs: build only", "f-small f-muted", fit=160)
f.box(390, 30, 160, 190, "f-box-faint"); f.text(470, 52, "tags (names)", "f-small f-strong")
for i, t in enumerate(["sha-e7750c5", "main", "1.2.0", "1.2", "1"]):
    f.text(470, 80 + i * 26, t, "f-small f-mono")
f.box(590, 90, 120, 70, "f-box-ok"); f.text(650, 116, "one digest", "f-small f-strong"); f.text(650, 138, "sha256:…", "f-small f-mono")
f.arrow([(142, 125), (178, 125)]); f.arrow([(352, 125), (388, 125)]); f.arrow([(552, 125), (588, 125)])
f.text(360, 250, "deploy the digest: tags like main and 1 move, the digest never does", "f-small f-muted", fit=640)
write(ROOT, "github-actions", "image-pipeline", f,
      "A commit tagged v1.2.0 is built once, with labels for its source, revision and version; pull requests only build. The image is pushed under five tags — sha-e7750c5, main, 1.2.0, 1.2 and 1 — which are names for one digest, sha256 followed by a hash. Deploy the digest: tags like main and 1 move to newer images, the digest never does.",
      "Many names, one image: tag for people, deploy by digest.")
