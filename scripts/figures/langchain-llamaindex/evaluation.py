"""Figure for llm-evaluation-and-hallucination-checks; run: python3 scripts/figures/langchain-llamaindex/evaluation.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "What an evaluation measures, from Evaluation and hallucination checks.")
f.box(10, 40, 180, 110, "f-box-faint"); f.text(100, 64, "evaluation set", "f-small f-strong")
f.text(100, 88, "question + facts", "f-small"); f.text(100, 108, "+ expected source", "f-small"); f.text(100, 128, "+ unanswerable ones", "f-small")
f.box(230, 40, 150, 110, "f-box-accent"); f.text(305, 80, "system under", "f-small f-strong"); f.text(305, 100, "test", "f-small f-strong")
f.arrow([(192, 95), (228, 95)])
rows = [("correctness", "required facts present?"), ("faithfulness", "each sentence supported?"),
        ("abstention", "\"I don't know\" when right"), ("judge check", "agrees with human labels?")]
for i, (t, n) in enumerate(rows):
    y = 20 + i * 62
    f.box(430, y, 280, 50, "f-box-ok" if i < 3 else "f-box-faint"); f.text(570, y + 22, t, "f-small f-strong"); f.text(570, y + 40, n, "f-small", fit=270)
    f.arrow([(382, 95), (428, y + 25)])
f.box(10, 270, 700, 40, "f-box-danger"); f.text(360, 295, "exact match: 0 for correct answers in other words — not a useful score for generated text", "f-small", fit=690)
write(ROOT, "langchain-llamaindex", "evaluation", f,
      "An evaluation set of questions with required facts, expected sources and some unanswerable questions is run through the system under test. Its answers are scored for correctness (are the required facts present), faithfulness (is each sentence supported by its source), and abstention (does it say I don't know when it should); an automated judge is itself checked for agreement with human labels. Exact match scores correct answers phrased differently as 0, so it is not a useful score for generated text.",
      "Score facts, faithfulness and abstention — and check the judge before trusting it.")
