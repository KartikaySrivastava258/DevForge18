"""Figure for github-actions-environments-and-deployments; run: python3 scripts/figures/github-actions/environments.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Build once, promote the digest, from Environments, approvals and deployments.")
f.box(10, 90, 140, 70, "f-box"); f.text(80, 116, "build", "f-small f-strong"); f.text(80, 138, "output: digest", "f-small", fit=130)
f.box(200, 80, 200, 90, "f-box-accent"); f.text(300, 104, "environment staging", "f-small f-strong", fit=190); f.text(300, 126, "vars, secrets", "f-small"); f.text(300, 148, "deploy the digest", "f-small")
f.box(450, 60, 260, 130, "f-box-warn"); f.text(580, 84, "environment production", "f-small f-strong", fit=250); f.text(580, 108, "required reviewers, wait timer", "f-small", fit=250); f.text(580, 130, "branches: main", "f-small f-mono"); f.text(580, 152, "secrets after approval", "f-small", fit=250); f.text(580, 174, "same digest as staging", "f-small f-ok", fit=250)
f.arrow([(152, 125), (198, 125)]); f.arrow([(402, 125), (448, 125)])
f.text(580, 222, "rollback: redeploy a previous digest", "f-small f-muted", fit=300)
f.text(300, 222, "concurrency: one deploy at a time", "f-small f-muted", fit=240)
write(ROOT, "github-actions", "environments", f,
      "A build job outputs an image digest. The staging environment, with its own variables and secrets, deploys that digest. The production environment has required reviewers, a wait timer and a deployment branch rule allowing main; its secrets are released only after approval, and it deploys the same digest that staging ran. Each environment allows one deployment at a time through concurrency, and a rollback redeploys a previous digest.",
      "One artefact moves through environments; each environment guards its own secrets.")
