"""Architecture of Capstone G (campus automation); run: python3 scripts/figures/capstones/capstone-g-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 380, "Capstone G architecture: workflows with guard rails.")
f.box(20, 30, 150, 110, "f-box"); f.text(95, 58, "triggers", "f-small f-strong", fit=140); f.text(95, 80, "forms (webhooks),", "f-small", fit=140); f.text(95, 98, "schedules,", "f-small", fit=140); f.text(95, 116, "support e-mail", "f-small", fit=140)
f.box(220, 20, 260, 160, "f-box-accent"); f.text(350, 45, "n8n (self-hosted)", "f-small f-strong", fit=250)
f.text(350, 70, "validate → deduplicate → act", "f-small", fit=250); f.text(350, 92, "error workflow, retries", "f-small", fit=250)
f.text(350, 114, "human approval (Wait)", "f-small", fit=250); f.text(350, 136, "credentials referenced,", "f-small", fit=250); f.text(350, 156, "never embedded", "f-small", fit=250)
f.arrow([(172, 85), (218, 85)])
f.box(530, 20, 210, 70, "f-box-ok"); f.text(635, 48, "PostgreSQL", "f-small f-strong", fit=200); f.text(635, 68, "records, audit trail", "f-small", fit=200)
f.box(530, 110, 210, 70, "f-box-ok"); f.text(635, 138, "Redis", "f-small f-strong", fit=200); f.text(635, 158, "idempotency keys, limits", "f-small", fit=200)
f.arrow([(482, 60), (528, 55)]); f.arrow([(482, 130), (528, 145)])
f.box(220, 220, 260, 60, "f-box"); f.text(350, 245, "external APIs: e-mail, calendar,", "f-small", fit=250); f.text(350, 263, "ticketing, an LLM classifier", "f-small", fit=250)
f.arrow([(350, 182), (350, 218)])
f.box(20, 300, 340, 66, "f-box"); f.text(190, 326, "Postman collections test every API", "f-small", fit=330); f.text(190, 346, "the workflows call, and the webhooks", "f-small", fit=330)
f.box(400, 300, 340, 66, "f-box"); f.text(570, 326, "OpenTelemetry + Docker Compose:", "f-small", fit=330); f.text(570, 346, "traced, reproducible, self-hosted", "f-small", fit=330)
write(ROOT, "capstones", "capstone-g-architecture", f,
      "Triggers — form webhooks, schedules and support e-mail — start workflows in a self-hosted n8n, which validates, deduplicates and then acts, with an error workflow, retries, human approval through Wait nodes, and credentials referenced rather than embedded. n8n stores records and an audit trail in PostgreSQL and idempotency keys and rate limits in Redis, and calls external APIs: e-mail, calendar, ticketing and an LLM classifier. Below: Postman collections test every API the workflows call and the webhooks themselves; OpenTelemetry and Docker Compose make the stack traced, reproducible and self-hosted.",
      "Automations validate before they act, never act twice, ask a person before anything risky, and leave an audit trail.")
