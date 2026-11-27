"""College handbook assistant: answers students' questions from the handbook, with checked citations."""
import re
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.vectorstores import InMemoryVectorStore

from stand_ins import KeywordEmbedding

HANDBOOK = Path(__file__).parent / "handbook"
MAX_WORDS = 120     # longest chunk, in words: one idea per chunk keeps prompts short and citations precise
MIN_SCORE = 0.5     # below this a chunk is only "closest", not relevant (cosine similarity, 1 = same direction)
K = 3               # chunks given to the model per question
REFUSAL = "I don't know — the handbook does not cover that. Please ask the student help desk."
UNCHECKED = "I could not give an answer in which every sentence is backed by the handbook. Please ask the student help desk."

PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You answer students' questions using only the numbered handbook sources below. "
               "End every sentence with the number of the source it comes from, like [1]. "
               "If the sources do not contain the answer, say you do not know.\n\n{sources}"),
    ("human", "{question}"),
])


def _split_section(text, max_words=MAX_WORDS):
    """Split a section into chunks of whole paragraphs (whole sentences for a very long paragraph)."""
    pieces = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        paragraph = " ".join(paragraph.split())
        if len(paragraph.split()) <= max_words:
            pieces.append(paragraph)
        else:
            pieces += re.split(r"(?<=[.!?])\s+", paragraph)
    chunks, current = [], []
    for piece in pieces:
        if current and len(" ".join(current + [piece]).split()) > max_words:
            chunks.append(" ".join(current))
            current = []
        current.append(piece)
    if current:
        chunks.append(" ".join(current))
    return chunks


def load_chunks(folder=HANDBOOK):
    """Every handbook section as one or more Documents that remember their file and section heading."""
    chunks = []
    for path in sorted(Path(folder).glob("*.md")):
        # "## Heading" starts a section; the text up to the next "## " belongs to it. The "# Title" line is skipped.
        for match in re.finditer(r"^## +(.+?)\s*\n(.*?)(?=^## |\Z)", path.read_text(encoding="utf-8"), re.M | re.S):
            section, body = match.group(1).strip(), match.group(2)
            for n, text in enumerate(_split_section(body), 1):
                chunks.append(Document(text, metadata={"source": path.name, "section": section},
                                       id=f"{path.stem}/{section}/{n}"))
    return chunks


_store = None


def _get_store():
    global _store
    if _store is None:
        _store = InMemoryVectorStore(KeywordEmbedding())
        _store.add_documents(load_chunks())
    return _store


def retrieve(question, k=K):
    """The k most similar chunks with their scores, keeping only those that pass MIN_SCORE."""
    hits = _get_store().similarity_search_with_score(question, k=k)
    return [(doc, score) for doc, score in hits if score >= MIN_SCORE]


def format_sources(hits):
    return "\n".join(f"[{i}] ({d.metadata['source']} — {d.metadata['section']}) {d.page_content}"
                     for i, (d, _) in enumerate(hits, 1))


def citation_problems(reply, n_sources):
    """Every sentence needs a citation, and every citation must be one of the sources in the prompt."""
    problems = []
    for sentence in [s for s in re.split(r"(?<=[.!?])\s+", reply.strip()) if s]:
        cited = [int(n) for n in re.findall(r"\[(\d+)\]", sentence)]
        if not cited:
            problems.append(f"no citation: {sentence!r}")
        problems += [f"cites [{n}], which was not given" for n in cited if not 1 <= n <= n_sources]
    return problems


def answer(question, model):
    """Answer from the handbook: {"answer": str, "sources": [{"source", "section"}], "refused": bool}."""
    hits = retrieve(question)
    if not hits:   # nothing relevant: refuse without spending a model call
        return {"answer": REFUSAL, "sources": [], "refused": True}
    reply = model.invoke(PROMPT.invoke({"sources": format_sources(hits), "question": question})).content
    if not reply.strip() or citation_problems(reply, len(hits)):
        # An uncited sentence or an invented source number cannot be checked by the student: do not show it.
        return {"answer": UNCHECKED, "sources": [], "refused": True}
    return {"answer": reply, "refused": False,
            "sources": [{"source": d.metadata["source"], "section": d.metadata["section"]} for d, _ in hits]}
