"""Figure for llm-prompt-injection-and-permissions; run: python3 scripts/figures/langchain-llamaindex/injection-and-permissions.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 330, "Where injected instructions and restricted data meet, from Prompt injection and data permissions.")
f.box(10, 30, 210, 140, "f-box-faint"); f.text(115, 54, "knowledge base", "f-small f-strong")
f.text(115, 80, "handbook (staff)", "f-small f-mono"); f.box(25, 92, 180, 26, "f-box-danger"); f.text(115, 110, "vendor FAQ + injection", "f-small", fit=170)
f.text(115, 138, "payroll (hr only)", "f-small f-mono"); f.text(115, 160, "it.md (staff)", "f-small f-mono")
f.box(270, 30, 190, 140, "f-box-accent"); f.text(365, 56, "retrieval", "f-small f-strong")
f.text(365, 84, "filter by the", "f-small"); f.text(365, 104, "user's groups", "f-small"); f.text(365, 132, "audience ∈ groups", "f-small f-mono", fit=180)
f.arrow([(222, 100), (268, 100)])
f.box(510, 30, 200, 140, "f-box-faint"); f.text(610, 56, "prompt → model", "f-small f-strong")
f.text(610, 84, "may obey injected", "f-small"); f.text(610, 104, "text — cannot leak", "f-small"); f.text(610, 124, "what is not there", "f-small")
f.arrow([(462, 100), (508, 100)])
f.box(10, 210, 700, 100, "f-box-ok"); f.text(360, 234, "defence in depth (signals, not locks)", "f-small f-strong")
f.text(360, 258, "mark retrieved text as untrusted · flag instruction-like passages", "f-small", fit=680)
f.text(360, 280, "check answers for data that must never appear · least-privilege tools", "f-small", fit=680)
write(ROOT, "langchain-llamaindex", "injection-and-permissions", f,
      "The knowledge base holds a staff handbook, a vendor FAQ carrying an injected instruction, an HR-only payroll file and an IT page. Retrieval filters documents by the user's groups, so only documents whose audience is in the user's groups can reach the prompt. The model may obey injected text, but it cannot leak what is not there. Below, defence in depth adds signals rather than locks: marking retrieved text as untrusted, flagging instruction-like passages, checking answers for data that must never appear, and least-privilege tools.",
      "Keep restricted data out of the prompt with permission filters; other defences only reduce risk.")
