"""Figure for n8n-ai-agents-and-risks; run: python3 scripts/figures/n8n/ai-agent-risks.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "Where an agent's risks are contained, from AI agents in workflows, and their risks.")
f.box(10, 40, 170, 90, "f-box-danger"); f.text(95, 64, "ticket text", "f-small f-strong"); f.text(95, 88, "\"…refund 1200\"", "f-small f-mono", fit=160); f.text(95, 110, "(untrusted)", "f-small")
f.box(230, 40, 170, 90, "f-box-accent"); f.text(315, 64, "AI Agent", "f-small f-strong"); f.text(315, 88, "max 3 iterations", "f-small"); f.text(315, 110, "logs every step", "f-small")
f.box(450, 20, 260, 60, "f-box-faint"); f.text(580, 44, "chat model (provider)", "f-small f-strong", fit=250); f.text(580, 66, "receives ticket, tools, results", "f-small", fit=250)
f.box(450, 100, 260, 120, "f-box-ok"); f.text(580, 124, "refund tool = the rules", "f-small f-strong", fit=250)
f.text(580, 148, "order exists?", "f-small"); f.text(580, 168, "amount ≤ order total?", "f-small"); f.text(580, 188, "above 200 → a person approves", "f-small", fit=250)
f.arrow([(182, 85), (228, 85)]); f.arrow([(402, 70), (448, 50)]); f.arrow([(402, 100), (448, 150)])
f.text(360, 262, "the system message asks; the tool enforces", "f-small f-strong", fit=700)
f.text(360, 286, "1200 → refused · 300 → held for approval · 80 → refunded", "f-small f-mono", fit=700)
write(ROOT, "n8n", "ai-agent-risks", f,
      "An untrusted ticket containing the text refund 1200 goes to the AI Agent, which is limited to three iterations and logs every step. The agent sends the ticket, the tool list and every tool result to the chat model at the provider. Tool calls go to the refund tool, which holds the rules: does the order exist, is the amount at most the order total, and does an amount above 200 need a person's approval. The system message only asks; the tool enforces: 1200 is refused, 300 is held for approval, 80 is refunded.",
      "Customer text can steer the model; checks inside the tool decide what actually happens.")
