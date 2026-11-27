"""Figure for langchain-tool-calling-and-agents; run: python3 scripts/figures/langchain-llamaindex/agent-loop.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "The agent loop and its guards, from Tool calling and agents, safely.")
f.box(10, 110, 150, 80, "f-box-faint"); f.text(85, 140, "model", "f-small f-strong"); f.text(85, 164, "text or tool_calls", "f-small", fit=140)
f.box(220, 20, 280, 280, "f-box-accent"); f.text(360, 44, "your loop (runs every tool)", "f-small f-strong", fit=270)
for i, (title, note, cls) in enumerate([("allowlist", "tool offered to this agent?", "f-box-faint"),
                                         ("validate", "arguments match the schema?", "f-box-faint"),
                                         ("approve", "high impact → a person decides", "f-box-faint"),
                                         ("step limit", "stop after N turns", "f-box-faint")]):
    y = 60 + i * 58
    f.box(235, y, 250, 48, cls); f.text(360, y + 20, title, "f-small f-strong"); f.text(360, y + 38, note, "f-small", fit=240)
f.box(560, 60, 150, 80, "f-box-ok"); f.text(635, 92, "tools", "f-small f-strong"); f.text(635, 114, "get_order, refund", "f-small f-mono", fit=140)
f.box(560, 180, 150, 80, "f-box-faint"); f.text(635, 212, "audit log", "f-small f-strong"); f.text(635, 234, "asked · ran · refused", "f-small", fit=140)
f.arrow([(162, 140), (218, 140)]); f.arrow([(218, 170), (162, 170)])
f.text(190, 128, "call", "f-small"); f.text(190, 186, "result", "f-small")
f.arrow([(502, 100), (558, 100)]); f.arrow([(502, 220), (558, 220)])
write(ROOT, "langchain-llamaindex", "agent-loop", f,
      "The model replies with text or with tool calls. Your loop, which runs every tool, checks each call in turn: is the tool on this agent's allowlist, do the arguments match its schema, does a high-impact action need a person's approval, and has the step limit been reached. Allowed calls run the tools, here get_order and refund, and the result goes back to the model. Every request, run and refusal is written to an audit log.",
      "The model only asks; your loop checks, runs, records — and stops.")
