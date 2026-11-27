"""Architecture of Capstone F (delivery platform); run: python3 scripts/figures/capstones/capstone-f-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 400, "Capstone F architecture: from a work item to a monitored release.")
f.box(20, 30, 130, 70, "f-box"); f.text(85, 58, "Jira work item", "f-small f-strong", fit=120); f.text(85, 78, "key in branch", "f-small", fit=120)
f.box(190, 30, 150, 70, "f-box"); f.text(265, 58, "pull request", "f-small f-strong", fit=140); f.text(265, 78, "review, protected", "f-small", fit=140)
f.arrow([(152, 65), (188, 65)])
f.box(380, 20, 170, 90, "f-box-accent"); f.text(465, 48, "CI: GitHub Actions", "f-small f-strong", fit=160); f.text(465, 68, "or Jenkins: test, build,", "f-small", fit=160); f.text(465, 86, "scan, attest image", "f-small", fit=160)
f.arrow([(342, 65), (378, 65)])
f.box(590, 30, 150, 70, "f-box-ok"); f.text(665, 58, "registry", "f-small f-strong", fit=140); f.text(665, 78, "image by digest", "f-small", fit=140)
f.arrow([(552, 65), (588, 65)])
f.box(20, 160, 260, 90, "f-box-warn"); f.text(150, 188, "Terraform", "f-small f-strong", fit=250); f.text(150, 208, "environments as code; plan reviewed", "f-small", fit=250); f.text(150, 226, "in the pull request, then applied", "f-small", fit=250)
f.box(330, 150, 410, 110, "f-box-faint"); f.text(535, 172, "Kubernetes: staging, then production", "f-small f-strong", fit=400)
f.text(535, 196, "rolling update, readiness gate,", "f-small", fit=400); f.text(535, 214, "manual approval, automatic rollback", "f-small", fit=400); f.text(535, 234, "requests, limits, probes", "f-small", fit=400)
f.arrow([(282, 205), (328, 205)]); f.arrow([(665, 102), (665, 148)])
f.box(330, 300, 410, 80, "f-box"); f.text(535, 326, "Prometheus + Grafana and OpenTelemetry:", "f-small", fit=400); f.text(535, 346, "deployment markers, SLO burn rates, traces", "f-small", fit=400); f.text(535, 364, "that decide whether a release stays", "f-small", fit=400)
f.arrow([(535, 262), (535, 298)])
f.box(20, 300, 260, 80, "f-box"); f.text(150, 326, "release notes from work items;", "f-small", fit=250); f.text(150, 346, "every deployment traceable", "f-small", fit=250); f.text(150, 364, "to a commit and a review", "f-small", fit=250)
write(ROOT, "capstones", "capstone-f-architecture", f,
      "A Jira work item's key goes into a branch, which becomes a reviewed pull request into a protected main branch. CI — GitHub Actions or Jenkins — tests, builds, scans and attests the image and pushes it to a registry, addressed by digest. Terraform defines the environments as code; its plan is reviewed in the pull request and then applied. The image is deployed to Kubernetes, first to staging and then to production, with rolling updates, a readiness gate, manual approval and automatic rollback, and every workload has requests, limits and probes. Prometheus with Grafana and OpenTelemetry show deployment markers, SLO burn rates and traces that decide whether a release stays. Release notes come from the work items, and every deployment can be traced to a commit and a review.",
      "Every change travels the same audited path, and the monitoring decides whether it stays.")
