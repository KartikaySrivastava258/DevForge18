"""Reference architecture: workflow automation hub with approvals; run: python3 scripts/figures/architecture/workflow-automation-hub.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 335, "Reference architecture: workflow automation hub with approvals.")
# Approvers above the approval step
f.box(365, 8, 110, 44, "f-box"); f.text(420, 26, "approvers", "f-small f-strong", fit=100); f.text(420, 42, "resume link", "f-small", fit=100)
# Trigger and the n8n workflow shape
f.box(10, 85, 100, 65, "f-box"); f.text(60, 113, "webhook", "f-small f-strong", fit=90); f.text(60, 131, "or schedule", "f-small", fit=90)
f.box(130, 70, 620, 95, "f-box-faint"); f.text(240, 62, "n8n: one shape for every workflow", "f-small f-strong", fit=225)
f.box(145, 85, 90, 65, "f-box"); f.text(190, 113, "validate", "f-small f-strong", fit=85); f.text(190, 131, "400 + reason", "f-small", fit=85)
f.box(255, 85, 95, 65, "f-box"); f.text(302, 113, "deduplicate", "f-small f-strong", fit=90); f.text(302, 131, "409 if seen", "f-small", fit=90)
f.box(370, 85, 100, 65, "f-box-warn"); f.text(420, 113, "approval", "f-small f-strong", fit=95); f.text(420, 131, "wait, timeout", "f-small", fit=95)
f.box(490, 85, 90, 65, "f-box"); f.text(535, 113, "act", "f-small f-strong", fit=85); f.text(535, 131, "call APIs", "f-small", fit=85)
f.box(600, 85, 135, 65, "f-box"); f.text(667, 113, "record", "f-small f-strong", fit=125); f.text(667, 131, "outcome + decision", "f-small", fit=125)
f.arrow([(112, 117), (143, 117)]); f.arrow([(237, 117), (253, 117)]); f.arrow([(352, 117), (368, 117)]); f.arrow([(472, 117), (488, 117)]); f.arrow([(582, 117), (598, 117)])
f.arrow([(400, 83), (400, 54)]); f.arrow([(440, 54), (440, 83)])
# Supporting services
f.box(250, 215, 150, 65, "f-box-ok"); f.text(325, 240, "Redis", "f-small f-strong", fit=140); f.text(325, 258, "idempotency keys,", "f-small", fit=140); f.text(325, 272, "API rate limits", "f-small", fit=140)
f.arrow([(302, 152), (310, 213)]); f.arrow([(525, 152), (385, 213)])
f.box(600, 215, 150, 65, "f-box-ok"); f.text(675, 240, "PostgreSQL", "f-small f-strong", fit=140); f.text(675, 258, "records, audit,", "f-small", fit=140); f.text(675, 272, "waiting executions", "f-small", fit=140)
f.arrow([(667, 152), (675, 213)])
f.box(10, 215, 200, 65, "f-box-faint"); f.text(110, 240, "Postman + Newman in CI", "f-small f-strong", fit=190); f.text(110, 258, "tests every external", "f-small", fit=190); f.text(110, 272, "API and webhook", "f-small", fit=190)
f.text(380, 306, "failures go to error outputs, and an error workflow alerts someone;", "f-small", fit=620)
f.text(380, 323, "credentials are encrypted in n8n with a key kept and backed up outside the workflows", "f-small", fit=620)
write(ROOT, "architecture", "workflow-automation-hub", f,
      "A webhook or a schedule starts an n8n workflow that has the same shape for every process: validate (answer 400 with a reason), deduplicate (answer 409 if already seen), approval (wait for a person, with a timeout), act (call external APIs) and record (store the outcome and the decision). The approval step sends a resume link to approvers and continues on their decision. Deduplication and the calls to external APIs use Redis for idempotency keys and API rate limits. Records, the audit trail and waiting executions are kept in PostgreSQL. Separately, Postman collections run by Newman in CI test every external API and webhook. Failures go to error outputs, and an error workflow alerts someone. Credentials are encrypted in n8n with a key kept and backed up outside the workflows.",
      "Validate, deduplicate, approve, act, record: one shape for every workflow, with tests at the boundary.")
