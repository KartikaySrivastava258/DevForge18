"""Architecture of Capstone C (knowledge assistant); run: python3 scripts/figures/capstones/capstone-c-architecture.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 400, "Capstone C architecture: retrieval with citations, guarded tools, measured quality.")
f.box(20, 30, 150, 70, "f-box"); f.text(95, 60, "college documents", "f-small f-strong", fit=140); f.text(95, 80, "handbook, notices", "f-small", fit=140)
f.box(220, 30, 150, 70, "f-box-accent"); f.text(295, 60, "ingestion job", "f-small f-strong", fit=140); f.text(295, 80, "chunk, embed, label", "f-small", fit=140)
f.arrow([(172, 65), (218, 65)])
f.box(420, 20, 160, 90, "f-box-ok"); f.text(500, 50, "PostgreSQL", "f-small f-strong", fit=150); f.text(500, 70, "chunks, metadata,", "f-small", fit=150); f.text(500, 88, "access rules", "f-small", fit=150)
f.arrow([(372, 65), (418, 65)])
f.box(20, 180, 120, 60, "f-box"); f.text(80, 215, "students", "f-small", fit=110)
f.box(190, 165, 190, 90, "f-box-accent"); f.text(285, 195, "assistant API", "f-small f-strong", fit=180); f.text(285, 215, "retrieve, cite, refuse", "f-small", fit=180); f.text(285, 233, "allow-listed tools", "f-small", fit=180)
f.arrow([(142, 210), (188, 210)])
f.arrow([(330, 163), (450, 112)])
f.box(430, 180, 150, 60, "f-box-ok"); f.text(505, 207, "Redis", "f-small f-strong", fit=140); f.text(505, 225, "answer cache, limits", "f-small", fit=140)
f.arrow([(382, 210), (428, 210)])
f.box(620, 160, 120, 100, "f-box-warn"); f.text(680, 190, "language", "f-small f-strong", fit=110); f.text(680, 208, "model", "f-small f-strong", fit=110); f.text(680, 230, "(behind an", "f-small", fit=110); f.text(680, 246, "interface)", "f-small", fit=110)
f.arrow([(582, 225), (618, 225)])
f.box(20, 300, 350, 80, "f-box"); f.text(195, 328, "evaluation set in Git: questions,", "f-small", fit=340); f.text(195, 346, "expected sources, injection cases;", "f-small", fit=340); f.text(195, 364, "run in CI as a release gate", "f-small", fit=340)
f.box(400, 300, 340, 80, "f-box"); f.text(570, 328, "OpenTelemetry: one trace per question —", "f-small", fit=330); f.text(570, 346, "retrieval, model call, tool calls,", "f-small", fit=330); f.text(570, 364, "latency and token cost", "f-small", fit=330)
write(ROOT, "capstones", "capstone-c-architecture", f,
      "College documents are chunked, embedded and labelled by an ingestion job and stored with metadata and access rules in PostgreSQL. Students ask the assistant API, which retrieves chunks, answers with citations or refuses, and may call allow-listed tools. It uses Redis for an answer cache and rate limits and calls a language model through an interface. Below: an evaluation set in Git with questions, expected sources and injection cases, run in CI as a release gate; and OpenTelemetry tracing each question through retrieval, the model call and tool calls with latency and cost.",
      "Every answer cites its sources or refuses; every release must pass the evaluation set.")
