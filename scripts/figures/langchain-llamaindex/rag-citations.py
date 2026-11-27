"""Figure for langchain-rag-with-citations; run: python3 scripts/figures/langchain-llamaindex/rag-citations.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 320, "A RAG pipeline with checked citations, from A RAG pipeline with citations, in depth.")
f.box(10, 40, 130, 70, "f-box-faint"); f.text(75, 68, "question", "f-small f-strong"); f.text(75, 90, "user", "f-small")
f.box(170, 40, 150, 70, "f-box-accent"); f.text(245, 66, "retrieve", "f-small f-strong"); f.text(245, 88, "score ≥ 0.5 ?", "f-small f-mono")
f.box(350, 40, 170, 70, "f-box-accent"); f.text(435, 66, "prompt", "f-small f-strong"); f.text(435, 88, "[1] (src#sec) text", "f-small f-mono", fit=160)
f.box(550, 40, 160, 70, "f-box-faint"); f.text(630, 66, "model", "f-small f-strong"); f.text(630, 88, "answer with [n]", "f-small f-mono", fit=150)
f.arrow([(142, 75), (168, 75)]); f.arrow([(322, 75), (348, 75)]); f.arrow([(522, 75), (548, 75)])
f.box(170, 150, 150, 60, "f-box-danger"); f.text(245, 176, "nothing relevant", "f-small", fit=140); f.text(245, 196, "→ \"I don't know\"", "f-small", fit=140)
f.arrow([(245, 112), (245, 148)])
f.box(400, 150, 310, 90, "f-box-accent"); f.text(555, 174, "check citations", "f-small f-strong")
f.text(555, 196, "every sentence cites a source", "f-small", fit=300); f.text(555, 216, "every [n] was in the prompt", "f-small", fit=300)
f.arrow([(630, 112), (630, 148)])
f.box(400, 260, 150, 44, "f-box-ok"); f.text(475, 287, "answer + sources", "f-small", fit=140)
f.box(560, 260, 150, 44, "f-box-danger"); f.text(635, 287, "reject / retry", "f-small", fit=140)
f.arrow([(500, 242), (480, 258)]); f.arrow([(610, 242), (630, 258)])
write(ROOT, "langchain-llamaindex", "rag-citations", f,
      "A user's question goes to retrieval, which keeps only chunks scoring at least 0.5. If nothing is relevant, the pipeline answers I don't know without calling the model. Otherwise the prompt lists the chunks as numbered sources with their source and section, and the model answers with citations like [n]. A citation check requires every sentence to cite a source and every cited number to have been in the prompt. Passing answers are returned with their sources; failing ones are rejected or retried.",
      "Retrieve with a threshold, number the sources, and check every citation before showing an answer.")
