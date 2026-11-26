"""Figure for github-actions-oidc-cloud-access; run: python3 scripts/figures/github-actions/oidc.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 280, "Exchanging an OIDC token for temporary credentials, from OIDC — cloud access without long-lived secrets.")
f.box(10, 40, 200, 90, "f-box"); f.text(110, 64, "job (id-token: write)", "f-small f-strong", fit=190); f.text(110, 88, "environment: production", "f-small f-mono", fit=190); f.text(110, 110, "no stored secret", "f-small f-ok")
f.box(260, 20, 200, 90, "f-box-accent"); f.text(360, 44, "GitHub OIDC issuer", "f-small f-strong", fit=190); f.text(360, 68, "signed JWT, minutes", "f-small", fit=190); f.text(360, 90, "sub, aud, iss …", "f-small f-mono")
f.box(510, 40, 200, 110, "f-box-warn"); f.text(610, 64, "cloud (AWS STS)", "f-small f-strong", fit=190); f.text(610, 88, "1. verify signature", "f-small", fit=190); f.text(610, 108, "2. trust conditions:", "f-small", fit=190); f.text(610, 128, "aud and sub match?", "f-small", fit=190)
f.box(260, 170, 200, 70, "f-box-ok"); f.text(360, 194, "temporary credentials", "f-small f-strong", fit=190); f.text(360, 216, "expire on their own", "f-small", fit=190)
f.arrow([(212, 70), (258, 62)]); f.text(235, 52, "1", "f-small f-muted")
f.arrow([(212, 105), (508, 105)]); f.text(360, 128, "2  token + role-to-assume", "f-small f-muted", fit=280)
f.arrow([(610, 152), (462, 200)]); f.arrow([(258, 205), (110, 134)])
f.text(600, 262, "sub = repo:OWNER/REPO:environment:production", "f-small f-mono", fit=420)
write(ROOT, "github-actions", "oidc", f,
      "A job with id-token write permission and environment production, holding no stored secret, asks GitHub's OIDC issuer for a signed JWT that lasts minutes and carries claims such as sub, aud and iss. The job sends the token and the role to assume to the cloud, AWS STS, which first verifies the signature and then checks the trust conditions: do aud and sub match? If they do, it returns temporary credentials that expire on their own. The subject looks like repo:OWNER/REPO:environment:production.",
      "No stored key: each job proves who it is, and the cloud decides per job.")
