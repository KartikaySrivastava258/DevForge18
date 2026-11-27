"""Reference architecture: retrieval-augmented assistant with citations; run: python3 scripts/figures/architecture/rag-assistant.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(760, 340, "Reference architecture: retrieval-augmented assistant with citations.")
# Indexing path (top)
f.box(10, 30, 125, 55, "f-box"); f.text(72, 54, "documents", "f-small f-strong", fit=115); f.text(72, 72, "handbook, notices", "f-small", fit=115)
f.box(150, 25, 150, 65, "f-box"); f.text(225, 50, "indexing pipeline", "f-small f-strong", fit=140); f.text(225, 68, "chunks + metadata,", "f-small", fit=140); f.text(225, 82, "embed once", "f-small", fit=140)
f.arrow([(137, 57), (148, 57)])
f.box(340, 20, 170, 75, "f-box-ok"); f.text(425, 46, "PostgreSQL + pgvector", "f-small f-strong", fit=160); f.text(425, 66, "chunks, audience,", "f-small", fit=160); f.text(425, 82, "vectors", "f-small", fit=160)
f.arrow([(302, 57), (338, 57)])
# Question path (bottom)
f.box(10, 190, 90, 50, "f-box"); f.text(55, 220, "user", "f-small", fit=80)
f.box(130, 180, 120, 65, "f-box-ok"); f.text(190, 205, "Redis", "f-small f-strong", fit=110); f.text(190, 223, "rate limit,", "f-small", fit=110); f.text(190, 237, "answer cache", "f-small", fit=110)
f.arrow([(102, 215), (128, 212)])
f.box(290, 175, 150, 80, "f-box-accent"); f.text(365, 203, "retrieve", "f-small f-strong", fit=140); f.text(365, 221, "audience filter,", "f-small", fit=140); f.text(365, 237, "score threshold", "f-small", fit=140)
f.arrow([(252, 212), (288, 212)])
f.arrow([(390, 173), (420, 97)])
f.text(290, 140, "nothing relevant: refuse", "f-small f-muted", fit=170)
f.box(478, 180, 122, 65, "f-box"); f.text(539, 205, "language model", "f-small f-strong", fit=115); f.text(539, 223, "numbered", "f-small", fit=115); f.text(539, 237, "sources as data", "f-small", fit=115)
f.arrow([(442, 212), (476, 212)])
f.box(625, 175, 125, 75, "f-box-warn"); f.text(687, 203, "check citations", "f-small f-strong", fit=120); f.text(687, 221, "each [n] was", "f-small", fit=120); f.text(687, 237, "really sent", "f-small", fit=120)
f.arrow([(602, 212), (623, 212)])
f.arrow([(687, 252), (687, 282), (55, 282), (55, 242)])
f.text(380, 276, "answer + sources", "f-small f-muted", fit=150)
f.text(380, 310, "OpenTelemetry traces each question through cache, retrieval, model and checks;", "f-small", fit=600)
f.text(380, 327, "an evaluation set (correctness, faithfulness, abstention) gates every change", "f-small", fit=600)
write(ROOT, "architecture", "rag-assistant", f,
      "Indexing path: documents such as the handbook and notices go through an indexing pipeline that splits them into chunks with metadata and embeds each chunk once, into PostgreSQL with pgvector, which stores chunks, audience labels and vectors. Question path: a user's question passes Redis, which applies a rate limit and may return a cached answer, then a retrieval step that searches PostgreSQL only among chunks the user may see and applies a score threshold, refusing when nothing is relevant. Retrieved passages go to the language model as numbered sources marked as data, and a check confirms that every citation in the answer refers to a source that was really sent. The answer returns to the user with its sources. OpenTelemetry traces each question through cache, retrieval, model and checks, and an evaluation set of correctness, faithfulness and abstention gates every change.",
      "Retrieval decides what the model may see; checks decide what the user receives.")
