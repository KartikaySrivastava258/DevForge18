"""Figure for n8n-human-approval-steps; run: python3 scripts/figures/n8n/approval-steps.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Approval with a time limit and a four-eyes rule, from Human approval steps.")
f.box(10, 40, 130, 70, "f-box-faint"); f.text(75, 68, "Request", "f-small f-strong"); f.text(75, 90, "webhook", "f-small")
f.box(170, 40, 150, 70, "f-box-faint"); f.text(245, 66, "Answer requester", "f-small f-strong", fit=140); f.text(245, 90, "202 + resume URL", "f-small", fit=140)
f.box(350, 40, 170, 70, "f-box-accent"); f.text(435, 66, "Wait for decision", "f-small f-strong", fit=160); f.text(435, 90, "URL called or limit", "f-small", fit=160)
f.box(550, 40, 160, 70, "f-box-accent"); f.text(630, 66, "Decide", "f-small f-strong"); f.text(630, 90, "rules in code", "f-small")
f.arrow([(142, 75), (168, 75)]); f.arrow([(322, 75), (348, 75)]); f.arrow([(522, 75), (548, 75)])
for i, (t, cls) in enumerate([("approved / declined by someone else", "f-box-ok"), ("approver = requester → refused", "f-box-danger"), ("no answer in time → escalated", "f-box-danger")]):
    y = 140 + i * 44
    f.box(400, y, 310, 36, cls); f.text(555, y + 23, t, "f-small", fit=300)
f.arrow([(630, 112), (630, 138)])
f.box(10, 150, 340, 110, "f-box-faint"); f.text(180, 174, "while waiting", "f-small f-strong")
f.text(180, 198, "the execution is stored in n8n's database", "f-small", fit=330); f.text(180, 220, "→ survives a restart", "f-small", fit=330); f.text(180, 242, "(keep the database on a volume)", "f-small", fit=330)
write(ROOT, "n8n", "approval-steps", f,
      "A webhook receives the request; the next node answers the requester at once with 202 and the execution's resume URL; a Wait node pauses until the URL is called or its time limit runs out; a Decide step applies the rules in code. There are three endings: approved or declined by someone other than the requester; refused because the approver is the requester; or escalated because nobody answered in time. While waiting, the execution is stored in n8n's database, so it survives a restart as long as the database is kept on a volume.",
      "Wait with a limit, decide with rules in code, and keep waiting executions in a durable database.")
