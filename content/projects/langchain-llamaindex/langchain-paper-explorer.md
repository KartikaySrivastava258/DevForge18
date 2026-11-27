---
id: langchain-paper-explorer
track: langchain-llamaindex
title: Research-paper explorer
level: intermediate
estimated_hours: 7
prerequisites: [langchain-embeddings-and-similarity, llamaindex-chunking-and-retrieval, llm-evaluation-and-hallucination-checks, llm-prompt-injection-and-permissions]
related_tracks: [postgresql]
user_stories:
  - As a research officer, I want to search the department's papers by meaning so that I find relevant work even when it does not use my exact words.
  - As a research officer, I want to limit a search to a range of years or to one author so that I can answer "anything on crop disease since 2023?" in one step.
  - As a developer, I want an evaluation set with a measured hit rate so that I know — with a number — whether a change made search better or worse.
acceptance_criteria:
  - load_papers() returns one document per paper with paper_id, title, year (a number) and authors (a list) as metadata.
  - search() without filters returns at most k papers as dicts (paper_id, title, year, authors, score), best first.
  - The year filters (inclusive) and the author filter (any author, ignoring capitals) are applied before ranking, so k=2 with year_from=2024 still finds the two 2024–2025 papers about images.
  - Impossible filters (year_from after year_to, k below 1) raise ValueError, and a question about no paper returns an empty list.
  - evaluate() reports the true hit rate at k=3, applies each case's filters, and lists the misses.
  - eval_set.json has at least 8 cases covering 6 papers, 2 of them with a filter, and the measured hit rate on it is at least 0.80.
  - The hit rate at k=3 on the check's own 12 questions is at least 0.80.
rubric:
  - { criterion: "Retrieval design", excellent: "The embedded text, k and the minimum score are each chosen by an experiment recorded in the README (for example the hit rate with titles only versus titles and abstracts).", good: "Search finds the right paper for typical questions.", needs_work: "Settings chosen by feel; no idea how often search fails." }
  - { criterion: "Filters", excellent: "Filters run inside the vector store before ranking, inputs are validated with clear errors, and the README explains why filtering the top k afterwards loses results.", good: "Filters work for the documented cases.", needs_work: "Filters applied after ranking, or unvalidated input that fails deep inside the code." }
  - { criterion: "Evaluation", excellent: "Questions written as users would ask them (not copied titles), including filtered and hard cases; misses are analysed, and the set is run after every change like a test suite.", good: "A working evaluation with enough cases.", needs_work: "A handful of questions that copy the titles, or a hit rate computed by hand." }
  - { criterion: "Honesty about limits", excellent: "The README says what the keyword stand-in cannot do, which questions fail and why, and what would change with a real embedding model.", good: "Known misses are listed.", needs_work: "A high hit rate presented as proof that search is good." }
hints:
  - Print the scores of a few questions before choosing the minimum score — in-scope and out-of-scope — as in "A RAG pipeline with citations, in depth".
  - InMemoryVectorStore's similarity_search_with_score takes filter=, a function that receives each Document and returns True to keep it. The prompt-injection lesson uses it to filter by audience before ranking.
  - Try search("detecting objects in camera images", k=2) without filters and look at the years. Then think about what filtering those two results for year_from=2024 would leave.
  - Compute the hit rate in evaluate() from search() itself — never from a second, slightly different code path — or the number will not describe the system users get.
stretch_goals:
  - Add a second metric, the mean reciprocal rank, and see whether it tells you something the hit rate does not.
  - Store the papers in PostgreSQL with pgvector and do the year and author filters in SQL.
  - Turn evaluate() into a release gate like the one in "Evaluation and hallucination checks", with a non-zero exit code below the threshold.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The department's research office answers the same requests every week: "anything on crop disease since 2023?",
"which of R. Menon's papers are about images?". Its fourteen papers (fictional, in `papers.json`) have titles,
authors, years and abstracts. Keyword search misses papers that use other words; the office wants search by
meaning, with filters for years and authors.

Two things make this harder than it looks. First, **filters must not lose results**: if the vector store returns
the three most similar papers and you throw away the old ones afterwards, a search limited to recent years can
come back empty although recent papers match. Second, **"it works on my examples" is not evidence**: you will
build an evaluation set and a hit-rate measurement, and the check measures your search on twelve questions of its
own as well.

The embedding is the track's labelled teaching stand-in, a keyword model with fourteen research topics
(`stand_ins.py`); it is crude on purpose, so the evaluation has something to find. No API key is needed, and
the check runs your code with the network switched off.

## Getting started

1. Copy the starter into a new folder. Read `papers.json`, `stand_ins.py` and the interface in `explorer.py`.
2. Implement `load_papers()` and `search()`, then `evaluate()`, and write at least 8 cases in `eval_set.json`.
   Run your evaluation in the lessons' container:

   ```bash
   IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
   docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" \
     sh -c "pip install -q -r requirements.txt && python explorer.py"
   ```

3. Run the check. It needs Docker, installs the pinned packages in a throwaway container, and removes it:

   ```bash
   bash check.sh path/to/your/project
   ```
