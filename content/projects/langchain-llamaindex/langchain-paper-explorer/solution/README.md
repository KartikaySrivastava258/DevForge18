# Research-paper explorer

The department's research office gets the same requests every week: "anything on crop disease since 2023?",
"which papers has R. Menon written about images?". The papers' titles, authors, years and abstracts are in
`papers.json` (14 fictional papers). Build a semantic search with metadata filters — and an evaluation that
shows, with a number, how often it finds the right paper.

## What to build (in `explorer.py`)

1. `load_papers()` — one LangChain `Document` per paper, with `paper_id`, `title`, `year` (a number) and `authors`
   (a list) as metadata. You decide which text is embedded.
2. `search(query, k=3, year_from=None, year_to=None, author=None)` — the best papers first, as dicts with
   `paper_id`, `title`, `year`, `authors` and `score`:
   - the year filters are inclusive, and the author filter matches any of a paper's authors, ignoring capitals;
   - the filters must not make the search miss papers that match them (try `k=2, year_from=2024` on a question
     about images, and look at what the unfiltered search returns);
   - a question about no paper returns `[]` (choose a minimum score by printing scores);
   - `year_from` after `year_to`, or `k` below 1, raises `ValueError`.
3. `evaluate(cases, k=3)` — the hit rate at k: the share of cases whose `expected` paper is among the first k
   results, using each case's filters, plus the list of misses.
4. `eval_set.json` — at least 8 questions of your own, covering at least 6 papers, at least 2 with a filter.
   Write them as a user would ask, not by copying titles. Your hit rate must be at least 0.80 — on your set
   **and** on 12 questions the check keeps to itself.

## Rules

- `stand_ins.py` is a labelled teaching stand-in (the keyword embedding). Do not change it. The check runs your
  code with the network switched off.
- `requirements.txt` may only list `langchain-core==1.8.4`, `numpy==2.5.5` and `llama-index-core==0.14.26`.

## Try it

```bash
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" sh -c "pip install -q -r requirements.txt && python explorer.py"
bash check.sh .
```
