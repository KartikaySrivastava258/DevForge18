"""College handbook assistant: answers students' questions from the handbook, with checked citations.

Keep the two function names and what they return — the check imports them:

    load_chunks(folder) -> list of langchain_core.documents.Document
        Each Document holds one piece of one handbook section (at most 120 words) and the metadata
        {"source": "<file name, e.g. attendance.md>", "section": "<the ## heading, e.g. Minimum attendance>"}.

    answer(question, model) -> {"answer": str, "sources": [{"source": ..., "section": ...}, ...], "refused": bool}
        model is a LangChain chat model. In the check it is a scripted stand-in (see stand_ins.py); in a real
        deployment it would be a provider's model — your code must not care which.
"""
from pathlib import Path

from langchain_core.documents import Document  # noqa: F401  (you will need these)
from langchain_core.prompts import ChatPromptTemplate  # noqa: F401
from langchain_core.vectorstores import InMemoryVectorStore  # noqa: F401

from stand_ins import KeywordEmbedding  # noqa: F401  (the teaching embedding: do not replace it for the check)

HANDBOOK = Path(__file__).parent / "handbook"
REFUSAL = "I don't know — the handbook does not cover that. Please ask the student help desk."


def load_chunks(folder=HANDBOOK):
    """Split every handbook file into chunks that remember their file and section.

    TODO
    - A section starts at a "## " heading and runs to the next one. Skip the "# " title line.
    - Keep each chunk at most 120 words; split long sections between paragraphs or sentences, never inside one.
    - Give every chunk metadata {"source": file name, "section": heading text}.
    """
    raise NotImplementedError("load_chunks")


def answer(question, model):
    """Answer a student's question from the handbook, or refuse.

    TODO
    1. Retrieve the most similar chunks with scores from an InMemoryVectorStore that uses KeywordEmbedding.
       Keep only chunks above a relevance threshold.
    2. Nothing relevant? Return {"answer": REFUSAL, "sources": [], "refused": True} without calling the model.
    3. Otherwise send the chunks as numbered sources ([1], [2], …) with the question to the model, and ask for a
       citation at the end of every sentence.
    4. Check the reply: every sentence must cite, and every citation must be a source you sent. If not, refuse.
    5. Return the reply with its sources, in the order you numbered them.
    """
    raise NotImplementedError("answer")
