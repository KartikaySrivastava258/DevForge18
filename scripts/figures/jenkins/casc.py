"""Figure for jenkins-configuration-as-code; run: python3 scripts/figures/jenkins/casc.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Jenkins from files, from Configuration as Code and plugin management.")
f.box(10, 30, 200, 80, "f-box"); f.text(110, 54, "Dockerfile", "f-small f-strong f-mono"); f.text(110, 76, "FROM jenkins 2.580.2-lts", "f-small f-mono", fit=190); f.text(110, 96, "plugins.txt (pinned)", "f-small f-mono", fit=190)
f.box(10, 150, 200, 90, "f-box"); f.text(110, 174, "casc/jenkins.yaml", "f-small f-strong f-mono", fit=190); f.text(110, 196, "users, security,", "f-small", fit=190); f.text(110, 216, "executors, jobs (Job DSL)", "f-small", fit=190)
f.box(270, 80, 190, 110, "f-box-accent"); f.text(365, 106, "Jenkins container", "f-small f-strong", fit=180); f.text(365, 130, "no setup wizard", "f-small"); f.text(365, 152, "${ADMIN_PASSWORD}", "f-small f-mono", fit=180); f.text(365, 172, "from the environment", "f-small f-muted", fit=180)
f.box(520, 60, 190, 64, "f-box-ok"); f.text(615, 84, "REST API", "f-small f-strong"); f.text(615, 106, "crumb + build → 201", "f-small", fit=180)
f.box(520, 150, 190, 64, "f-box-warn"); f.text(615, 174, "edit YAML, review,", "f-small", fit=180); f.text(615, 196, "reload", "f-small f-mono")
f.arrow([(212, 70), (268, 110)]); f.arrow([(212, 195), (268, 160)]); f.arrow([(462, 115), (518, 92)]); f.arrow([(518, 182), (462, 160)])
f.text(360, 258, "rebuild an identical Jenkins in minutes; back up build history and credentials separately", "f-small f-muted", fit=700)
write(ROOT, "jenkins", "casc", f,
      "A Dockerfile from Jenkins 2.580.2 LTS with a pinned plugins.txt, and a casc/jenkins.yaml file with users, security, executors and Job DSL jobs, together produce a Jenkins container with no setup wizard whose admin password comes from the environment variable ADMIN_PASSWORD. The REST API triggers builds with a crumb and gets 201. Configuration changes are made by editing the YAML, reviewing it and reloading. An identical Jenkins can be rebuilt in minutes; build history and credentials are backed up separately.",
      "Plugins in a Dockerfile, configuration in YAML: a Jenkins you can review, rebuild and throw away.")
