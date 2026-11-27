"""Reference architecture: self-managed CI with Jenkins; run: python3 scripts/figures/architecture/self-managed-ci.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 325, "Reference architecture: self-managed CI with Jenkins and build agents.")
# Git and the controller with what it is built from
f.box(10, 40, 130, 70, "f-box"); f.text(75, 66, "Git repository", "f-small f-strong", fit=120); f.text(75, 84, "code, Jenkinsfile,", "f-small", fit=120); f.text(75, 100, "scripts", "f-small", fit=120)
f.box(190, 25, 170, 100, "f-box-accent"); f.text(275, 55, "Jenkins controller", "f-small f-strong", fit=160); f.text(275, 75, "0 executors,", "f-small", fit=160); f.text(275, 91, "schedules the queue,", "f-small", fit=160); f.text(275, 107, "JCasC from Git", "f-small", fit=160)
f.arrow([(142, 75), (188, 75)]); f.text(165, 66, "push", "f-small f-muted", fit=40)
f.box(10, 170, 130, 60, "f-box"); f.text(75, 196, "shared library", "f-small f-strong", fit=120); f.text(75, 214, "@Library at a tag", "f-small", fit=120)
f.arrow([(142, 190), (200, 127)])
f.box(190, 170, 170, 55, "f-box"); f.text(275, 193, "controller image", "f-small f-strong", fit=160); f.text(275, 211, "pinned release, plugins", "f-small", fit=160)
f.arrow([(275, 168), (275, 127)])
f.box(190, 245, 170, 50, "f-box-ok"); f.text(275, 266, "JENKINS_HOME", "f-small f-strong f-mono", fit=165); f.text(275, 284, "volume, backed up", "f-small", fit=160)
# Agents chosen by label
f.box(420, 20, 150, 55, "f-box"); f.text(495, 43, "label: linux", "f-small f-strong", fit=140); f.text(495, 61, "container agent", "f-small", fit=140)
f.box(420, 90, 150, 55, "f-box"); f.text(495, 113, "label: docker", "f-small f-strong", fit=140); f.text(495, 131, "builds images", "f-small", fit=140)
f.box(420, 160, 150, 65, "f-box-accent"); f.text(495, 186, "label: k8s", "f-small f-strong", fit=140); f.text(495, 204, "fresh Pod per build", "f-small", fit=140)
f.arrow([(362, 50), (418, 47)]); f.arrow([(362, 80), (418, 117)]); f.arrow([(362, 110), (418, 185)])
f.box(420, 245, 150, 50, "f-box-warn"); f.text(495, 266, "credentials", "f-small f-strong", fit=140); f.text(495, 284, "bound per stage", "f-small", fit=140)
f.arrow([(495, 243), (495, 227)])
# Results
f.box(610, 30, 140, 70, "f-box-ok"); f.text(680, 58, "results", "f-small f-strong", fit=130); f.text(680, 76, "junit reports,", "f-small", fit=130); f.text(680, 92, "artifacts", "f-small", fit=130)
f.box(610, 150, 140, 70, "f-box-ok"); f.text(680, 178, "registry", "f-small f-strong", fit=130); f.text(680, 196, "image push,", "f-small", fit=130); f.text(680, 212, "deploy on main", "f-small", fit=130)
f.arrow([(572, 47), (608, 60)]); f.arrow([(572, 117), (608, 170)]); f.arrow([(572, 192), (608, 192)])
f.text(380, 317, "the controller runs no builds; every stage runs on an agent chosen by its label", "f-small", fit=600)
write(ROOT, "architecture", "self-managed-ci", f,
      "A push to the Git repository, which holds the code, the Jenkinsfile and its scripts, starts a build on the Jenkins controller. The controller has 0 executors, schedules the queue and is configured as code from Git; it is built from a controller image with a pinned release and pinned plugins, loads a shared library at a tag, and keeps its JENKINS_HOME on a backed-up volume. The controller sends stages to agents chosen by label: a linux container agent, a docker agent that builds images, and a k8s label that starts a fresh Kubernetes Pod per build. Credentials are bound to a stage only when it needs them. Agents publish junit reports and artifacts, and push images to a registry, deploying on main. The controller runs no builds itself.",
      "The controller schedules; disposable, labelled agents do the work; everything about the server is pinned and in Git.")
