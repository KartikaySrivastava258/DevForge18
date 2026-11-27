"""Reference architecture: continuous delivery to Kubernetes; run: python3 scripts/figures/architecture/ci-cd-to-kubernetes.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 330, "Reference architecture: continuous delivery to Kubernetes.")
# Top row: pull request -> protected main -> build once -> registry
f.box(10, 30, 130, 80, "f-box"); f.text(75, 60, "Pull request", "f-small f-strong", fit=120); f.text(75, 80, "tests, build,", "f-small", fit=120); f.text(75, 96, "no push", "f-small", fit=120)
f.box(180, 30, 130, 80, "f-box-accent"); f.text(245, 60, "main", "f-small f-strong", fit=120); f.text(245, 80, "review + green", "f-small", fit=120); f.text(245, 96, "checks required", "f-small", fit=120)
f.arrow([(142, 70), (178, 70)])
f.box(350, 30, 140, 80, "f-box"); f.text(420, 60, "Build once", "f-small f-strong", fit=130); f.text(420, 80, "pinned base,", "f-small", fit=130); f.text(420, 96, "labels, push", "f-small", fit=130)
f.arrow([(312, 70), (348, 70)])
f.box(530, 30, 140, 80, "f-box-ok"); f.text(600, 60, "Registry", "f-small f-strong", fit=130); f.text(600, 80, "image digest", "f-small", fit=130); f.text(600, 96, "sha256:...", "f-small f-mono", fit=130)
f.arrow([(492, 70), (528, 70)])
# Bottom row: staging -> approval -> production, both on Kubernetes
f.box(180, 170, 150, 80, "f-box"); f.text(255, 200, "Staging", "f-small f-strong", fit=140); f.text(255, 220, "deploy digest,", "f-small", fit=140); f.text(255, 236, "rollout status", "f-small", fit=140)
f.box(370, 170, 130, 80, "f-box-warn"); f.text(435, 200, "Approval", "f-small f-strong", fit=120); f.text(435, 220, "required", "f-small", fit=120); f.text(435, 236, "reviewers", "f-small", fit=120)
f.box(540, 170, 150, 80, "f-box-accent"); f.text(615, 200, "Production", "f-small f-strong", fit=140); f.text(615, 220, "same digest,", "f-small", fit=140); f.text(615, 236, "OIDC credentials", "f-small", fit=140)
f.arrow([(600, 112), (600, 135), (255, 135), (255, 168)])
f.arrow([(332, 210), (368, 210)]); f.arrow([(502, 210), (538, 210)])
f.text(430, 129, "digest passed on", "f-small f-muted", fit=150)
f.text(435, 272, "Kubernetes: probes, rolling update, rollback", "f-small", fit=400)
# Terraform underneath
f.box(10, 170, 130, 80, "f-box-faint"); f.text(75, 200, "Terraform", "f-small f-strong", fit=120); f.text(75, 220, "plan, review,", "f-small", fit=120); f.text(75, 236, "apply saved plan", "f-small", fit=120)
f.text(380, 312, "Terraform creates the cluster, database and cloud roles from reviewed plans", "f-small f-muted", fit=600)
write(ROOT, "architecture", "ci-cd-to-kubernetes", f,
      "A pull request runs tests and builds the image without pushing it. It reaches main only after review and green required checks. From main, the image is built once from pinned base images, labelled and pushed to a registry, which returns its digest. The digest is passed to a staging deployment that waits for the rollout; a required-reviewer approval follows; production then deploys the same digest using short-lived OIDC credentials. Both environments run on Kubernetes with probes, rolling updates and rollback. Terraform, shown separately, creates the cluster, database and cloud roles through planned, reviewed and saved-plan applies.",
      "Review and tests before merge, one build, the same digest promoted from staging to production.")
