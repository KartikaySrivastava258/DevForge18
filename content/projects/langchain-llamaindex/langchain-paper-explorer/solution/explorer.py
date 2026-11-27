"""Research-paper explorer: semantic search over the department's papers, with metadata filters and an evaluation."""
import json
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.vectorstores import InMemoryVectorStore

from stand_ins import KeywordEmbedding

HERE = Path(__file__).parent
MIN_SCORE = 0.5   # cosine similarity below which a paper is not relevant (chosen by printing scores, see README)


def load_papers(path=HERE / "papers.json"):
    """One Document per paper. The text that is embedded is the title and the abstract: titles alone are too
    short for a keyword embedding, so many questions would share no word with them."""
    papers = json.loads(Path(path).read_text(encoding="utf-8"))["papers"]
    return [Document(f"{p['title']}. {p['abstract']}", id=p["id"],
                     metadata={"paper_id": p["id"], "title": p["title"], "year": int(p["year"]), "authors": list(p["authors"])})
            for p in papers]


_store = None


def _get_store():
    global _store
    if _store is None:
        _store = InMemoryVectorStore(KeywordEmbedding())
        _store.add_documents(load_papers())
    return _store


def search(query, k=3, year_from=None, year_to=None, author=None):
    """The k most relevant papers that match the filters, best first.

    The filter is passed to the vector store, so papers that do not match are removed *before* ranking. Filtering
    the top k afterwards would return fewer than k papers (often none) whenever older or other authors' papers
    happen to rank higher.
    """
    if not isinstance(k, int) or k < 1:
        raise ValueError("k must be a positive whole number")
    if year_from is not None and year_to is not None and year_from > year_to:
        raise ValueError(f"year_from ({year_from}) is after year_to ({year_to})")
    wanted_author = author.strip().casefold() if author else None

    def matches(doc):
        m = doc.metadata
        return ((year_from is None or m["year"] >= year_from)
                and (year_to is None or m["year"] <= year_to)
                and (wanted_author is None or wanted_author in (a.casefold() for a in m["authors"])))

    hits = _get_store().similarity_search_with_score(query, k=k, filter=matches)
    return [{"paper_id": d.metadata["paper_id"], "title": d.metadata["title"], "year": d.metadata["year"],
             "authors": d.metadata["authors"], "score": round(float(s), 3)}
            for d, s in hits if s >= MIN_SCORE]


def evaluate(cases, k=3):
    """Hit rate at k: the share of cases whose expected paper is among the first k results.

    Each case is {"question": ..., "expected": paper id, optional "year_from"/"year_to"/"author"}.
    """
    misses = []
    for case in cases:
        filters = {f: case[f] for f in ("year_from", "year_to", "author") if f in case}
        found = [r["paper_id"] for r in search(case["question"], k=k, **filters)]
        if case["expected"] not in found:
            misses.append({"question": case["question"], "expected": case["expected"], "found": found})
    total = len(cases)
    hits = total - len(misses)
    return {"hits": hits, "total": total, "hit_rate": hits / total if total else 0.0, "misses": misses}


if __name__ == "__main__":
    cases = json.loads((HERE / "eval_set.json").read_text(encoding="utf-8"))
    report = evaluate(cases)
    print(f"hit rate at 3: {report['hits']}/{report['total']} = {report['hit_rate']:.2f}")
    for miss in report["misses"]:
        print(f"  missed {miss['expected']} for {miss['question']!r}; found {miss['found']}")
