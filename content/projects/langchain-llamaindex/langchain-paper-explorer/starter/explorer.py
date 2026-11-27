"""Research-paper explorer: semantic search over the department's papers, with metadata filters and an evaluation.

Keep these names and return values — the check imports them:

    load_papers(path) -> list of Document, one per paper in papers.json, with the metadata
        {"paper_id": "p01", "title": ..., "year": 2019 (an int), "authors": ["A. Kulkarni", ...]}

    search(query, k=3, year_from=None, year_to=None, author=None) -> list of dicts, best first:
        {"paper_id", "title", "year", "authors", "score"}
        - year_from / year_to are inclusive; author matches one of the authors, ignoring capitals;
        - at most k results, and only results above a minimum score (a question about no paper gives []);
        - year_from after year_to, or k below 1, raises ValueError.

    evaluate(cases, k=3) -> {"hits": int, "total": int, "hit_rate": float, "misses": [...]}
        Each case is {"question": ..., "expected": "<paper id>"} plus optional "year_from", "year_to", "author".
        A hit means the expected paper is among the first k results of search() with the case's filters.
"""
import json  # noqa: F401
from pathlib import Path

from langchain_core.documents import Document  # noqa: F401
from langchain_core.vectorstores import InMemoryVectorStore  # noqa: F401

from stand_ins import KeywordEmbedding  # noqa: F401  (the teaching embedding: do not replace it for the check)

HERE = Path(__file__).parent


def load_papers(path=HERE / "papers.json"):
    """TODO: one Document per paper. Decide which text to embed — and test that decision with evaluate()."""
    raise NotImplementedError("load_papers")


def search(query, k=3, year_from=None, year_to=None, author=None):
    """TODO: rank the papers that match the filters. Where you apply the filter matters — think about what
    happens when the k best papers overall are all older than year_from."""
    raise NotImplementedError("search")


def evaluate(cases, k=3):
    """TODO: hit rate at k over the cases, with the questions that missed."""
    raise NotImplementedError("evaluate")


if __name__ == "__main__":
    cases = json.loads((HERE / "eval_set.json").read_text(encoding="utf-8"))
    report = evaluate(cases)
    print(f"hit rate at 3: {report['hits']}/{report['total']} = {report['hit_rate']:.2f}")
    for miss in report["misses"]:
        print("  missed:", miss)
