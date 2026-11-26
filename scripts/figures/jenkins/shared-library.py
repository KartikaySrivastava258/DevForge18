"""Figure for jenkins-shared-libraries; run: python3 scripts/figures/jenkins/shared-library.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "One library, many pipelines, from Shared libraries.")
f.box(10, 40, 230, 160, "f-box-accent"); f.text(125, 64, "devforge-lib (Git)", "f-small f-strong", fit=220); f.text(125, 88, "vars/greet.groovy", "f-small f-mono", fit=220); f.text(125, 108, "vars/standardBuild.groovy", "f-small f-mono", fit=220); f.text(125, 128, "src/org/devforge/…", "f-small f-mono", fit=220); f.text(125, 156, "tags: v1.0, v1.1", "f-small f-mono"); f.text(125, 180, "default: v1.0 (JCasC)", "f-small", fit=220)
f.box(330, 30, 380, 80, "f-box-ok"); f.text(520, 54, "course-site", "f-small f-strong f-mono"); f.text(520, 76, "@Library('devforge-lib') _", "f-small f-mono", fit=370); f.text(520, 96, "→ v1.0, toolchain 1.0", "f-small", fit=370)
f.box(330, 140, 380, 80, "f-box-warn"); f.text(520, 164, "course-site-next", "f-small f-strong f-mono"); f.text(520, 186, "@Library('devforge-lib@v1.1') _", "f-small f-mono", fit=370); f.text(520, 206, "→ v1.1, toolchain 1.1", "f-small", fit=370)
f.arrow([(242, 100), (328, 72)]); f.arrow([(242, 150), (328, 180)])
f.text(360, 255, "each build log records the tag and commit it resolved", "f-small f-muted", fit=640)
write(ROOT, "jenkins", "shared-library", f,
      "The Git repository devforge-lib contains vars/greet.groovy, vars/standardBuild.groovy and classes under src/org/devforge, with tags v1.0 and v1.1; JCasC sets the default version to v1.0. The course-site pipeline uses @Library('devforge-lib') and gets v1.0 with toolchain 1.0. The course-site-next pipeline uses @Library('devforge-lib@v1.1') and gets toolchain 1.1. Each build log records the tag and commit it resolved.",
      "Shared steps in one versioned repository; each pipeline chooses when to move.")
