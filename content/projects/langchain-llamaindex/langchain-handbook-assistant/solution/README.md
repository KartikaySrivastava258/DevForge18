# College handbook assistant

Students at Northfield College (a fictional college) ask the help desk the same questions every week: how much
attendance they need, what a lost library book costs, when the hostel gates close. All the answers are in the
handbook (`handbook/*.md`), but nobody reads 5 files to find one sentence. Build an assistant that answers from
the handbook — and only from the handbook — and shows students where each answer came from.

## What to build (in `assistant.py`)

1. `load_chunks(folder)` — split each file into sections (`## ` headings) and long sections into chunks of at
   most 120 words. Every chunk is a LangChain `Document` with the metadata `{"source": "<file>", "section": "<heading>"}`.
2. `answer(question, model)` — returns `{"answer": str, "sources": [{"source", "section"}, ...], "refused": bool}`:
   - retrieve the most similar chunks from an `InMemoryVectorStore` that uses `KeywordEmbedding`, and keep only
     those above a relevance threshold;
   - nothing relevant: refuse (`refused: True`, no sources) **without calling the model**;
   - otherwise send the chunks to the model as numbered sources and ask for a citation like `[1]` after every
     sentence;
   - check the reply: a sentence without a citation, or a citation of a source you did not send, means the reply
     is refused, not shown;
   - return the accepted reply with its sources, in the order you numbered them.

## Rules

- `stand_ins.py` holds labelled teaching stand-ins: the keyword embedding and a scripted chat model. Do not
  change it. No API key, no paid service: the check runs your code with the network switched off.
- `requirements.txt` may only list `langchain-core==1.8.4`, `numpy==2.5.5` and `llama-index-core==0.14.26`.

## Try it

```bash
IMAGE=python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b
docker run --rm -it -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/work -w /work "$IMAGE" sh -c "pip install -q -r requirements.txt && python try_it.py"
bash check.sh .
```
